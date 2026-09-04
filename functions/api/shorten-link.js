// Cloudflare Pages Function
// Route: POST /api/shorten-link
//
// Backs the automatic "Short link" box on tour-planner.html's Send-to-Client
// card. Given a long URL (the full multi-stop Google Maps route link), calls
// is.gd's free, keyless URL-shortening API and returns a short link.
//
// Why a server-side proxy instead of calling is.gd directly from the
// browser: is.gd documents a `callback` (JSONP) param for cross-domain use,
// but doesn't explicitly document CORS headers on the plain JSON endpoint —
// rather than gamble on that, this Function calls is.gd server-to-server
// (no CORS involved at all there) and returns JSON to our own frontend with
// our own CORS headers, same pattern as route-optimize.js.
//
// This is intentionally the "good enough for now, zero setup" option — no
// signup, no API key, no cost. tour-planner.html shows an ⓘ next to the
// short link explaining the upgrade path: swap this file's is.gd call for
// ElkQR's API (branded 804re.link short links) once Michael has signed up
// for ElkQR and generated an API key — add it as an ELKQR_API_KEY
// Cloudflare env var (same pattern as ORS_API_KEY in route-optimize.js) and
// point this file at ElkQR's shorten endpoint instead. The frontend doesn't
// need to change either way — it just calls /api/shorten-link and displays
// whatever "shortUrl" comes back.

const ISGD_URL = 'https://is.gd/create.php';

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

  try {
    const apiUrl = ISGD_URL + '?format=json&url=' + encodeURIComponent(longUrl);
    const res = await fetch(apiUrl);
    const data = await res.json().catch(() => null);
    if(data && data.shorturl){
      return new Response(JSON.stringify({ source: 'is.gd', shortUrl: data.shorturl }), { headers: jsonHeaders });
    }
    // is.gd returns { errorcode, errormessage } on failure (e.g. rate limit) —
    // surface that detail for debugging, but keep the HTTP status a clean
    // 502 so the frontend's generic "short link unavailable" fallback fires.
    return new Response(JSON.stringify({
      error: 'shorten_failed',
      detail: data && data.errormessage ? data.errormessage : 'no shorturl in response',
    }), { status: 502, headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'fetch_failed', detail: err && err.message }), { status: 502, headers: jsonHeaders });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
