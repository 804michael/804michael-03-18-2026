// Cloudflare Pages Function
// Routes: GET / POST / DELETE  /api/tours
//
// Backs "Save / Reuse Tours" on tour-planner.html. Stores every saved tour
// server-side in Cloudflare KV so the saved list follows Michael across any
// device or browser he opens the planner in — not just the one browser that
// saved it (the old localStorage-only behavior).
//
// ONE-TIME SETUP required in the Cloudflare dashboard (no signup or API key
// needed — this is built into your existing Cloudflare account):
//   1. Workers & Pages > KV > "Create a namespace" — name it anything,
//      e.g. "tour_planner_tours".
//   2. 804re.com Pages project > Settings > Bindings > "Add binding" >
//      KV namespace. Variable name MUST be exactly: TOURS_KV
//      Bind it to the namespace you just created.
//   3. Cloudflare Pages bindings only attach to a NEW deployment — push a
//      commit (or "Retry deployment" in the dashboard) after adding it.
//
// Until that binding exists, every request here returns a plain
// { error: "kv_not_configured" } response (HTTP 501) and the frontend
// automatically falls back to localStorage — same as the old behavior — so
// nothing breaks in the meantime.
//
// Storage shape: everything lives under ONE KV key ("tours"), as a single
// JSON object keyed by tour name — the exact same shape the old localStorage
// version used, just kept on the server instead. Simple read-modify-write;
// fine for one person's use. Each write refreshes a generous 365-day
// expiration as a just-in-case janitor for total abandonment — it is NOT a
// meaningful pruning tool by itself. Use "Clear all saved tours" or the
// per-tour Delete button on the page for actual cleanup.

const KV_KEY = 'tours';
const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year, refreshed on every write

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function notConfigured(jsonHeaders){
  return new Response(JSON.stringify({ error: 'kv_not_configured' }), { status: 501, headers: jsonHeaders });
}

async function readTours(kv){
  const raw = await kv.get(KV_KEY);
  if(!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch(e){ return {}; }
}
async function writeTours(kv, tours){
  await kv.put(KV_KEY, JSON.stringify(tours), { expirationTtl: TTL_SECONDS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) };
  if(!env.TOURS_KV) return notConfigured(jsonHeaders);

  const tours = await readTours(env.TOURS_KV);
  return new Response(JSON.stringify({ tours }), { headers: jsonHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) };
  if(!env.TOURS_KV) return notConfigured(jsonHeaders);

  let payload;
  try { payload = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders });
  }
  const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
  const stops = Array.isArray(payload && payload.stops) ? payload.stops : null;
  if(!name || !stops){
    return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
  }

  const tours = await readTours(env.TOURS_KV);
  tours[name] = stops;
  await writeTours(env.TOURS_KV, tours);
  return new Response(JSON.stringify({ ok: true, tours }), { headers: jsonHeaders });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) };
  if(!env.TOURS_KV) return notConfigured(jsonHeaders);

  let payload;
  try { payload = await request.json(); } catch (e) { payload = {}; }

  if(payload && payload.clearAll){
    await env.TOURS_KV.delete(KV_KEY);
    return new Response(JSON.stringify({ ok: true, tours: {} }), { headers: jsonHeaders });
  }

  const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
  if(!name){
    return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
  }
  const tours = await readTours(env.TOURS_KV);
  delete tours[name];
  await writeTours(env.TOURS_KV, tours);
  return new Response(JSON.stringify({ ok: true, tours }), { headers: jsonHeaders });
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
