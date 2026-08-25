// Cloudflare Pages Function
// Route: GET /api/address-autocomplete?q=123+main+st
//
// Proxies to sthan.io's USA Address Autocomplete API so the profile
// credentials never reach the browser. Requires two environment
// variables set in Cloudflare (Workers & Pages > 804re.com project >
// Settings > Environment variables), both marked "Encrypt":
//
//   STHAN_PROFILE_NAME
//   STHAN_PROFILE_PASSWORD
//
// The sthan.io JWT lasts 15 minutes. We cache it in module scope so
// warm invocations of this Worker reuse it instead of re-authing on
// every keystroke.

const STHAN_BASE = 'https://api.sthan.io';

let cachedToken = null;
let cachedTokenExpiresAt = 0; // epoch ms

async function getToken(env) {
  const now = Date.now();
  // Refresh a little early (60s buffer) so we never send an expired token.
  if (cachedToken && now < cachedTokenExpiresAt - 60000) {
    return cachedToken;
  }

  const res = await fetch(`${STHAN_BASE}/Auth/Token`, {
    method: 'GET',
    headers: {
      profileName: env.STHAN_PROFILE_NAME,
      profilePassword: env.STHAN_PROFILE_PASSWORD,
    },
  });

  if (!res.ok) {
    throw new Error(`sthan.io auth failed: ${res.status}`);
  }

  const data = await res.json();
  const result = data.Result;
  cachedToken = result.access_token;
  // expiration is typically an ISO string or seconds-from-now depending on
  // account tier; fall back to a conservative 14-minute cache if unparsable.
  const parsed = Date.parse(result.expiration);
  cachedTokenExpiresAt = Number.isFinite(parsed) ? parsed : now + 14 * 60 * 1000;

  return cachedToken;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Lock the proxy down to your own site.
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = [
    'https://804re.com',
    'https://www.804re.com',
  ];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (q.length < 3) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const token = await getToken(env);

    const apiRes = await fetch(
      `${STHAN_BASE}/AutoComplete/USA/Address/${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (apiRes.status === 401) {
      // Token might have been invalidated server-side; force one retry with a fresh token.
      cachedToken = null;
      const freshToken = await getToken(env);
      const retryRes = await fetch(
        `${STHAN_BASE}/AutoComplete/USA/Address/${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${freshToken}` } }
      );
      const retryEnvelope = await retryRes.json();
      const retryData = Array.isArray(retryEnvelope) ? retryEnvelope : (retryEnvelope.Result || []);
      return new Response(JSON.stringify(retryData), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!apiRes.ok) {
      throw new Error(`sthan.io autocomplete failed: ${apiRes.status}`);
    }

    const envelope = await apiRes.json();
    // sthan.io wraps every response in an envelope: { Id, Result, IsError, StatusCode, Errors }.
    // Their docs show only the Result contents for brevity, which is what our frontend expects.
    const suggestions = Array.isArray(envelope) ? envelope : (envelope.Result || []);
    return new Response(JSON.stringify(suggestions), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'autocomplete_unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
