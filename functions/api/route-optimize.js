// Cloudflare Pages Function
// Route: POST /api/route-optimize
//
// Backs the Home Tour Route Planner (tour-planner.html). Given a list of
// stops (lat/lng, already geocoded client-side via Nominatim) and a mode
// ("optimize" = find the best visiting order, "manual" = keep the order
// given), this returns:
//   - the visiting order (as stop ids)
//   - per-leg distance/duration
//   - a route geometry (array of [lat,lng]) to draw on the Leaflet map
//   - totals (distance + duration)
//
// Setup (one-time): add an environment variable in Cloudflare — Workers &
// Pages > 804re.com project > Settings > Environment variables:
//
//   ORS_API_KEY   (mark it "Encrypt")
//
// Get a free key instantly, no billing/approval wait, at:
//   https://account.heigit.org/signup
// (openrouteservice.org/dev/#/signup redirects here too — HeiGIT moved
// account management to its own domain. If account.heigit.org shows "no
// available server" or won't load, that's a HeiGIT-side outage, not
// anything wrong on our end — it's been reported intermittently during
// their API migration (see the URL note below); just try again later, or
// try the "Sign in with GitHub" option from https://openrouteservice.org/log-in/
// instead of the plain email signup form.)
//
// Cloudflare Pages env vars only attach to a NEW deployment — after adding
// or changing one, push a commit (or "Retry deployment" in the dashboard)
// before it takes effect.
//
// If the key is missing, or any OpenRouteService request fails, this falls
// back to a straight-line (haversine) estimate — nearest-neighbor ordering
// for "optimize" mode, road-distance fudge factor (x1.3) and an assumed
// ~30mph average for time — so the planner is always usable even before
// the key is configured. "source" in the response tells the frontend which
// path was used ("ORS" vs "fallback-haversine").
//
// IMPORTANT — URL migration (2026-09-03): HeiGIT (the org behind
// openrouteservice) is retiring the old "api.openrouteservice.org" domain
// in favor of "api.heigit.org" — the old domain's quota was cut to 10% on
// 2026-08-27 and it's fully shutting down 2026-09-28. This file already
// points at the new api.heigit.org URLs below. An existing/new API key
// works on both domains automatically — no separate key needed for the
// new URLs, per HeiGIT's own migration notice.
//
// Optimization approach: ORS's Optimization API needs a fixed vehicle
// start, so the FIRST stop in the list you send is used as that anchor —
// the remaining stops are reordered around it for the shortest total
// route. This is an "open" route (no forced return to the start).

const ORS_OPTIMIZATION_URL = 'https://api.heigit.org/vroom/v0';
const ORS_DIRECTIONS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';

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

function haversineMeters(a, b){
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function nearestNeighborOrder(stops){
  if(stops.length <= 1) return stops.slice();
  const remaining = stops.slice(1);
  const ordered = [stops[0]];
  let current = stops[0];
  while(remaining.length){
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((s,i) => { const d = haversineMeters(current, s); if(d < bestDist){ bestDist = d; bestIdx = i; } });
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

function fallbackResult(stops, mode){
  const ordered = mode === 'optimize' ? nearestNeighborOrder(stops) : stops.slice();
  const legs = [];
  let totalDistanceMeters = 0, totalDurationSeconds = 0;
  for(let i = 0; i < ordered.length - 1; i++){
    const d = haversineMeters(ordered[i], ordered[i+1]) * 1.3; // fudge factor: straight-line -> approx road distance
    const dur = d / 13.4; // ~30mph average including turns/stop signs
    legs.push({ fromId: ordered[i].id, toId: ordered[i+1].id, distanceMeters: d, durationSeconds: dur });
    totalDistanceMeters += d; totalDurationSeconds += dur;
  }
  return {
    source: 'fallback-haversine',
    order: ordered.map(s => s.id),
    legs, geometry: null,
    totalDistanceMeters, totalDurationSeconds,
  };
}

async function orsOptimizeOrder(stops, apiKey){
  if(stops.length < 3) return stops.slice(); // nothing to optimize with only a start + 1 stop
  const jobs = stops.slice(1).map((s, i) => ({ id: i + 1, location: [s.lng, s.lat] }));
  const body = {
    jobs,
    vehicles: [{ id: 1, profile: 'driving-car', start: [stops[0].lng, stops[0].lat] }],
  };
  const res = await fetch(ORS_OPTIMIZATION_URL, {
    method: 'POST',
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if(!res.ok) throw new Error('ors_optimization_http_' + res.status);
  const data = await res.json();
  const steps = data && data.routes && data.routes[0] && data.routes[0].steps;
  if(!Array.isArray(steps)) throw new Error('ors_optimization_bad_response');
  const jobSteps = steps.filter(st => st.type === 'job');
  const ordered = [stops[0]];
  jobSteps.forEach(st => { const s = stops[st.job]; if(s) ordered.push(s); });
  // Safety net: if anything didn't map cleanly, don't silently drop stops
  return ordered.length === stops.length ? ordered : stops.slice();
}

async function orsDirections(orderedStops, apiKey){
  const coordinates = orderedStops.map(s => [s.lng, s.lat]);
  const res = await fetch(ORS_DIRECTIONS_URL, {
    method: 'POST',
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  });
  if(!res.ok) throw new Error('ors_directions_http_' + res.status);
  const data = await res.json();
  const feature = data && data.features && data.features[0];
  if(!feature) throw new Error('ors_directions_bad_response');
  const geometry = (feature.geometry.coordinates || []).map(c => [c[1], c[0]]); // [lng,lat] -> [lat,lng]
  const segments = (feature.properties && feature.properties.segments) || [];
  const legs = segments.map((seg, i) => ({
    fromId: orderedStops[i].id,
    toId: orderedStops[i+1] ? orderedStops[i+1].id : null,
    distanceMeters: seg.distance,
    durationSeconds: seg.duration,
  }));
  const summary = (feature.properties && feature.properties.summary) || {};
  return {
    geometry,
    legs,
    totalDistanceMeters: summary.distance || 0,
    totalDurationSeconds: summary.duration || 0,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = corsHeadersFor(request);
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders };

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders });
  }

  const mode = payload && payload.mode === 'manual' ? 'manual' : 'optimize';
  const rawStops = Array.isArray(payload && payload.stops) ? payload.stops : [];
  const stops = rawStops
    .filter(s => s && typeof s.lat === 'number' && typeof s.lng === 'number' && s.id)
    .slice(0, 12);

  if(stops.length < 2){
    return new Response(JSON.stringify({ error: 'need_at_least_two_stops' }), { status: 400, headers: jsonHeaders });
  }

  let result;
  if(!env.ORS_API_KEY){
    result = fallbackResult(stops, mode);
  } else {
    try {
      const ordered = mode === 'optimize' ? await orsOptimizeOrder(stops, env.ORS_API_KEY) : stops.slice();
      const dirResult = await orsDirections(ordered, env.ORS_API_KEY);
      result = {
        source: 'ORS',
        order: ordered.map(s => s.id),
        legs: dirResult.legs,
        geometry: dirResult.geometry,
        totalDistanceMeters: dirResult.totalDistanceMeters,
        totalDurationSeconds: dirResult.totalDurationSeconds,
      };
    } catch (err) {
      result = fallbackResult(stops, mode);
      result.reason = err && err.message ? err.message : 'fetch_failed';
    }
  }

  return new Response(JSON.stringify(result), { headers: jsonHeaders });
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
