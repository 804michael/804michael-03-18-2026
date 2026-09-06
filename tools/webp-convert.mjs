// tools/webp-convert.mjs
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// Resizes images and writes their .webp twins, using a BROWSER as the image
// encoder. There is no ImageMagick, ffmpeg, cwebp or Python on this machine
// and this repo has no package.json, so there is nothing else here that can
// encode a WebP. Chromium can, through canvas.toBlob('image/webp'), and the
// Browser pane is already open in every Claude session.
//
// How it works: this starts a throwaway local server, serves a page that pulls
// each source image, draws it to a canvas at the target width, encodes it, and
// POSTs the bytes back. The server writes them next to the originals and exits
// once every file is done. Image data never passes through the conversation.
//
// Usage:
//   node tools/webp-convert.mjs images/blog/<slug>            (whole folder)
//   node tools/webp-convert.mjs images/blog/<slug>/hero.jpg   (one file)
//   ...then open http://localhost:8792/ in any browser. Claude does this by
//   navigating the Browser pane; it closes itself when finished.
//
// Options:
//   --width=1600   longest-edge target (default 1600)
//   --quality=0.82 WebP quality 0-1 (default 0.82)
//   --keep-larger  write the webp even when it comes out bigger than the
//                  original, which happens with flat graphics. Off by default,
//                  because shipping a heavier "optimised" file is worse than
//                  shipping nothing.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8792;
const SRC_EXT = ['.jpg', '.jpeg', '.png'];

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const targets = argv.filter((a) => !a.startsWith('--'));

const WIDTH = parseInt(flags.width, 10) || 1600;
const QUALITY = parseFloat(flags.quality) || 0.82;
const KEEP_LARGER = !!flags['keep-larger'];

if (!targets.length) {
  console.log('\n  Usage: node tools/webp-convert.mjs <file-or-folder> [--width=1600] [--quality=0.82]\n');
  process.exit(0);
}

// Collect the work list.
const jobs = [];
for (const t of targets) {
  const p = path.resolve(REPO, t);
  if (!fs.existsSync(p)) { console.error('  skip, not found: ' + t); continue; }
  const files = fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).map((f) => path.join(p, f))
    : [p];
  for (const f of files) {
    if (!SRC_EXT.includes(path.extname(f).toLowerCase())) continue;
    jobs.push({
      id: jobs.length,
      abs: f,
      rel: path.relative(REPO, f).replace(/\\/g, '/'),
      out: f.replace(/\.(jpe?g|png)$/i, '.webp'),
      srcBytes: fs.statSync(f).size,
      done: false,
    });
  }
}

if (!jobs.length) { console.log('\n  Nothing to convert (looked for ' + SRC_EXT.join(', ') + ').\n'); process.exit(0); }

console.log('\n  ' + jobs.length + ' image' + (jobs.length === 1 ? '' : 's') + ' to convert at ' + WIDTH + 'px, quality ' + QUALITY);
jobs.forEach((j) => console.log('    - ' + j.rel));
console.log('\n  Open http://localhost:' + PORT + '/ to run it. Waiting...\n');

const PAGE = `<!doctype html><meta charset="utf-8"><title>WebP convert</title>
<style>body{font:14px system-ui;margin:24px;color:#111}li{margin:4px 0}.ok{color:#1a7a3c}.bad{color:#DA291C}</style>
<h1>Converting ${jobs.length} image(s)</h1><ul id="log"></ul>
<script>
const JOBS = ${JSON.stringify(jobs.map((j) => ({ id: j.id, rel: j.rel })))};
const WIDTH = ${WIDTH}, QUALITY = ${QUALITY};
const log = document.getElementById('log');
function line(t, cls){ const li=document.createElement('li'); li.textContent=t; if(cls)li.className=cls; log.appendChild(li); }

(async () => {
  for (const j of JOBS) {
    try {
      const blob = await (await fetch('/src/' + j.id)).blob();
      const bmp = await createImageBitmap(blob);
      // Only ever scale DOWN. Upscaling invents detail and adds bytes.
      const scale = Math.min(1, WIDTH / bmp.width);
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d', { alpha: true }).drawImage(bmp, 0, 0, w, h);
      const out = await new Promise(r => c.toBlob(r, 'image/webp', QUALITY));
      if (!out) throw new Error('this browser did not encode webp');
      await fetch('/out/' + j.id, { method: 'POST', body: out, headers: { 'X-Dims': w + 'x' + h } });
      line(j.rel + '  ->  ' + w + 'x' + h + ', ' + Math.round(out.size/1024) + ' KB', 'ok');
    } catch (e) {
      line(j.rel + '  FAILED: ' + e.message, 'bad');
      await fetch('/fail/' + j.id, { method: 'POST', body: String(e.message) });
    }
  }
  line('Done. This window can be closed.');
  await fetch('/finish', { method: 'POST' });
})();
</script>`;

let remaining = jobs.length;
const results = [];

const server = http.createServer(async (req, res) => {
  const m = /^\/(src|out|fail)\/(\d+)$/.exec(req.url || '');

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(PAGE);
  }

  if (m && m[1] === 'src') {
    const j = jobs[+m[2]];
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(j.abs));
  }

  if (m && m[1] === 'out') {
    const j = jobs[+m[2]];
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const dims = req.headers['x-dims'] || '';
    if (!KEEP_LARGER && buf.length >= j.srcBytes) {
      results.push({ rel: j.rel, note: 'skipped, webp came out larger (' + Math.round(buf.length / 1024) + ' KB vs ' + Math.round(j.srcBytes / 1024) + ' KB)' });
    } else {
      fs.writeFileSync(j.out, buf);
      results.push({
        rel: path.relative(REPO, j.out).replace(/\\/g, '/'),
        note: dims + ', ' + Math.round(buf.length / 1024) + ' KB (was ' + Math.round(j.srcBytes / 1024) + ' KB, -' + Math.round(100 - (buf.length / j.srcBytes) * 100) + '%)',
      });
    }
    if (--remaining <= 0) finish();
    res.writeHead(204); return res.end();
  }

  if (m && m[1] === 'fail') {
    const j = jobs[+m[2]];
    const chunks = []; for await (const c of req) chunks.push(c);
    results.push({ rel: j.rel, note: 'FAILED: ' + Buffer.concat(chunks).toString() });
    if (--remaining <= 0) finish();
    res.writeHead(204); return res.end();
  }

  if (req.url === '/finish') { res.writeHead(204); res.end(); return finish(); }

  res.writeHead(404); res.end();
});

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log('  Results:');
  results.forEach((r) => console.log('    ' + r.rel + '  ' + r.note));
  console.log('');
  server.close();
  setTimeout(() => process.exit(0), 150);
}

// Do not hang forever if nobody opens the page.
setTimeout(() => { if (!finished) { console.log('  Timed out waiting for a browser.\n'); process.exit(1); } }, 180000);

server.listen(PORT);
