// functions/api/dev-cards.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// This Cloudflare Pages Function stores the edits Michael makes to the /dev
// staging hub's project cards straight from the page itself (dev.html): the
// per-card overrides applied on top of the cards written into the HTML, any
// brand-new cards added from the page, and the ids of cards hidden from view.
//
// It deliberately REUSES the same "DEV_ORDER_KV" binding as dev-order.js and
// dev-notes.js — just a different key in the same namespace ("cards-state"
// vs. "card-order" / "notes-list"). Same reasoning as dev-notes.js: this is
// conceptually one more small blob of hub state, and asking for a second
// Cloudflare dashboard setup step for it would be pointless friction. If the
// binding is already done for the drag order, this works with zero extra
// setup. If it isn't, this responds { state: null, error: "KV not bound" }
// and dev.html falls back to that browser's localStorage only, exactly like
// the drag order and notes already do.
//
// Shape stored under the single "cards-state" key:
//   {
//     overrides: { "<card-id>": { title, badge, badgeKind, desc, bullets[], href } },
//     added:     [ { id, title, badge, badgeKind, desc, bullets[], href } ],
//     hidden:    [ "<card-id>", ... ]
//   }
// "overrides" only ever holds the fields that differ from the HTML, so a card
// never edited from the page has no entry at all and keeps whatever the repo
// says — which means editing dev.html by hand still works normally, as long
// as that card hasn't been overridden from the page.
//
// No auth, for the same reason as dev-order.js/dev-notes.js: the page is
// noindex/nofollow, unlinked from the live site, and this holds no personal
// or lead data — only labels for internal project cards. Add a shared-secret
// header check before trusting the body if that ever stops being true.

const CARDS_KEY = 'cards-state';
const MAX_CARDS = 60;
const MAX_BULLETS = 12;
const MAX_STR = 600;

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

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max || MAX_STR);
}

function cleanId(v) {
  const s = str(v, 80).trim().toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '');
  return s || '';
}

function cleanBadgeKind(v) {
  // Mirrors the three badge styles dev.html's CSS actually defines. Anything
  // else would render as the default red pill with a dead class name, so it's
  // normalised here rather than trusted.
  return v === 'unlinked' || v === 'review' ? v : '';
}

// Dates are stored as plain YYYY-MM-DD strings. Anything that is not exactly
// that shape is dropped rather than trusted, so a bad value can never reach
// the page as markup.
function cleanDate(v) {
  const s = str(v, 10).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function cleanCardFields(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    title: str(o.title, 120),
    badge: str(o.badge, 40),
    badgeKind: cleanBadgeKind(o.badgeKind),
    desc: str(o.desc, MAX_STR),
    bullets: Array.isArray(o.bullets)
      ? o.bullets.map(function (b) { return str(b, 300); }).filter(Boolean).slice(0, MAX_BULLETS)
      : [],
    href: str(o.href, 300),
    created: cleanDate(o.created),
    edited: cleanDate(o.edited),
  };
}

function cleanState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const overrides = {};
  if (s.overrides && typeof s.overrides === 'object') {
    Object.keys(s.overrides).slice(0, MAX_CARDS).forEach(function (k) {
      const id = cleanId(k);
      if (id) overrides[id] = cleanCardFields(s.overrides[k]);
    });
  }
  const added = Array.isArray(s.added)
    ? s.added.slice(0, MAX_CARDS).map(function (c) {
        const fields = cleanCardFields(c);
        fields.id = cleanId(c && c.id);
        return fields;
      }).filter(function (c) { return c.id && c.title; })
    : [];
  const hidden = Array.isArray(s.hidden)
    ? s.hidden.map(cleanId).filter(Boolean).slice(0, MAX_CARDS)
    : [];
  return { overrides: overrides, added: added, hidden: hidden };
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const env = context.env;
  try {
    if (!env.DEV_ORDER_KV) return json({ state: null, error: 'KV not bound' });
    const raw = await env.DEV_ORDER_KV.get(CARDS_KEY);
    return json({ state: raw ? cleanState(JSON.parse(raw)) : { overrides: {}, added: [], hidden: [] } });
  } catch (err) {
    return json({ state: null, error: String((err && err.message) || err) });
  }
}

export async function onRequestPost(context) {
  const env = context.env;
  const request = context.request;
  try {
    if (!env.DEV_ORDER_KV) return json({ ok: false, error: 'KV not bound' });
    const body = await request.json().catch(function () { return null; });
    if (!body || !body.state) return json({ ok: false, error: 'Invalid payload' }, 400);
    const state = cleanState(body.state);
    await env.DEV_ORDER_KV.put(CARDS_KEY, JSON.stringify(state));
    return json({ ok: true, state: state });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}
