// ─────────────────────────────────────────────────────────────────────────────
//  Keep internal repo files off 804re.com  (added 2026-09-12)
//
//  Cloudflare Pages serves the whole repo root, so anything committed is a
//  public URL: /CLAUDE.md, /docs/site-design-notes.md, /.claude/settings.json
//  and the rest all answered 200. Pages (unlike Workers) has no .assetsignore,
//  and _redirects cannot return a 404, so this middleware is the block.
//
//  It only ever runs for the paths listed in /_routes.json. That file is
//  hand-written, which means BOTH lists must change together:
//    - blocking a new path: add it to BLOCKED below AND to _routes.json
//      "include", or the request never reaches this code.
//    - adding a new functions/ directory (a new /x/* endpoint): add "/x/*" to
//      _routes.json "include", or that endpoint silently never runs.
//
//  This hides the files from the site, not from the world: the GitHub repo is
//  public, so anything committed can still be read there.
//
//  Blocked requests get the site's own 404 page with a real 404 status.
//  Everything else passes straight through to the function or asset.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED = [
  /^\/CLAUDE\.md$/i,
  /^\/docs(\/|$)/i,
  /^\/\.claude(\/|$)/i,
  /^\/\.git(ignore|attributes)$/i,
  /^\/push-live\.bat$/i,
  /^\/tools(\/|$)/i,
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch (e) { /* keep the raw path */ }

  if (!BLOCKED.some(re => re.test(path))) return context.next();

  let body = '<!doctype html><title>Not found</title><h1>Not found</h1>';
  try {
    const page = await context.env.ASSETS.fetch(new URL('/404', url));
    const type = page.headers.get('Content-Type') || '';
    if (type.includes('text/html')) body = await page.text();
  } catch (e) { /* fall back to the plain body above */ }

  return new Response(body, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
