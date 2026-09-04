// Cloudflare Pages Function
// Route: GET /s/:code
//
// The redirect side of our own-domain short links created by
// /api/shorten-link.js (see that file for why we moved off is.gd/TinyURL).
// A client's phone hitting https://804re.com/s/CODE looks CODE up in the
// same TOURS_KV namespace Save/Reuse Tours already uses (key prefix
// "slink_") and 302-redirects straight to the full Google Maps route link —
// same-origin, no ad interstitial, no third-party dependency.
//
// If TOURS_KV isn't bound (before the one-time KV setup — see tours.js) or
// the code has expired/was never created, this just 404s with a plain,
// friendly message rather than throwing — a client tapping a stale/typo'd
// link should see something readable, not a raw error page.

export async function onRequestGet(context) {
  const { env, params } = context;
  const code = params && typeof params.code === 'string' ? params.code : '';

  const notFound = (msg) => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#333">' +
    '<h1 style="font-size:1.3rem">' + msg + '</h1>' +
    '<p>This short link may have expired, or the address was mistyped. Please ask for the link again.</p>' +
    '</body>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );

  if(!code || !env.TOURS_KV) return notFound('Link not found');

  const longUrl = await env.TOURS_KV.get('slink_' + code);
  if(!longUrl) return notFound('Link not found or expired');

  return Response.redirect(longUrl, 302);
}
