// functions/api/tour-page.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// Backs the client-facing tour page (client-tour.html, served at /t/<code>).
// Two halves of one loop:
//   1. The Tour Planner PUBLISHES a tour here and gets back a public `code`
//      and a private `adminKey`. The client link is 804re.com/t/<code>.
//   2. The client opens that page, rates homes and leaves comments, which are
//      written back here against the same code. The planner reads them with
//      the adminKey.
//
// ⚠ THE ONE RULE THAT MATTERS: only client-safe fields are ever stored.
// publishableStop() below is an ALLOW-list — address, blurb, coordinates. The
// agent's private notes and the agent's own ratings are dropped here on the
// server, not merely omitted by the frontend, so a bug or a hand-crafted
// request on the page side still cannot leak them. If you add a field to a
// stop in tour-planner.html, it does NOT appear here unless you deliberately
// add it to that allow-list. Keep it that way.
//
// WHY THE adminKey: without it, anyone holding the client link could also read
// back everything the client typed about the houses. The tour itself is
// harmless to read (the client is meant to see it), but their opinions are
// not. So reading feedback needs a key that only the planner ever sees; the
// client page is never given it. This is a deliberate step up from the
// no-auth posture of the other endpoints on this site, because this is the
// only one that stores something a person typed in confidence.
//
// REQUIRES the existing TOURS_KV binding — the same one saved tours and short
// links already use, so there is no new Cloudflare setup. Keys used:
//   tourpage_<code>  the published, client-safe tour
//   tourfb_<code>    the feedback the client has left
//
// Without the binding this responds { error: "kv_not_configured" } (HTTP 501)
// and the planner keeps its old behaviour of sharing a plain Google Maps link.

const TOUR_PREFIX = 'tourpage_';
const FB_PREFIX = 'tourfb_';
// Two years, matching tours.js and shorten-link.js.
const TTL_SECONDS = 60 * 60 * 24 * 365 * 2;
const MAX_STOPS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

function notConfigured() {
  return json({ error: 'kv_not_configured' }, 501);
}

function randomToken(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function num(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

// ⚠ ALLOW-LIST. Anything not named here never reaches storage. See the note
// at the top of this file before changing it.
function publishableStop(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    address: str(s.address, 200),
    blurb: str(s.blurb, 300),
    lat: num(s.lat),
    lng: num(s.lng),
  };
}

function cleanCode(v) {
  const s = str(v, 32);
  return /^[A-Za-z0-9]+$/.test(s) ? s : '';
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TOURS_KV) return notConfigured();
  const url = new URL(request.url);
  const code = cleanCode(url.searchParams.get('code'));
  if (!code) return json({ error: 'missing_code' }, 400);

  const want = url.searchParams.get('what');

  // Agent side: read the feedback. Requires the adminKey handed back at
  // publish time — the client page is never given it.
  if (want === 'feedback') {
    const key = cleanCode(url.searchParams.get('key'));
    const rawTour = await env.TOURS_KV.get(TOUR_PREFIX + code);
    if (!rawTour) return json({ error: 'not_found' }, 404);
    let tour;
    try { tour = JSON.parse(rawTour); } catch (e) { return json({ error: 'corrupt' }, 500); }
    if (!key || key !== tour.adminKey) return json({ error: 'bad_key' }, 403);
    const rawFb = await env.TOURS_KV.get(FB_PREFIX + code);
    let feedback = {};
    try { feedback = rawFb ? JSON.parse(rawFb) : {}; } catch (e) { feedback = {}; }
    return json({ feedback });
  }

  // Client side: the tour itself. adminKey is stripped before it goes out.
  const raw = await env.TOURS_KV.get(TOUR_PREFIX + code);
  if (!raw) return json({ error: 'not_found' }, 404);
  let tour;
  try { tour = JSON.parse(raw); } catch (e) { return json({ error: 'corrupt' }, 500); }
  delete tour.adminKey;
  return json({ tour });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TOURS_KV) return notConfigured();

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: 'invalid_json' }, 400);
  }

  // ── Client leaving feedback ──────────────────────────────────────────
  if (body && body.action === 'feedback') {
    const code = cleanCode(body.code);
    if (!code) return json({ error: 'missing_code' }, 400);
    const raw = await env.TOURS_KV.get(TOUR_PREFIX + code);
    if (!raw) return json({ error: 'not_found' }, 404);

    let existing = {};
    const rawFb = await env.TOURS_KV.get(FB_PREFIX + code);
    try { existing = rawFb ? JSON.parse(rawFb) : {}; } catch (e) { existing = {}; }

    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_STOPS) : [];
    items.forEach((it) => {
      const i = num(it && it.i);
      if (i === null || i < 0 || i >= MAX_STOPS) return;
      const rating = num(it.rating);
      const entry = existing[i] || {};
      if (rating !== null && rating >= 0 && rating <= 5) entry.rating = Math.round(rating);
      if (typeof it.comment === 'string') entry.comment = str(it.comment, 1000);
      entry.at = Date.now();
      existing[i] = entry;
    });

    await env.TOURS_KV.put(FB_PREFIX + code, JSON.stringify(existing), { expirationTtl: TTL_SECONDS });
    return json({ ok: true });
  }

  // ── Agent publishing a tour ──────────────────────────────────────────
  const stops = Array.isArray(body && body.stops) ? body.stops.slice(0, MAX_STOPS) : [];
  if (!stops.length) return json({ error: 'no_stops' }, 400);

  // Re-publishing an existing tour keeps its code, so a link already sent to a
  // client keeps working after the agent tweaks the order — and keeps the
  // feedback already attached to that code.
  let code = cleanCode(body.code);
  let adminKey = cleanCode(body.adminKey);
  if (code) {
    const raw = await env.TOURS_KV.get(TOUR_PREFIX + code);
    let prev = null;
    try { prev = raw ? JSON.parse(raw) : null; } catch (e) { prev = null; }
    if (!prev || !adminKey || adminKey !== prev.adminKey) {
      // Wrong or missing key for that code — mint a fresh one instead of
      // letting a caller overwrite somebody else's published tour.
      code = '';
      adminKey = '';
    }
  }
  if (!code) {
    code = randomToken(7);
    adminKey = randomToken(20);
  }

  const tour = {
    name: str(body.name, 120),
    agent: str(body.agent, 120) || '804Michael',
    dateLabel: str(body.dateLabel, 60),
    startLabel: str(body.startLabel, 40),
    summary: str(body.summary, 200),
    stops: stops.map(publishableStop).filter((s) => s.address),
    adminKey,
    updatedAt: Date.now(),
  };
  if (!tour.stops.length) return json({ error: 'no_stops' }, 400);

  await env.TOURS_KV.put(TOUR_PREFIX + code, JSON.stringify(tour), { expirationTtl: TTL_SECONDS });
  return json({ ok: true, code, adminKey });
}
