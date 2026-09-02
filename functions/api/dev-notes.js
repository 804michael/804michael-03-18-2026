// functions/api/dev-notes.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// Stores/retrieves the notes Michael types directly into the "Notes &
// Ideas" panel on /dev (dev.html) via its "Add a note" box — separate
// from the small set of curated notes that are hand-written into
// dev.html's own HTML and edited by Claude on request. This is what lets
// Michael jot something from his phone and have it show up on his
// laptop too.
//
// REUSES the SAME KV binding as dev-order.js: DEV_ORDER_KV. If that
// binding is already set up (see dev-order.js's own top comment for the
// one-time Cloudflare dashboard steps — Workers KV → create a namespace
// → bind it to this Pages project as DEV_ORDER_KV), this works with NO
// extra setup: it just stores its data under a different key in the same
// KV namespace. If the binding isn't set up yet, this fails the same way
// dev-order.js does — { notes: [], error: "KV not bound" } — and
// dev.html falls back to a localStorage-only notes list (per-browser,
// not synced, same tradeoff as the card order before its KV binding
// existed).
//
// Data shape: a JSON array under key "notes-list", each entry
// { id, text, date } — date is "YYYY-MM-DD", set server-side at write
// time so it's consistent no matter what device/timezone added it.
//
// No auth on this endpoint, same reasoning as dev-order.js: the page is
// noindex/nofollow/unlinked, and worst case someone spams junk text into
// an internal notes list — annoying, not sensitive. Revisit if that ever
// changes.

const NOTES_KEY = 'notes-list';
const MAX_NOTES = 100;       // sanity cap on how many notes are kept
const MAX_TEXT_LEN = 2000;   // sanity cap per note

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function readNotes(env) {
  const raw = await env.DEV_ORDER_KV.get(NOTES_KEY);
  const notes = raw ? JSON.parse(raw) : [];
  return Array.isArray(notes) ? notes : [];
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const env = context.env;
  try {
    if (!env.DEV_ORDER_KV) {
      return json({ notes: [], error: 'KV not bound' });
    }
    const notes = await readNotes(env);
    return json({ notes: notes });
  } catch (err) {
    return json({ notes: [], error: String(err && err.message || err) });
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
    const text = body && typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return json({ ok: false, error: 'Empty note' }, 400);
    }
    if (text.length > MAX_TEXT_LEN) {
      return json({ ok: false, error: 'Note too long' }, 400);
    }

    const notes = await readNotes(env);
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: text,
      date: todayStr(),
    };
    notes.unshift(note); // newest first
    if (notes.length > MAX_NOTES) {
      notes.length = MAX_NOTES;
    }

    await env.DEV_ORDER_KV.put(NOTES_KEY, JSON.stringify(notes));
    return json({ ok: true, notes: notes });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

export async function onRequestDelete(context) {
  const env = context.env;
  const request = context.request;
  try {
    if (!env.DEV_ORDER_KV) {
      return json({ ok: false, error: 'KV not bound' });
    }
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return json({ ok: false, error: 'Missing id' }, 400);
    }

    const notes = await readNotes(env);
    const filtered = notes.filter(function (n) { return n.id !== id; });
    await env.DEV_ORDER_KV.put(NOTES_KEY, JSON.stringify(filtered));
    return json({ ok: true, notes: filtered });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}
