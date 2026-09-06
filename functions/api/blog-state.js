// functions/api/blog-state.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// State store for the blog workbench at /blog-desk. Holds the idea catalog
// (every scraped topic and where it is in the pipeline), the list of source
// feeds, the "already seen" URL memory that stops the same article being
// offered twice, and the published-post corpus used for the cannibalisation
// check.
//
// It REUSES the "DEV_ORDER_KV" binding under a new key ("blog-state"), the
// same way dev-cards.js / dev-notes.js / dev-order.js share that namespace.
// See CLAUDE.md: related hub state goes in one namespace under different keys
// rather than asking for another Cloudflare dashboard setup step. If the
// binding is missing this answers { state: null, error: "KV not bound" } and
// blog-desk.html falls back to that browser's localStorage, exactly like the
// other three do. Nothing hard-fails.
//
// Shape stored under the single "blog-state" key:
//   {
//     v: 1,
//     ideas:   [ { id, title, url, source, sourceType, found, score, scoreWhy[],
//                  cluster, keyword, depth, status, notes, keyPoints,
//                  scheduled, publishedUrl, refreshOf } ],
//     sources: [ { id, label, type, url, enabled } ],
//     corpus:  [ { title, url, date, origin } ],   // published posts, for dedupe
//     seen:    [ "<url>", ... ],                   // capped, FIFO
//     settings:{ cadence, phaseStart, rampWeeks }
//   }
//
// No auth, for the same reason as the other dev endpoints: /blog-desk is
// noindex/nofollow, unlinked, and this holds no personal or lead data — only
// article ideas and public URLs. Add a shared-secret header check before
// trusting the body if that ever stops being true.

const STATE_KEY = 'blog-state';
const MAX_IDEAS = 400;
const MAX_CORPUS = 500;
const MAX_SEEN = 2000;
const MAX_SOURCES = 40;
const MAX_STR = 2000;

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

function num(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function cleanId(v) {
  const s = str(v, 80).trim().toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '');
  return s || '';
}

// Only http(s) URLs are stored. Anything else (javascript:, data:) is dropped
// rather than trusted, because these strings are written straight into an
// href on the workbench page.
function cleanUrl(v) {
  const s = str(v, 500).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function cleanDate(v) {
  const s = str(v, 10).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// The five pipeline columns plus the refresh lane. An unknown status would
// render as a card in no column at all, so it is normalised to 'idea'.
const STATUSES = ['idea', 'approved', 'drafted', 'scheduled', 'published', 'refresh', 'discarded'];
function cleanStatus(v) {
  return STATUSES.indexOf(v) >= 0 ? v : 'idea';
}

const CLUSTERS = ['buyer', 'seller', 'money', 'local', 'market', 'general'];
function cleanCluster(v) {
  return CLUSTERS.indexOf(v) >= 0 ? v : 'general';
}

const DEPTHS = ['short', 'standard', 'long'];
function cleanDepth(v) {
  return DEPTHS.indexOf(v) >= 0 ? v : 'standard';
}

const SOURCE_TYPES = ['media', 'forum', 'video', 'local', 'own'];
function cleanSourceType(v) {
  return SOURCE_TYPES.indexOf(v) >= 0 ? v : 'media';
}

// The five things that decide whether a post earns anything, per the editorial
// rules agreed 2026-09-06. Kept in sync with CHECKLIST in blog-desk.html.
const CHECK_KEYS = ['ownData', 'localKnowledge', 'answerFirst', 'faqSchema', 'primarySource'];

function cleanChecks(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  CHECK_KEYS.forEach(function (k) { if (o[k]) out[k] = true; });
  return out;
}

function cleanIdea(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanId(o.id),
    title: str(o.title, 300),
    url: cleanUrl(o.url),
    source: str(o.source, 80),
    sourceType: cleanSourceType(o.sourceType),
    found: cleanDate(o.found),
    score: num(o.score, 0, 100),
    scoreWhy: Array.isArray(o.scoreWhy)
      ? o.scoreWhy.map(function (s) { return str(s, 120); }).filter(Boolean).slice(0, 10)
      : [],
    cluster: cleanCluster(o.cluster),
    keyword: str(o.keyword, 160),
    depth: cleanDepth(o.depth),
    status: cleanStatus(o.status),
    notes: str(o.notes, MAX_STR),
    keyPoints: str(o.keyPoints, MAX_STR),
    // What to go photograph for this post. Original local photos are the one
    // image asset a competitor cannot copy, so the shot is decided on the card
    // rather than settled for with stock at drafting time.
    photo: str(o.photo, 600),
    // The "what makes this post win" checklist, as { key: true }. Only the
    // known keys survive, so a stale or hand-edited key cannot render a
    // phantom row on the card.
    checks: cleanChecks(o.checks),
    // Primary sources kept off the source article: { url, host, label, why }.
    cited: Array.isArray(o.cited)
      ? o.cited.slice(0, 20).map(function (c) {
          const x = c && typeof c === 'object' ? c : {};
          return { url: cleanUrl(x.url), host: str(x.host, 120), label: str(x.label, 160), why: str(x.why, 400) };
        }).filter(function (c) { return c.url; })
      : [],
    scheduled: cleanDate(o.scheduled),
    publishedUrl: cleanUrl(o.publishedUrl),
    refreshOf: cleanUrl(o.refreshOf),
  };
}

function cleanSource(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanId(o.id),
    label: str(o.label, 80),
    type: cleanSourceType(o.type),
    url: cleanUrl(o.url),
    enabled: o.enabled !== false,
  };
}

function cleanCorpusItem(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    title: str(o.title, 300),
    url: cleanUrl(o.url),
    date: cleanDate(o.date),
    origin: str(o.origin, 60),
  };
}

function cleanState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const set = s.settings && typeof s.settings === 'object' ? s.settings : {};
  return {
    v: 1,
    ideas: Array.isArray(s.ideas)
      ? s.ideas.slice(0, MAX_IDEAS).map(cleanIdea).filter(function (i) { return i.id && i.title; })
      : [],
    sources: Array.isArray(s.sources)
      ? s.sources.slice(0, MAX_SOURCES).map(cleanSource).filter(function (i) { return i.id && i.url; })
      : [],
    corpus: Array.isArray(s.corpus)
      ? s.corpus.slice(0, MAX_CORPUS).map(cleanCorpusItem).filter(function (i) { return i.title; })
      : [],
    // FIFO: the newest entries are kept when the cap is hit, because an old
    // article resurfacing years later is a fine thing to be offered again.
    seen: Array.isArray(s.seen)
      ? s.seen.map(cleanUrl).filter(Boolean).slice(-MAX_SEEN)
      : [],
    settings: {
      cadence: str(set.cadence, 30) || 'ramp',
      phaseStart: cleanDate(set.phaseStart),
      rampWeeks: num(set.rampWeeks, 0, 52) || 12,
    },
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const env = context.env;
  try {
    if (!env.DEV_ORDER_KV) return json({ state: null, error: 'KV not bound' });
    const raw = await env.DEV_ORDER_KV.get(STATE_KEY);
    return json({ state: raw ? cleanState(JSON.parse(raw)) : cleanState(null) });
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
    await env.DEV_ORDER_KV.put(STATE_KEY, JSON.stringify(state));
    return json({ ok: true, state: state });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}
