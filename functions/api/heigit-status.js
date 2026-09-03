// Cloudflare Pages Function
// Route: GET /api/heigit-status
//
// Backs the small status indicator on dev.html's Home Tour Route Planner
// card. Checks whether account.heigit.org (the OpenRouteService/HeiGIT
// account & signup portal — see route-optimize.js's top comment and the
// "New tool: Home Tour Route Planner" section in site-design-notes.md) is
// responding, since Michael hit a "no available server" error there while
// trying to sign up for an ORS_API_KEY on 2026-09-03.
//
// This check runs SERVER-SIDE (not from the browser) on purpose: a
// browser-side fetch to a different origin like account.heigit.org would
// be blocked by CORS before we could even read a status code, since
// account.heigit.org has no reason to send us permissive CORS headers.
// A Cloudflare Function has no such restriction — server-to-server fetches
// aren't subject to CORS at all.
//
// CACHING: the real check only runs at most once an hour (via Cloudflare's
// Cache API, caches.default) — every dev.html page load in between reuses
// the last result instead of hitting HeiGIT's server again. Add ?force=1
// to skip the cache and check right now (used by the "Check now" link on
// the page); that fresh result then becomes the new cached value for
// everyone else too.
//
// Nothing to set up in Cloudflare for this one — no API key, no KV
// binding — it's a plain outbound fetch, so it starts working as soon as
// this file deploys.
//
// CAVEAT (honest, not tested live): this sandbox's own network egress list
// blocks account.heigit.org, so this exact check couldn't be run end-to-end
// before shipping — it follows the same fetch/try-catch/Cache-API pattern
// already proven in rates.js and route-optimize.js, but the specific
// "does account.heigit.org accept a plain server-side GET with no
// referrer/cookies the way a real browser visit would" question is
// untested. If it always reports "down" even once the site is actually
// back, that's the first thing to check — try loosening the User-Agent
// below or pointing CHECK_URL at a different path.

const CHECK_URL = 'https://account.heigit.org/';
const CACHE_SECONDS = 3600; // ~1 hour, per Michael's "every hour or so" ask
const CACHE_KEY_URL = 'https://804re.com/__internal-cache__/heigit-status';

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function checkHeigit(){
  try{
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(CHECK_URL, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 804re.com status check)' },
      });
    } finally {
      clearTimeout(timeout);
    }
    const text = await res.text().catch(() => '');
    // Some backend failures come back as a 200 with an error page body
    // rather than a non-2xx status — that's exactly what "no available
    // server" looked like when Michael hit it 2026-09-03 — so check both.
    const bodyLooksBroken = /no available server/i.test(text);
    return { up: res.ok && !bodyLooksBroken, status: res.status };
  }catch(err){
    return { up: false, status: 'network-error', reason: err && err.message ? err.message : 'fetch_failed' };
  }
}

export async function onRequestGet(context) {
  const { request } = context;
  const corsHeaders = corsHeadersFor(request);
  const jsonHeaders = { 'Content-Type': 'application/json', ...corsHeaders };

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const cache = caches.default;
  const cacheKey = new Request(CACHE_KEY_URL);

  if(!force){
    const cached = await cache.match(cacheKey);
    if(cached){
      const body = await cached.text();
      return new Response(body, { headers: { ...jsonHeaders, 'X-Cache': 'HIT' } });
    }
  }

  const result = await checkHeigit();
  const payload = JSON.stringify({ ...result, checkedAt: new Date().toISOString() });

  const cacheableResponse = new Response(payload, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
  });
  context.waitUntil(cache.put(cacheKey, cacheableResponse));

  return new Response(payload, { headers: { ...jsonHeaders, 'Cache-Control': `public, max-age=${CACHE_SECONDS}`, 'X-Cache': force ? 'BYPASS' : 'MISS' } });
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
