// Cloudflare Pages Function
// Route: POST /api/shorten-link
//
// Backs the automatic "Short link" box on tour-planner.html's Send-to-Client
// card. Given a long URL (the full multi-stop Google Maps route link),
// returns a short link the agent can text to a client.
//
// UPDATE 2026-09-04 (v2): Free third-party keyless shorteners turned out to
// be unreliable for this use case in practice:
//   - is.gd was intermittently returning "Short link unavailable" — likely
//     rate-limiting/blocking requests from shared cloud IP ranges (the kind
//     a Cloudflare Function calls from), even though the same API works
//     fine from a home connection.
//   - TinyURL's free, keyless api-create.php endpoint now routes through a
//     "deprecated API endpoint" interstitial/ad page before redirecting —
//     not something to hand a client, who'd see an 8-second ad splash
//     before ever reaching the route.
// Rather than chase a third free provider with the same risk, this now
// shortens links ourselves using the same Cloudflare KV namespace already
// bound as TOURS_KV for Save/Reuse Tours (see tours.js) — no new setup
// needed. A short code is generated, the long URL is stored under it with a
// long TTL, and the short link is our own domain: https://804re.com/s/CODE
// (see functions/s/[code].js for the redirect side). This is same-origin,
// so there's no ad interstitial, no third-party rate limiting, and no risk
// of a provider deprecating the free endpoint out from under us.
//
// is.gd and TinyURL are kept as a fallback ONLY for the case where TOURS_KV
// isn't bound yet (before the one-time KV setup described in tours.js) —
// so short links keep working either way while KV is being set up.
//
// LOCKED DOWN 2026-09-12. Until now a POST here took any http(s) URL from
// anyone and handed back an 804re.com/s/ link that 302-redirected to it. That
// is an open redirect on Michael's own domain: a phishing text reading
// "804re.com/s/AbC1234" would carry the trust of his brand and land wherever
// the sender chose. Two checks now sit in front of the write:
//   1. The same AGENT_KEY / X-Agent-Key check as /api/tours (see tours.js).
//      The planner already keeps the key in localStorage, so nothing new to
//      type. Fails closed: no key set, no codes minted.
//   2. The long URL must point at a Google Maps host or at 804re.com itself.
//      That is every link the planner has ever asked to shorten, and it means
//      even a leaked key cannot turn this into a general-purpose redirector.
// The GET health probe and the /s/<code> redirect side are unchanged.

const ISGD_URL = 'https://is.gd/create.php';
const TINYURL_URL = 'https://tinyurl.com/api-create.php';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 90 days (shortened from 2 years, 2026-09-06). A new short code is minted on
// every Calculate Route, so these accumulate faster than anything else in the
// namespace - hundreds a year in real use - while the link itself is only
// useful for the days or weeks around one tour. 90 days is far longer than any
// route link stays relevant and stops the namespace filling with dead codes.
//
// This only affects codes minted from here on: KV fixes an expiry at write
// time, so links created before this change keep their original 2-year expiry
// and have to be removed by hand if that matters.
//
// The client tour page is NOT affected. That lives under tourpage_ with its own
// TTL - 2 years for a random code, none at all for a custom slug - and the
// texting box now prefers that link anyway.
const SHORT_TTL_SECONDS = 60 * 60 * 24 * 90;
const SHORT_CODE_LEN = 7;
// Unambiguous alphabet — no 0/O, 1/l/I, etc, in case a code is ever read
// off a printout instead of tapped/scanned.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Agent-Key',
  };
}

// ── Agent key (same contract as tours.js) ────────────────────────────────
const AGENT_HEADER = 'X-Agent-Key';

async function sameSecret(a, b){
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for(let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Returns a Response to send back when the caller is not allowed in, or null
// when they are. 501 when AGENT_KEY is unset (fails closed), 401 otherwise.
async function agentKeyDenied(request, env, jsonHeaders){
  const deny = (status, error) => new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
  const expected = typeof env.AGENT_KEY === 'string' ? env.AGENT_KEY.trim() : '';
  if(!expected) return deny(501, 'agent_key_not_configured');
  const given = (request.headers.get(AGENT_HEADER) || '').trim();
  if(!given) return deny(401, 'agent_key_required');
  if(!(await sameSecret(given, expected))) return deny(401, 'agent_key_wrong');
  return null;
}

// ── Destination allow-list ───────────────────────────────────────────────
// Hosts an 804re.com/s/ code may point at. Google Maps in every spelling the
// planner produces, plus our own domain (client tour pages). Subdomains of
// each entry are accepted; nothing else is.
const ALLOWED_HOSTS = [
  'google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl',
  '804re.com',
];

function destinationAllowed(longUrl){
  let u;
  try { u = new URL(longUrl); } catch (e) { return false; }
  if(u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

function randomCode(len){
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for(let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// Generates a short code, stores it in TOURS_KV under a "slink_" prefix
// (kept in the same namespace as saved tours, under its own key prefix, so
// no second KV namespace/binding is needed), and returns our own-domain
// short URL. Retries a handful of times on the astronomically unlikely
// chance of a collision.
async function tryOwnShortener(longUrl, env, request){
  if(!env.TOURS_KV) return { ok:false, detail: 'own shortener: TOURS_KV not bound yet' };
  const origin = new URL(request.url).origin;
  for(let attempt = 0; attempt < 6; attempt++){
    const code = randomCode(SHORT_CODE_LEN);
    const key = 'slink_' + code;
    const existing = await env.TOURS_KV.get(key);
    if(existing) continue; // collision (extremely unlikely) — try another code
    await env.TOURS_KV.put(key, longUrl, { expirationTtl: SHORT_TTL_SECONDS });
    return { ok:true, shortUrl: origin + '/s/' + code };
  }
  return { ok:false, detail: 'own shortener: could not find a free short code after several tries' };
}

async function tryIsGd(longUrl){
  const apiUrl = ISGD_URL + '?format=json&url=' + encodeURIComponent(longUrl);
  const res = await fetch(apiUrl, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' } });
  const data = await res.json().catch(() => null);
  if(data && data.shorturl) return { ok:true, shortUrl: data.shorturl };
  // is.gd returns { errorcode, errormessage } on failure (e.g. rate limit).
  return { ok:false, detail: 'is.gd http_' + res.status + ': ' + (data && data.errormessage ? data.errormessage : 'no shorturl in response') };
}

async function tryTinyUrl(longUrl){
  const apiUrl = TINYURL_URL + '?url=' + encodeURIComponent(longUrl);
  const res = await fetch(apiUrl, { headers: { 'User-Agent': BROWSER_UA } });
  const text = (await res.text().catch(() => '')).trim();
  if(res.ok && /^https?:\/\//i.test(text)) return { ok:true, shortUrl: text };
  return { ok:false, detail: 'tinyurl http_' + res.status + ': ' + (text || 'empty response') };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = corsHeadersFor(request);
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders };

  const denied = await agentKeyDenied(request, env, jsonHeaders);
  if(denied) return denied;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders });
  }

  const longUrl = payload && typeof payload.url === 'string' ? payload.url : '';
  if(!longUrl || !/^https?:\/\//i.test(longUrl)){
    return new Response(JSON.stringify({ error: 'invalid_url' }), { status: 400, headers: jsonHeaders });
  }
  if(longUrl.length > 4000 || !destinationAllowed(longUrl)){
    return new Response(JSON.stringify({ error: 'destination_not_allowed', detail: 'only Google Maps and 804re.com links can be shortened' }), { status: 400, headers: jsonHeaders });
  }

  const attempts = [];

  try {
    const ownResult = await tryOwnShortener(longUrl, env, request);
    if(ownResult.ok) return new Response(JSON.stringify({ source: 'own', shortUrl: ownResult.shortUrl }), { headers: jsonHeaders });
    attempts.push(ownResult.detail);
  } catch (err) {
    attempts.push('own shortener threw: ' + (err && err.message));
  }

  try {
    const isGdResult = await tryIsGd(longUrl);
    if(isGdResult.ok) return new Response(JSON.stringify({ source: 'is.gd', shortUrl: isGdResult.shortUrl }), { headers: jsonHeaders });
    attempts.push(isGdResult.detail);
  } catch (err) {
    attempts.push('is.gd threw: ' + (err && err.message));
  }

  try {
    const tinyResult = await tryTinyUrl(longUrl);
    if(tinyResult.ok) return new Response(JSON.stringify({ source: 'tinyurl', shortUrl: tinyResult.shortUrl }), { headers: jsonHeaders });
    attempts.push(tinyResult.detail);
  } catch (err) {
    attempts.push('tinyurl threw: ' + (err && err.message));
  }

  // All three failed — surface exactly why for debugging, but keep the
  // HTTP status a clean 502 so the frontend's generic "short link
  // unavailable" fallback fires regardless.
  return new Response(JSON.stringify({ error: 'shorten_failed', detail: attempts.join(' | ') }), { status: 502, headers: jsonHeaders });
}

// Health probe for system-status.html. A POST mints a real code, so the status
// page can't use one. Without this handler a GET fell through to the static
// 404 page, and the status page showed "Endpoint not deployed" even though
// shortening worked. This writes nothing; it only reports which store a POST
// would use right now.
export async function onRequestGet(context) {
  const { request, env } = context;
  return new Response(JSON.stringify({ ok: true, store: env.TOURS_KV ? 'kv' : 'fallback' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) },
  });
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
