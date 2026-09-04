// Cloudflare Pages Function
// Route: POST /api/shorten-link
//
// Backs the automatic "Short link" box on tour-planner.html's Send-to-Client
// card. Given a long URL (the full multi-stop Google Maps route link), calls
// a free, keyless URL-shortening API and returns a short link.
//
// Why a server-side proxy instead of calling the shortener directly from the
// browser: is.gd documents a `callback` (JSONP) param for cross-domain use,
// but doesn't explicitly document CORS headers on the plain JSON endpoint —
// rather than gamble on that, this Function calls it server-to-server
// (no CORS involved at all there) and returns JSON to our own frontend with
// our own CORS headers, same pattern as route-optimize.js.
//
// UPDATE 2026-09-04: is.gd was reportedly returning "Short link unavailable"
// in practice — plausible cause is that free keyless shorteners often rate-
// limit or outright block requests coming from shared cloud/datacenter IP
// ranges (which is exactly what a Cloudflare Function calls from), something
// that doesn't show up when testing the same API from a home connection.
// Two changes to make this more resilient: (1) send a real browser-style
// User-Agent on the is.gd request, since some anti-abuse filters reject
// requests with no/generic UA; (2) if is.gd still fails for any reason, fall
// back to TinyURL's equally free, keyless, no-signup API before giving up —
// two independent providers rather than a single point of failure. The
// frontend doesn't need to change either way — it just calls
// /api/shorten-link and displays whatever "shortUrl" comes back, and now
// also logs which provider (or failure) actually happened via `source`/
// `detail` in the response for easier debugging next time.
//
// This is intentionally the "good enough for now, zero setup" option — no
// signup, no API key, no cost. tour-planner.html shows an ⓘ next to the
// short link explaining the upgrade path: swap this file's calls for
// ElkQR's API (branded 804re.link short links) once Michael has signed up
// for ElkQR and generated an API key — add it as an ELKQR_API_KEY
// Cloudflare env var (same pattern as ORS_API_KEY in route-optimize.js) and
// point this file at ElkQR's shorten endpoint first, ahead of these two.

const ISGD_URL = 'https://is.gd/create.php';
const TINYURL_URL = 'https://tinyurl.com/api-create.php';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
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
  const { request } = context;
  const corsHeaders = corsHeadersFor(request);
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders };

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

  const attempts = [];
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

  // Both providers failed — surface exactly why for debugging, but keep the
  // HTTP status a clean 502 so the frontend's generic "short link
  // unavailable" fallback fires regardless.
  return new Response(JSON.stringify({ error: 'shorten_failed', detail: attempts.join(' | ') }), { status: 502, headers: jsonHeaders });
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
