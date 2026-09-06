// functions/api/blog-scan.js
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// The ingestion half of the blog workbench at /blog-desk. It fetches a list of
// public RSS/Atom feeds server-side, turns each entry into a scored article
// IDEA, and hands them back. It stores nothing — blog-state.js owns all state.
// Keeping the scan stateless means a bad scan can never corrupt the catalog:
// the page merges what it likes and saves that.
//
// Why server-side at all: same reason as county-lookup.js and heigit-status.js
// — none of these feeds send CORS headers, so the browser cannot read them
// directly. This is a plain proxy-and-parse, no key and no binding needed.
//
// WHAT "SCRAPING" MEANS HERE: this reads public feed metadata (title, link,
// date) and uses it as a TOPIC SIGNAL only. It never stores or republishes
// source body text. Articles are written from scratch against Michael's own
// angle. That keeps the pipeline clear of both duplicate-content penalties and
// copyright.
//
// Modes (all GET except the scan itself, which accepts either):
//   ?mode=sources  -> the built-in default feed list, for seeding the page
//   ?mode=corpus   -> Michael's already-published posts on michaelhottman.com,
//                     used as the cannibalisation corpus. Tries the WordPress
//                     REST API first and falls back to that site's RSS feed.
//   (no mode)      -> scan the default feeds
//   POST {sources} -> scan the caller's own feed list (what the page sends,
//                     since the list is editable and lives in KV)
//
// Nothing hard-fails, per the contract in CLAUDE.md. A dead feed, a timeout, a
// 403 from Reddit or a parse error takes that ONE source out and is reported in
// the "sources" array with its error string. The scan still returns everything
// the other feeds produced. A total wipeout returns an empty candidate list
// with 200, never a 5xx, so the page can show what happened instead of a
// broken button.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// A browser-ish UA is not optional: Reddit and several publisher CDNs answer
// 403 to a bare fetch. The contact URL is there so anyone reading their logs
// can see who this is.
const UA = 'Mozilla/5.0 (compatible; 804re-blogscan/1.0; +https://804re.com/)';

const FEED_TIMEOUT_MS = 9000;
// Raised from 260k after Bankrate's feed (1.2MB, full article bodies inline)
// truncated INSIDE its first <item> and parsed to nothing. The cap is applied
// after stripBodies() below, which throws away the article text this scan
// never looks at, so the number that matters is post-strip size, not wire size.
const MAX_WIRE_CHARS = 1600000;
const MAX_BODY_CHARS = 300000;
const MAX_ITEMS_PER_FEED = 20;
const MAX_PER_SOURCE = 12;
const MAX_CANDIDATES = 160;
// Reddit rate-limits a burst from one IP: firing both subreddits in the same
// tick returned 429 on the second every time. Forum feeds are therefore walked
// one at a time with a gap, while everything else still runs in parallel.
const FORUM_GAP_MS = 3500;

// ── Default sources ────────────────────────────────────────────────────────
// Every one of these was fetched and confirmed to answer 200 with parseable
// XML on 2026-09-06. The page stores its own editable copy in KV, so changing
// this list only affects a fresh seed or an explicit "restore defaults".
// Deliberately NOT included, and why:
//   zillow.com/research/feed     -> 403 to non-browser clients
//   bankrate.com/mortgages/feed  -> answers 200 with an HTML page, not a feed.
//                                   Checking the status code alone said it was
//                                   fine; only parsing it showed it was not.
//   mortgagenewsdaily.com/rss    -> same, HTML behind a feed-looking URL
//   magazine.realtor/feed        -> same
//   r/RealEstateInvesting        -> 403 on .rss, unlike the other two subreddits
const DEFAULT_SOURCES = [
  { id: 'realtor-news',    label: 'Realtor.com News',    type: 'media', url: 'https://www.realtor.com/news/feed/',        enabled: true },
  { id: 'housingwire',     label: 'HousingWire',         type: 'media', url: 'https://www.housingwire.com/feed/',         enabled: true },
  { id: 'redfin-news',     label: 'Redfin News',         type: 'media', url: 'https://www.redfin.com/news/feed/',         enabled: true },
  { id: 'nerdwallet',      label: 'NerdWallet',          type: 'media', url: 'https://www.nerdwallet.com/blog/feed/',     enabled: true },
  { id: 'mortgagereports', label: 'The Mortgage Reports', type: 'media', url: 'https://themortgagereports.com/feed',      enabled: true },
  { id: 'kcm',             label: 'Keeping Current Mkts', type: 'media', url: 'https://www.simplifyingthemarket.com/en/feed', enabled: true },
  { id: 'cnbc-re',         label: 'CNBC Real Estate',    type: 'media', url: 'https://www.cnbc.com/id/10000115/device/rss/rss.html', enabled: true },

  { id: 'reddit-re',       label: 'r/RealEstate',        type: 'forum', url: 'https://www.reddit.com/r/RealEstate/top/.rss?t=week',        enabled: true },
  { id: 'reddit-ftb',      label: 'r/FirstTimeHomeBuyer', type: 'forum', url: 'https://www.reddit.com/r/FirstTimeHomeBuyer/top/.rss?t=week', enabled: true },

  { id: 'yt-wthyl',        label: 'Win The House You Love', type: 'video', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCkIdUg2r0FwwcN_0zNJ1KUg', enabled: true },
  { id: 'yt-jackiebaker',  label: 'Jackie Baker',        type: 'video', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCjzlHyzN-3sUfHTJvwtbgPA', enabled: true },
  { id: 'yt-graham',       label: 'Graham Stephan',      type: 'video', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCa-ckhlKL98F8YXKQ-BALiw', enabled: true },

  { id: 'rva-bizsense',    label: 'Richmond BizSense',   type: 'local', url: 'https://richmondbizsense.com/feed/',        enabled: true },

  // Michael's own former (Paperless Agent) site. Pulled for two reasons: it is
  // a topic source in its own right, and its 112 posts are the main
  // cannibalisation corpus — see ?mode=corpus below.
  { id: 'michaelhottman',  label: 'michaelhottman.com',  type: 'own',   url: 'http://michaelhottman.com/feed/',           enabled: true },
];

// HTTPS first so this starts working by itself the day michaelhottman.com gets
// a certificate. Today it has no TLS listener at all, and Cloudflare upgrades
// outbound http:// subrequests, so BOTH of these currently fail from the
// runtime with a 421 even though plain http works fine from a laptop. When
// they fail the page falls back to /blog-corpus.json, a baked snapshot in the
// repo. See the note in that file.
const CORPUS_HOSTS = ['https://michaelhottman.com', 'http://michaelhottman.com'];
const CORPUS_WP_PATH = '/wp-json/wp/v2/posts';
const CORPUS_RSS_PATH = '/feed/';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

// ── Text helpers ───────────────────────────────────────────────────────────

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      const n = parseInt(h, 16);
      return n > 0 && n < 0x10000 ? String.fromCharCode(n) : '';
    })
    .replace(/&#(\d+);/g, function (_, d) {
      const n = parseInt(d, 10);
      return n > 0 && n < 0x10000 ? String.fromCharCode(n) : '';
    })
    .replace(/&([a-z]+);/gi, function (m, name) {
      const k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
}

function cleanText(s) {
  return decodeEntities(
    String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function tagText(block, tag) {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? cleanText(m[1]) : '';
}

function toIsoDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// ── Feed parsing ───────────────────────────────────────────────────────────
// Handles RSS 2.0 (<item>) and Atom (<entry>), which between them cover every
// feed in the default list. YouTube and Reddit are both Atom; the publishers
// are all RSS.

function parseFeed(xml) {
  const out = [];
  const isAtom = /<entry[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];

  for (let i = 0; i < blocks.length && out.length < MAX_ITEMS_PER_FEED; i++) {
    const b = blocks[i];
    const title = tagText(b, 'title');
    if (!title) continue;

    let link = '';
    if (isAtom) {
      // Atom puts the URL in an attribute. Prefer rel="alternate"; YouTube and
      // Reddit both use it, and taking the first <link> blindly would grab a
      // self/edit link on some feeds.
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
        || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? decodeEntities(alt[1]) : '';
    } else {
      link = tagText(b, 'link');
    }
    if (!/^https?:\/\//i.test(link)) continue;

    const date = toIsoDate(
      tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date')
    );

    out.push({ title: title, url: link, date: date });
  }
  return out;
}

// The scan only ever reads a title, a link and a date. Article bodies are the
// bulk of most feeds and are dropped here before anything else touches them:
// it keeps big feeds under the size cap, and it means source prose is never
// held in memory, let alone stored. See the note at the top of this file.
function stripBodies(xml) {
  return xml
    .replace(/<content:encoded[\s\S]*?<\/content:encoded>/gi, '')
    .replace(/<description[\s\S]*?<\/description>/gi, '')
    .replace(/<summary[\s\S]*?<\/summary>/gi, '')
    .replace(/<media:group[\s\S]*?<\/media:group>/gi, '');
}

async function fetchText(url, opts) {
  const raw = opts && opts.raw;
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8, */*;q=0.5' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = (await res.text()).slice(0, MAX_WIRE_CHARS);
    // JSON callers (the corpus fetch) must not have their payload mangled.
    return raw ? text : stripBodies(text).slice(0, MAX_BODY_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ── Scoring ────────────────────────────────────────────────────────────────
// An HONEST heuristic, not search volume. Real volume needs Search Console
// (free, but only once the blog has traffic) or a paid keyword tool. This
// ranks on the signals actually available from a feed, and every card carries
// the reasons so a bad score can be argued with rather than trusted.

const STOP = new Set(('a an and are as at be but by for from has have how i in is it its of on or that the this to was what when where which who why with you your ' +
  'will can do does should could would if not your youre about into more most new now than then them they their there these those our we us me my').split(' '));

function tokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 2 && !STOP.has(w); })
    .map(function (w) { return w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''); });
}

function tokenSet(s) {
  return new Set(tokens(s));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(function (t) { if (b.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

const LOCAL_RE = /\b(richmond|rva|henrico|hanover|ashland|glen allen|mechanicsville|chesterfield|midlothian|short pump|virginia|va\b)/i;
const MONEY_RE = /\b(cost|costs|price|pricing|rate|rates|fee|fees|tax|taxes|afford|affordability|mortgage|loan|down payment|insurance|escrow|closing|budget|save|savings|worth|value|equity|refinanc)/i;
const QUESTION_RE = /^(how|what|why|when|where|should|can|is|are|do|does|will|which)\b|\?/i;
const SELLER_RE = /\b(sell|selling|seller|list|listing|stage|staging|offer on my|home value|appraisal)/i;
const BUYER_RE = /\b(buy|buying|buyer|first[- ]time|house hunt|home search|offer|bid|inspection|walkthrough)/i;
const MARKET_RE = /\b(market|forecast|trend|inventory|report|index|outlook|quarter|q[1-4]\b|month|week)/i;
const NEWSY_RE = /\b(this week|today|yesterday|breaking|announces|announced|q[1-4] 20\d\d|earnings|stock|shares|ipo|lawsuit|nasdaq|nyse)\b/i;
const LISTING_RE = /\b(for sale|just listed|open house|sold for|\$[\d,]+ home|mansion|penthouse|celebrity)\b/i;
// A forum post written as one person's specific situation ("should I take my
// agent to court over...") is a topic only after it is reframed as the general
// question underneath it. Still worth surfacing, just not at the top.
const PERSONAL_RE = /\b(i|i'm|im|i've|ive|my|our|we|we're|us)\b/i;
// Another state's statute or a metric-unit lot size is somebody else's
// audience. Cheap guard against the worst of the off-target forum noise.
const OFFTARGET_RE = /\b(sqm|hectare|ontario|alberta|bc\b|uk\b|australia|ohio|texas|florida|california|colorado|arizona|nevada|oregon|washington state|new york|nj\b|illinois)\b/i;

// Relevance gate. Several sources are only PARTLY about housing: Richmond
// BizSense covers every local business (it offered a sandwich-chain expansion
// as a top idea), NerdWallet covers all personal finance, CNBC's feed drifts
// into markets. An item that matches nothing here is dropped outright rather
// than scored low, because a catalog is only useful if everything in it is a
// plausible post. Forum sources skip the gate: the subreddits are already
// topic-scoped, and their titles often omit the obvious noun.
const RELEVANT_RE = /\b(home|homes|house|housing|mortgage|rent|rental|renter|real estate|realtor|property|properties|buyer|buying|seller|selling|condo|townhome|apartment|listing|escrow|closing cost|down payment|equity|refinanc|landlord|hoa|appraisal|appraiser|inspection|foreclosure|deed|title|zoning|neighborhood|square foot|square feet|realty|broker|agent|move|moving|relocat|interest rate|mortgage rate|first[- ]time)/i;

function isRelevant(title, sourceType) {
  if (sourceType === 'forum' || sourceType === 'own') return true;
  return RELEVANT_RE.test(title);
}

function classify(title) {
  if (LOCAL_RE.test(title)) return 'local';
  if (SELLER_RE.test(title)) return 'seller';
  if (BUYER_RE.test(title)) return 'buyer';
  if (MONEY_RE.test(title)) return 'money';
  if (MARKET_RE.test(title)) return 'market';
  return 'general';
}

// Depth tier. Local topics win at short length because nobody else is writing
// them; a topic several national outlets are all covering is by definition
// competitive and needs the long treatment to rank at all.
//
// Driven by cross-source count rather than raw score (changed before first
// deploy): scoring off `score >= 70` marked every Reddit question "long",
// because the forum and question bonuses stacked. Competition is what should
// decide length, and cross-source count is the only real measure of it here.
function depthFor(cluster, sourceType, crossCount) {
  if (cluster === 'local') return 'short';
  if (crossCount >= 2) return 'long';
  if (sourceType === 'forum') return 'standard';
  if (crossCount >= 1) return 'long';
  return 'standard';
}

function daysAgo(iso) {
  if (!iso) return 999;
  const then = new Date(iso + 'T00:00:00Z').getTime();
  if (isNaN(then)) return 999;
  return Math.max(0, Math.round((Date.now() - then) / 86400000));
}

function scoreItem(item, sourceType, crossCount) {
  const t = item.title;
  let score = 30;
  const why = [];

  if (crossCount >= 1) {
    const bump = Math.min(24, crossCount * 9);
    score += bump;
    why.push(crossCount + ' other source' + (crossCount > 1 ? 's' : '') + ' raised this (+' + bump + ')');
  }

  // A post that reached a subreddit's weekly top IS the engagement signal. The
  // .rss feed does not expose vote counts, so this is the honest substitute.
  //
  // Deliberately does NOT stack with the question bonus below. At +16 plus +12
  // for question shape, every Reddit thread outscored every media article and
  // the top of the list was nothing but r/RealEstate. Forum titles are almost
  // always questions, so the two bonuses were measuring the same thing twice.
  if (sourceType === 'forum') {
    score += 8;
    why.push('Reddit weekly top (+8)');
  } else if (QUESTION_RE.test(t)) {
    score += 12;
    why.push('Question-shaped title (+12)');
  }
  if (MONEY_RE.test(t)) {
    score += 10;
    why.push('Money/commercial intent (+10)');
  }
  if (LOCAL_RE.test(t)) {
    score += 15;
    why.push('Local angle, low competition (+15)');
  }

  const age = daysAgo(item.date);
  if (age <= 7) { score += 10; why.push('Published this week (+10)'); }
  else if (age <= 30) { score += 5; why.push('Published this month (+5)'); }

  if (NEWSY_RE.test(t)) {
    score -= 14;
    why.push('News-pegged, ages fast (-14)');
  } else {
    score += 6;
    why.push('Evergreen framing (+6)');
  }

  if (LISTING_RE.test(t)) {
    score -= 20;
    why.push('Reads as a listing/celebrity piece (-20)');
  }
  if (PERSONAL_RE.test(t)) {
    score -= 10;
    why.push('One person’s situation, needs reframing (-10)');
  }
  if (OFFTARGET_RE.test(t)) {
    score -= 12;
    why.push('Another market’s audience (-12)');
  }
  if (t.length < 25) {
    score -= 8;
    why.push('Thin title (-8)');
  }
  if (t.length > 95) {
    score -= 6;
    why.push('Rambling title (-6)');
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), why: why };
}

// The target keyword guess: the meaningful words of the title, trimmed. It is
// a starting point for Michael to correct on the card, not an oracle.
function keywordGuess(title) {
  return tokens(title).slice(0, 6).join(' ');
}

function slugId(url, title) {
  const base = (title || url).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // A short hash of the URL keeps two same-titled items from different sources
  // apart, which a slug alone would collide.
  let h = 0;
  for (let i = 0; i < url.length; i++) { h = ((h << 5) - h + url.charCodeAt(i)) | 0; }
  return (base || 'idea') + '-' + Math.abs(h).toString(36).slice(0, 6);
}

// ── Scan ───────────────────────────────────────────────────────────────────

async function runScan(sources) {
  const today = new Date().toISOString().slice(0, 10);

  async function pull(s, isRetry) {
    try {
      const xml = await fetchText(s.url);
      const items = parseFeed(xml);
      if (!items.length) throw new Error('no items parsed');
      return { source: s, items: items, ok: true, error: '' };
    } catch (err) {
      const msg = String((err && err.message) || err);
      // One backoff retry on a rate-limit only. Reddit answers 429 to the
      // second subreddit even with a gap between them when the caller has been
      // active recently; waiting it out usually works and costs one pause.
      if (!isRetry && /\b429\b/.test(msg)) {
        await sleep(4000);
        return pull(s, true);
      }
      return { source: s, items: [], ok: false, error: /abort/i.test(msg) ? 'timed out' : msg };
    }
  }

  // Forum feeds go one at a time with a gap (Reddit 429s a burst from one IP);
  // everything else is fetched in parallel. Both halves run concurrently, so
  // the extra wait costs nothing overall.
  const forums = sources.filter(function (s) { return s.type === 'forum'; });
  const rest = sources.filter(function (s) { return s.type !== 'forum'; });

  const forumRun = (async function () {
    const acc = [];
    for (let i = 0; i < forums.length; i++) {
      if (i > 0) await sleep(FORUM_GAP_MS);
      acc.push(await pull(forums[i]));
    }
    return acc;
  })();

  const parts = await Promise.all([Promise.all(rest.map(pull)), forumRun]);
  // Restore the caller's original source order so the status list reads the
  // way the settings panel is laid out.
  const byId = new Map();
  parts[0].concat(parts[1]).forEach(function (r) { byId.set(r.source.id, r); });
  const results = sources.map(function (s) {
    return byId.get(s.id) || { source: s, items: [], ok: false, error: 'not run' };
  });

  // Flatten first, so cross-source frequency can be measured across everything
  // that came back in this one scan.
  const flat = [];
  let dropped = 0;
  results.forEach(function (r) {
    r.items.forEach(function (it) {
      if (!isRelevant(it.title, r.source.type)) { dropped++; return; }
      flat.push({ title: it.title, url: it.url, date: it.date, src: r.source, toks: tokenSet(it.title) });
    });
  });

  // How many OTHER sources raised a near-identical topic. This is the closest
  // thing to a demand signal available without a paid keyword API: when four
  // outlets write the same story in a week, people are asking about it.
  flat.forEach(function (a) {
    const hit = new Set();
    flat.forEach(function (b) {
      if (a === b || b.src.id === a.src.id) return;
      if (jaccard(a.toks, b.toks) >= 0.5) hit.add(b.src.id);
    });
    a.cross = hit.size;
  });

  const scored = flat.map(function (a) {
    const sc = scoreItem({ title: a.title, date: a.date }, a.src.type, a.cross);
    const cluster = classify(a.title);
    return {
      id: slugId(a.url, a.title),
      title: a.title,
      url: a.url,
      source: a.src.label,
      sourceType: a.src.type,
      found: today,
      published: a.date,
      score: sc.score,
      scoreWhy: sc.why,
      cluster: cluster,
      keyword: keywordGuess(a.title),
      depth: depthFor(cluster, a.src.type, a.cross),
      status: 'idea',
      notes: '',
      keyPoints: '',
      photo: '',
      scheduled: '',
      publishedUrl: '',
      refreshOf: '',
    };
  });

  scored.sort(function (x, y) { return y.score - x.score; });

  // Per-source cap. Without it a single busy feed (r/RealEstate posts 20 a
  // week, CNBC 20 a day) fills the catalog on its own and the quieter local
  // sources never surface, which is the opposite of what the scan is for.
  const perSource = {};
  const candidates = scored.filter(function (c) {
    const n = (perSource[c.source] || 0) + 1;
    perSource[c.source] = n;
    return n <= MAX_PER_SOURCE;
  });

  return {
    candidates: candidates.slice(0, MAX_CANDIDATES),
    sources: results.map(function (r) {
      return { id: r.source.id, label: r.source.label, type: r.source.type, ok: r.ok, count: r.items.length, error: r.error };
    }),
    scanned: today,
    dropped: dropped,
  };
}

// ── Corpus (already-published posts, for the cannibalisation check) ─────────
// michaelhottman.com is a WordPress site, so the REST API gives every post
// title and date in two calls. If that is ever locked down, the RSS feed still
// gives the most recent handful, which is better than nothing.
//
// Known risk: that site is HTTP-only (it has no TLS listener on 443 at all —
// see the note in the reply that shipped this file). If Cloudflare's runtime
// ever refuses plain-http subrequests, this degrades to source:'none' and the
// workbench simply has no corpus until the site gets a certificate.

async function fetchCorpus() {
  const errors = [];

  for (let h = 0; h < CORPUS_HOSTS.length; h++) {
    const host = CORPUS_HOSTS[h];

    // WordPress REST API: every post in two calls.
    try {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const url = host + CORPUS_WP_PATH + '?per_page=100&page=' + page + '&_fields=title,link,date';
        const rows = JSON.parse(await fetchText(url, { raw: true }));
        if (!Array.isArray(rows) || !rows.length) break;
        rows.forEach(function (r) {
          const title = cleanText((r && r.title && r.title.rendered) || '');
          const link = String((r && r.link) || '');
          if (title && /^https?:\/\//i.test(link)) {
            out.push({ title: title, url: link, date: toIsoDate(r.date), origin: 'michaelhottman.com' });
          }
        });
        if (rows.length < 100) break;
      }
      if (out.length) return { corpus: out, source: 'wp-json (' + host.split(':')[0] + ')' };
    } catch (err) {
      errors.push(host.split(':')[0] + ' wp-json: ' + String((err && err.message) || err));
    }

    // RSS gives only the recent handful, but that is better than nothing.
    try {
      const out = [];
      parseFeed(await fetchText(host + CORPUS_RSS_PATH)).forEach(function (it) {
        out.push({ title: it.title, url: it.url, date: it.date, origin: 'michaelhottman.com' });
      });
      if (out.length) return { corpus: out, source: 'rss (' + host.split(':')[0] + ')' };
    } catch (err) {
      errors.push(host.split(':')[0] + ' rss: ' + String((err && err.message) || err));
    }
  }

  // Nothing reachable. The page falls back to the baked /blog-corpus.json, so
  // this is a degraded path rather than a failure — hence 200 and a reason.
  return { corpus: [], source: 'none', error: errors.join(' | '), fallback: '/blog-corpus.json' };
}

// ── Primary sources in a source article ────────────────────────────────────
// ?mode=cited&url=... fetches ONE article and reports the authoritative
// sources behind it, two ways:
//
//   linked    — authoritative URLs the article actually links to
//   mentioned — organisations it names in the text WITHOUT linking, which is
//               the more common case and the more useful one. A piece saying
//               "according to Freddie Mac" and never linking it is pointing at
//               a number worth citing properly; this returns the canonical
//               research URL plus the sentence it appeared in, so the claim can
//               be checked at the source rather than repeated second-hand.
//
// The point is never to cite the article that surfaced the topic. Linking a
// competitor's blog hands them a link and cites the weaker source. Linking the
// primary source, with a date, is what makes a claim liftable by an AI answer
// engine and is a genuine quality signal besides.
//
// Run per-card and on demand, not during a scan: a scan handles 100+
// candidates, and fetching every one of those articles would be slow and rude
// to the publishers.

// A .gov or .edu is authoritative by construction. These are the non-.gov
// hosts worth the same treatment.
const PRIMARY_HOSTS = [
  'freddiemac.com', 'fanniemae.com', 'nar.realtor', 'realtor.org', 'mba.org',
  'virginiarealtors.org', 'virginiahousing.com', 'stlouisfed.org', 'fred.stlouisfed.org',
];
// Real data, but published by a commercial party with an interest.
const RESEARCH_HOSTS = ['zillow.com', 'redfin.com', 'realtor.com', 'corelogic.com', 'blackknightinc.com', 'attomdata.com'];

// Named in prose, usually unlinked. Full names match case-insensitively;
// acronyms must match case-SENSITIVELY and on a word boundary, or "mba" in
// "MBA program" and stray "nar" fragments produce constant false hits.
const PRIMARY_ORGS = [
  { name: 'National Association of Realtors', acr: ['NAR'], url: 'https://www.nar.realtor/research-and-statistics' },
  { name: 'Freddie Mac', acr: [], url: 'https://www.freddiemac.com/pmms' },
  { name: 'Fannie Mae', acr: [], url: 'https://www.fanniemae.com/research-and-insights' },
  { name: 'Census Bureau', acr: [], url: 'https://www.census.gov/topics/housing.html' },
  { name: 'Bureau of Labor Statistics', acr: ['BLS'], url: 'https://www.bls.gov/' },
  { name: 'Federal Reserve', acr: [], url: 'https://www.federalreserve.gov/' },
  { name: 'Consumer Financial Protection Bureau', acr: ['CFPB'], url: 'https://www.consumerfinance.gov/' },
  { name: 'Federal Housing Finance Agency', acr: ['FHFA'], url: 'https://www.fhfa.gov/data/house-price-index' },
  { name: 'Mortgage Bankers Association', acr: [], url: 'https://www.mba.org/news-and-research' },
  { name: 'Department of Housing and Urban Development', acr: ['HUD'], url: 'https://www.hud.gov/' },
  { name: 'Federal Housing Administration', acr: ['FHA'], url: 'https://www.hud.gov/federal_housing_administration' },
  { name: 'Department of Veterans Affairs', acr: [], url: 'https://www.va.gov/housing-assistance/home-loans/' },
  { name: 'Internal Revenue Service', acr: ['IRS'], url: 'https://www.irs.gov/' },
  { name: 'Virginia REALTORS', acr: [], url: 'https://virginiarealtors.org/research/' },
  { name: 'Virginia Housing', acr: [], url: 'https://www.virginiahousing.com/' },
  { name: 'Hanover County', acr: [], url: 'https://www.hanovercounty.gov/' },
  { name: 'Henrico County', acr: [], url: 'https://henrico.us/' },
  { name: 'Chesterfield County', acr: [], url: 'https://www.chesterfield.gov/' },
  { name: 'Zillow', acr: [], url: 'https://www.zillow.com/research/' },
  { name: 'Redfin', acr: [], url: 'https://www.redfin.com/news/data-center/' },
  { name: 'CoreLogic', acr: [], url: 'https://www.corelogic.com/intelligence/' },
  { name: 'ATTOM', acr: [], url: 'https://www.attomdata.com/news/' },
];

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function tierFor(host) {
  if (!host) return '';
  if (/\.gov$/.test(host) || /\.edu$/.test(host)) return 'primary';
  for (let i = 0; i < PRIMARY_HOSTS.length; i++) {
    if (host === PRIMARY_HOSTS[i] || host.endsWith('.' + PRIMARY_HOSTS[i])) return 'primary';
  }
  for (let j = 0; j < RESEARCH_HOSTS.length; j++) {
    if (host === RESEARCH_HOSTS[j] || host.endsWith('.' + RESEARCH_HOSTS[j])) return 'research';
  }
  return '';
}

// This endpoint fetches a caller-supplied URL, so it refuses anything that is
// not a public http(s) host. It returns only extracted link metadata, never
// page content, so it cannot be used to read a page through this origin.
function safeToFetch(u) {
  let parsed;
  try { parsed = new URL(u); } catch { return 'not a URL'; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'only http and https';
  const h = parsed.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return 'not a public host';
  if (h.indexOf('.') < 0) return 'not a public host';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0 ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 169 && p[1] === 254)) return 'not a public host';
  }
  return '';
}

async function findCited(target) {
  const bad = safeToFetch(target);
  if (bad) return { linked: [], mentioned: [], error: bad };

  let html;
  try {
    html = await fetchText(target, { raw: true });
  } catch (err) {
    return { linked: [], mentioned: [], error: String((err && err.message) || err) };
  }

  const selfHost = hostOf(target);

  // Narrow to the article body before extracting anything. Scanning the whole
  // document pulled "sources" out of the related-articles rail: a HousingWire
  // page reported FHFA and HUD as mentioned by the article when those words
  // were only ever in sidebar headlines for other stories. Chrome and
  // publishers both mark the real body with <article> or <main>, so prefer
  // that and strip the furniture either way.
  html = html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');

  const body = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)
    || /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  // Only trust it if it is substantial; some templates emit an empty <article>.
  if (body && body[1] && body[1].length > 600) html = body[1];

  // Links the article actually makes.
  const linked = [];
  const seenUrl = {};
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m, guard = 0;
  while ((m = re.exec(html)) && guard++ < 3000) {
    let href = decodeEntities(m[1]).trim();
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try { href = new URL(href, target).href; } catch { continue; }
    const host = hostOf(href);
    if (!host || host === selfHost) continue;
    const tier = tierFor(host);
    if (!tier) continue;
    const key = href.split('#')[0];
    if (seenUrl[key]) continue;
    seenUrl[key] = 1;
    linked.push({ url: key, host: host, tier: tier, text: cleanText(m[2]).slice(0, 120) });
    if (linked.length >= 25) break;
  }

  // Organisations named but not linked. This is where most of the value is:
  // publishers routinely write "according to Freddie Mac" and never link it.
  const text = cleanText(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '));
  const linkedHosts = linked.map(function (l) { return l.host; });

  // Suffix match, not equality: the article linked selling-guide.fanniemae.com
  // and Fannie Mae still came back as an unlinked mention because the org's
  // canonical host is the bare fanniemae.com.
  function alreadyLinked(orgHost) {
    for (let i = 0; i < linkedHosts.length; i++) {
      const h = linkedHosts[i];
      if (h === orgHost || h.endsWith('.' + orgHost) || orgHost.endsWith('.' + h)) return true;
    }
    return false;
  }

  const mentioned = [];
  PRIMARY_ORGS.forEach(function (org) {
    const orgHost = hostOf(org.url);
    if (alreadyLinked(orgHost)) return; // already cited; not a gap

    let at = -1, matchedAs = '';
    const nameAt = text.toLowerCase().indexOf(org.name.toLowerCase());
    if (nameAt >= 0) { at = nameAt; matchedAs = org.name; }
    if (at < 0) {
      for (let i = 0; i < org.acr.length; i++) {
        const acr = org.acr[i];
        const rx = new RegExp('\\b' + acr + '\\b');       // case-sensitive
        const hit = rx.exec(text);
        if (hit) { at = hit.index; matchedAs = acr; break; }
      }
    }
    if (at < 0) return;

    const from = Math.max(0, at - 100);
    const context = text.slice(from, Math.min(text.length, at + 160)).trim();
    mentioned.push({
      org: org.name,
      matchedAs: matchedAs,
      url: org.url,
      host: orgHost,
      tier: 'primary',
      context: (from > 0 ? '…' : '') + context + '…',
    });
  });

  return { linked: linked, mentioned: mentioned.slice(0, 12), checked: target };
}

// ── Handlers ───────────────────────────────────────────────────────────────

function usableSources(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SOURCES;
  const list = raw
    .filter(function (s) { return s && s.enabled !== false && typeof s.url === 'string' && /^https?:\/\//i.test(s.url); })
    .slice(0, 40)
    .map(function (s) {
      return {
        id: String(s.id || '').slice(0, 80) || 'src',
        label: String(s.label || s.id || 'Source').slice(0, 80),
        type: ['media', 'forum', 'video', 'local', 'own'].indexOf(s.type) >= 0 ? s.type : 'media',
        url: String(s.url).slice(0, 500),
      };
    });
  return list.length ? list : DEFAULT_SOURCES;
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const mode = new URL(context.request.url).searchParams.get('mode') || '';
    if (mode === 'sources') return json({ sources: DEFAULT_SOURCES });
    if (mode === 'corpus') return json(await fetchCorpus());
    if (mode === 'cited') {
      const target = new URL(context.request.url).searchParams.get('url') || '';
      return json(await findCited(target));
    }
    return json(await runScan(DEFAULT_SOURCES));
  } catch (err) {
    return json({ candidates: [], sources: [], error: String((err && err.message) || err) });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(function () { return null; });
    const sources = usableSources(body && body.sources);
    return json(await runScan(sources));
  } catch (err) {
    return json({ candidates: [], sources: [], error: String((err && err.message) || err) });
  }
}
