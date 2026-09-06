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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
// Showing windows are HH:MM, 24-hour. Anything else is dropped rather than
// trusted, so nothing but a time can ever reach the client page from this field.
function cleanTime(v) {
  const s = str(v, 5).trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}

function publishableStop(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  // DELIBERATE ALLOW-LIST ADDITION, 2026-09-05: windowStart/windowEnd.
  // A showing window is a hard constraint the client benefits from seeing
  // ("we can only get in between 2 and 3") and is NOT agent-private the way
  // notes and the agent's own ratings are - those two stay excluded, and the
  // rule at the top of this file still stands: nothing reaches the client page
  // unless it is named here on purpose.
  return {
    address: str(s.address, 200),
    blurb: str(s.blurb, 300),
    lat: num(s.lat),
    lng: num(s.lng),
    windowStart: cleanTime(s.windowStart),
    windowEnd: cleanTime(s.windowEnd),
  };
}

function cleanCode(v) {
  // Hyphens allowed since 2026-09-06 so custom slugs can read as words
  // ("ashland-highlights"). client-tour.html's path parser allows the same set.
  const s = str(v, 40);
  return /^[A-Za-z0-9-]+$/.test(s) ? s : '';
}

// A custom, memorable code the agent chooses instead of the random 7 characters
// - "demo" gives 804re.com/t/demo. Lowercased so the link is not case-sensitive
// to type, and kept to a shape that cannot be confused with anything else in
// the path. Minimum 3 so a stray character cannot claim a one-letter slug.
function cleanSlug(v) {
  const s = str(v, 40).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s)) return '';
  if (s.indexOf('--') !== -1) return '';
  return s;
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

  // A requested slug wins over the existing code, so a tour can be moved onto a
  // memorable link. Unlike the random-code path below, a collision here is
  // reported rather than silently worked around: asking for /t/demo and quietly
  // getting /t/aB3xQ9z would look like the feature simply did not work.
  const slug = cleanSlug(body.slug);
  if (slug) {
    const rawSlug = await env.TOURS_KV.get(TOUR_PREFIX + slug);
    let prevSlug = null;
    try { prevSlug = rawSlug ? JSON.parse(rawSlug) : null; } catch (e) { prevSlug = null; }
    const prevOwned = !!(prevSlug && prevSlug.adminKey);
    if (prevOwned && adminKey !== prevSlug.adminKey) {
      return json({ error: 'slug_taken', slug }, 409);
    }
    code = slug;
    if (prevOwned) adminKey = prevSlug.adminKey;  // keep the key that owns it
  }

  if (code && !slug) {
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
  if (!code) code = randomToken(7);
  if (!adminKey) adminKey = randomToken(20);

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

  // A slugged tour is meant to be permanent (a demo link on a business card
  // should not quietly stop working), so it is stored with no expiry. Random
  // codes keep the 2-year TTL, since those are one client on one day.
  const putOpts = slug ? {} : { expirationTtl: TTL_SECONDS };
  await env.TOURS_KV.put(TOUR_PREFIX + code, JSON.stringify(tour), putOpts);
  return json({ ok: true, code, adminKey, slug: slug || '' });
}

// Remove a published tour page.
//
// Needed because a slugged tour is stored with NO expiry, so a test or an
// abandoned demo would otherwise sit on a memorable link forever with no way
// to take it down. Random-code tours age out on their own after two years;
// this is the way to remove either kind on purpose.
//
// Requires the adminKey, exactly like re-publishing does. Deleting is at least
// as destructive as overwriting, and this endpoint is public, so it gets the
// same gate - a caller who only knows the code (which is the client link, and
// therefore not a secret) can delete nothing.
//
// The client's feedback is deleted alongside the tour rather than left behind:
// once the page is gone the feedback is unreadable anyway, and leaving what
// someone typed in confidence sitting in storage is the wrong default.
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.TOURS_KV) return notConfigured();

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: 'invalid_json' }, 400);
  }

  const code = cleanCode(body && body.code);
  const adminKey = cleanCode(body && body.adminKey);
  if (!code) return json({ error: 'missing_code' }, 400);
  if (!adminKey) return json({ error: 'missing_key' }, 400);

  const raw = await env.TOURS_KV.get(TOUR_PREFIX + code);
  if (!raw) return json({ error: 'not_found' }, 404);

  let prev = null;
  try { prev = JSON.parse(raw); } catch (e) { prev = null; }
  // A record with no stored key has no owner and cannot be proven either way;
  // treat it as deletable, matching how publish lets such a slug be reclaimed.
  if (prev && prev.adminKey && prev.adminKey !== adminKey) {
    return json({ error: 'wrong_key' }, 403);
  }

  await env.TOURS_KV.delete(TOUR_PREFIX + code);
  await env.TOURS_KV.delete(FB_PREFIX + code);
  return json({ ok: true, code, deletedFeedback: true });
}
