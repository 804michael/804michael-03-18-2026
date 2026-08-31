// Cloudflare Pages Function
// Route: GET /api/rates
//
// Pulls the latest weekly national-average mortgage rates (30-year and
// 15-year fixed) from the St. Louis Fed's FRED API — the standard, free,
// reliable home for Freddie Mac's PMMS survey data — so the "Determine
// Your Budget" calculator's default Interest Rate field and the "Today's
// Snapshot" sidebar can stay current automatically instead of a hardcoded
// number quietly going stale.
//
// Setup (one-time): add an environment variable in Cloudflare — Workers &
// Pages > 804re.com project > Settings > Environment variables:
//
//   FRED_API_KEY   (mark it "Encrypt")
//
// Get a free key instantly, no approval wait, at:
//   https://fred.stlouisfed.org/docs/api/api_key.html
//
// Cloudflare Pages env vars only attach to a NEW deployment — after adding
// or changing one, push a commit (or "Retry deployment" in the dashboard)
// before it takes effect.
//
// If the key is missing, or the FRED request fails for any reason, this
// falls back to a static estimate rather than erroring — the calculator
// should never break because a third-party API had a bad day. The
// frontend (and you, testing this endpoint directly) can tell the
// difference via "source" ("FRED (Freddie Mac PMMS)" vs "fallback"), and
// "reason" explains WHY it fell back when it does.
//
// Caching: only a genuine FRED success is cached at the edge (6 hours —
// PMMS only updates weekly). A fallback is deliberately never cached and
// never served from a stale cache entry, so a temporary key/fetch problem
// self-heals on the very next request instead of getting stuck serving
// "fallback" for hours after the real problem is fixed.

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CACHE_SECONDS = 6 * 60 * 60;

function fallback(reason){
  return { rate30: 6.6, rate15: 5.9, asOf: null, source: 'fallback', reason };
}

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

async function fetchSeries(seriesId, apiKey){
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': '804re.com-rate-refresh/1.0' } });
  if (!res.ok) throw new Error(`fred_http_${res.status}`);
  const data = await res.json();
  const obs = data && Array.isArray(data.observations) ? data.observations[0] : null;
  if (!obs || obs.value === '.') throw new Error('fred_no_data');
  const value = parseFloat(obs.value);
  if (!Number.isFinite(value)) throw new Error('fred_bad_value');
  return { value, date: obs.date };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const corsHeaders = corsHeadersFor(request);

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + '/__rates-cache-key');
  const cached = await cache.match(cacheKey);
  if (cached) {
    // Never trust a cached fallback — only a genuine FRED success is ever
    // stored, so anything found here is safe to serve as-is.
    const fresh = new Response(cached.body, cached);
    Object.entries(corsHeaders).forEach(([k, v]) => fresh.headers.set(k, v));
    return fresh;
  }

  let payload;
  if (!env.FRED_API_KEY) {
    payload = fallback('no_api_key_configured');
  } else {
    try {
      const [r30, r15] = await Promise.all([
        fetchSeries('MORTGAGE30US', env.FRED_API_KEY),
        fetchSeries('MORTGAGE15US', env.FRED_API_KEY),
      ]);
      payload = {
        rate30: r30.value,
        rate15: r15.value,
        asOf: r30.date,
        source: 'FRED (Freddie Mac PMMS)',
      };
    } catch (err) {
      payload = fallback(err && err.message ? err.message : 'fetch_failed');
    }
  }

  const isSuccess = payload.source !== 'fallback';
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': isSuccess ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
    ...corsHeaders,
  };
  const response = new Response(JSON.stringify(payload), { headers: jsonHeaders });
  if (isSuccess) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
