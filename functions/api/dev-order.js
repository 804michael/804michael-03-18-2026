// functions/api/dev-order.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// This Cloudflare Pages Function stores/retrieves the drag-and-drop card
// order for the internal /dev staging hub (dev.html). It reads/writes a
// single JSON array of card `data-id` values under one KV key.
//
// REQUIRES a KV namespace bound to this Pages project as "DEV_ORDER_KV".
// One-time setup Michael needs to do in the Cloudflare dashboard (this
// can't be done from the repo/code side):
//   1. In the Cloudflare dashboard, go to "Workers KV" (as of 2026-09-02
//      this is its OWN item in the left sidebar / dashboard search — NOT
//      nested under "Workers & Pages", which is where people expect to
//      find it). Easiest: use the dashboard's search bar and type
//      "Workers KV", or go directly to
//      dash.cloudflare.com/?to=/:account/workers/kv/namespaces
//      Click "Create instance" and name it (e.g. "dev-hub-order").
//   2. Workers & Pages → [this Pages project, 804re.com] → Settings →
//      Bindings → Add → KV namespace:
//        Variable name: DEV_ORDER_KV
//        KV namespace:  the one created in step 1
//      Do this for the Production environment (and Preview too, if you
//      want drag order to also work on preview deploys).
//   3. Like the FRED_API_KEY setup for rates.js, a KV binding only takes
//      effect on a NEW deployment — redeploy (push-live.bat, or trigger a
//      new Pages build) after adding the binding.
// Until that binding exists, this function responds with
// { order: null, error: "KV not bound" } and dev.html falls back to
// saving the order in that browser's localStorage only (see dev.html's
// own drag-to-reorder script comment).
//
// No auth on this endpoint — it only stores an array of known page-slug
// strings (no personal/lead data), and the page itself is noindex/nofollow
// and not linked from the live site, so the exposure here is low. If that
// ever changes, add a shared-secret header check before trusting the body.

const ORDER_KEY = 'card-order';
const MAX_IDS = 40; // generous ceiling — just a sanity cap, not a real limit

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const env = context.env;
  try {
    if (!env.DEV_ORDER_KV) {
      return json({ order: null, error: 'KV not bound' });
    }
    const raw = await env.DEV_ORDER_KV.get(ORDER_KEY);
    const order = raw ? JSON.parse(raw) : null;
    return json({ order: Array.isArray(order) ? order : null });
  } catch (err) {
    return json({ order: null, error: String(err && err.message || err) });
  }
}

export async function onRequestPost(context) {
  const env = context.env;
  const request = context.request;
  try {
    if (!env.DEV_ORDER_KV) {
      return json({ ok: false, error: 'KV not bound' });
    }
    const body = await request.json().catch(function () { return null; });
    const order = body && Array.isArray(body.order)
      ? body.order.filter(function (id) { return typeof id === 'string' && id.length && id.length < 80; }).slice(0, MAX_IDS)
      : null;
    if (!order || !order.length) {
      return json({ ok: false, error: 'Invalid order payload' }, 400);
    }
    await env.DEV_ORDER_KV.put(ORDER_KEY, JSON.stringify(order));
    return json({ ok: true, order: order });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}
