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
// fine for one person's use. Each write (Save) refreshes a 2-year
// expiration — this is a just-in-case janitor for total abandonment, NOT a
// meaningful pruning tool by itself: a tour only "expires" on its own if it
// goes 2 full years without being saved/re-saved even once. Use the page's
// "Select tours to delete" tool or the per-tour Delete button for actual,
// intentional cleanup.
//
// AGENT KEY (added 2026-09-11). Every method here needs a shared secret.
// Before this, GET handed every saved tour to anyone who asked: client names
// in the tour titles, every stop address, private notes, and each tour's
// tourPageAdminKey, which is what unlocks a client's feedback on
// /api/tour-page. DELETE {clearAll:true} wiped the lot with no check at all.
//
// The secret is an env var named AGENT_KEY in the Cloudflare dashboard
// (804re.com Pages project > Settings > Variables and Secrets, type Secret).
// The planner sends it in an X-Agent-Key header; Michael types it once per
// browser and the page keeps it in localStorage under "804m_agent_key".
// Like a binding, a new or changed env var only reaches a NEW deployment.
//
// Nothing hard-fails. Each case below lands the planner in the localStorage
// mode it already had, and the page says which one it hit:
//   TOURS_KV missing   501 kv_not_configured (checked first, unchanged, so
//                      another agent's copy still hides the cloud block)
//   AGENT_KEY missing  501 agent_key_not_configured. Fails CLOSED: with no
//                      secret set, nobody can read or change the list.
//   header missing     401 agent_key_required
//   header wrong       401 agent_key_wrong (the page drops its stored key)
// The compare hashes both sides first, so it takes the same time whatever
// the length or content of the guess.

const KV_KEY = 'tours';
const TTL_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years, refreshed on every Save

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Agent-Key',
  };
}

function notConfigured(jsonHeaders){
  return new Response(JSON.stringify({ error: 'kv_not_configured' }), { status: 501, headers: jsonHeaders });
}

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
// when they are. See "AGENT KEY" at the top of this file.
async function agentKeyDenied(request, env, jsonHeaders){
  const deny = (status, error) => new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
  const expected = typeof env.AGENT_KEY === 'string' ? env.AGENT_KEY.trim() : '';
  if(!expected) return deny(501, 'agent_key_not_configured');
  const given = (request.headers.get(AGENT_HEADER) || '').trim();
  if(!given) return deny(401, 'agent_key_required');
  if(!(await sameSecret(given, expected))) return deny(401, 'agent_key_wrong');
  return null;
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
  const denied = await agentKeyDenied(request, env, jsonHeaders);
  if(denied) return denied;

  const tours = await readTours(env.TOURS_KV);
  return new Response(JSON.stringify({ tours }), { headers: jsonHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) };
  if(!env.TOURS_KV) return notConfigured(jsonHeaders);
  const denied = await agentKeyDenied(request, env, jsonHeaders);
  if(denied) return denied;

  let payload;
  try { payload = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders });
  }
  const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
  const stops = Array.isArray(payload && payload.stops) ? payload.stops : null;
  if(!name || !stops){
    return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
  }

  // A saved tour used to be stored as a bare array of stops, which meant the
  // published code and its adminKey were NOT kept with it - reloading a saved
  // tour therefore lost the link and made its client feedback unreadable, and
  // republishing minted a brand new code. It is now stored as an object that
  // carries that identity alongside the stops. Bare arrays written before
  // 2026-09-06 still read fine; the page normalises either shape.
  const meta = payload && typeof payload.meta === 'object' && payload.meta ? payload.meta : {};
  const asStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  const tours = await readTours(env.TOURS_KV);
  tours[name] = {
    stops,
    tourPageCode: asStr(meta.tourPageCode, 40),
    tourPageAdminKey: asStr(meta.tourPageAdminKey, 40),
    tourSlug: asStr(meta.tourSlug, 40),
    savedAt: Date.now(),
  };
  await writeTours(env.TOURS_KV, tours);
  return new Response(JSON.stringify({ ok: true, tours }), { headers: jsonHeaders });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeadersFor(request) };
  if(!env.TOURS_KV) return notConfigured(jsonHeaders);
  const denied = await agentKeyDenied(request, env, jsonHeaders);
  if(denied) return denied;

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
