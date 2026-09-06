// tools/add-blog-image.mjs
//
// AI ASSISTANT INSTRUCTIONS — PLEASE READ BEFORE EDITING
// Files a photo into the blog image convention: images/blog/<post-slug>/.
// Point it at an image anywhere on disk (typically a folder ABOVE the repo,
// where Michael drops photos off his phone) and it creates the post's folder,
// normalises the filename, copies the file in, checks the dimensions, and
// prints the <picture> markup to paste into the post.
//
// ZERO DEPENDENCIES ON PURPOSE. This repo has no package.json and no build
// step, and it is not worth acquiring one for a file-move script. That does
// mean this cannot RESIZE or convert to WebP - there is no ImageMagick,
// ffmpeg, cwebp or Python on this machine (checked 2026-09-06). It reads image
// dimensions straight out of the file header instead, and tells you when a
// photo is too big or is missing its .webp twin. Claude does the actual
// conversion in-session using Chromium's canvas encoder.
//
// Usage:
//   node tools/add-blog-image.mjs <source> <post-slug> [role] [--move] [--force]
//
//   <source>     path to the image, absolute or relative to the repo root
//   <post-slug>  the post's slug, e.g. seller-concessions-vs-price-cut
//   [role]       "hero" (default) or a short label like "closing-table".
//                Extra photos are numbered automatically: 01-, 02-, ...
//   --move       move the original instead of copying it
//   --force      overwrite a file that is already there
//
// Examples:
//   node tools/add-blog-image.mjs "../photos/IMG_4821.jpg" hanover-tax-rates
//   node tools/add-blog-image.mjs ../photos/porch.jpg fall-move front-porch

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_IMAGES = path.join(REPO, 'images', 'blog');

// A hero wider than this is wasted bytes; narrower than MIN looks soft on a
// retina screen at full width.
const TARGET_WIDTH = 1600;
const MIN_WIDTH = 1200;
const WARN_BYTES = 400 * 1024;

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];

function die(msg) {
  console.error('\n  ✗ ' + msg + '\n');
  process.exit(1);
}

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Image dimensions, straight from the file header ───────────────────────
// Enough of each format to find width and height. No decoding, no library.

function pngSize(b) {
  // IHDR is always the first chunk: width and height are two big-endian
  // 32-bit ints at offset 16.
  if (b.length < 24) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function jpegSize(b) {
  // Walk the marker segments looking for a Start Of Frame. SOF0/1/2 are the
  // common ones; the rest are the arithmetic and progressive variants. DNL
  // (0xC4/0xC8/0xCC) are NOT frame headers and must be skipped.
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    const isSOF = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30 || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') {
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (fmt === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === 'VP8X') {
    return {
      w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    };
  }
  return null;
}

function dimensions(file) {
  const b = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.png') return pngSize(b);
    if (ext === '.webp') return webpSize(b);
    return jpegSize(b);
  } catch {
    return null;
  }
}

function human(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

// ── Main ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const args = argv.filter((a) => !a.startsWith('--'));

if (args.length < 2) {
  console.log(`
  Usage: node tools/add-blog-image.mjs <source> <post-slug> [role] [--move] [--force]

    node tools/add-blog-image.mjs "../photos/IMG_4821.jpg" hanover-tax-rates
    node tools/add-blog-image.mjs ../photos/porch.jpg fall-move front-porch --move
`);
  process.exit(0);
}

const [srcArg, slugArg, roleArg] = args;

const src = path.resolve(REPO, srcArg);
if (!fs.existsSync(src) || !fs.statSync(src).isFile()) die('No file at: ' + src);

const ext = path.extname(src).toLowerCase();
if (!ALLOWED.includes(ext)) {
  die('Unsupported type "' + ext + '". Use one of: ' + ALLOWED.join(', '));
}

const slug = slugify(slugArg);
if (!slug) die('That post slug reduces to nothing usable: ' + slugArg);
if (slug !== slugArg) console.log('  note: slug normalised to "' + slug + '"');

const destDir = path.join(BLOG_IMAGES, slug);
const existing = fs.existsSync(destDir)
  ? fs.readdirSync(destDir).filter((f) => ALLOWED.includes(path.extname(f).toLowerCase()))
  : [];

// Name it. "hero" is reserved for the one at the top; anything else is
// numbered in the order it arrives so the post's images sort the way they are
// laid out.
let base;
const role = roleArg ? slugify(roleArg) : '';
const heroTaken = existing.some((f) => f.startsWith('hero.'));

if (!role && !heroTaken) {
  base = 'hero';
} else if (role === 'hero') {
  base = 'hero';
} else {
  const nums = existing
    .map((f) => /^(\d\d)-/.exec(f))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const next = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
  base = next + '-' + (role || slugify(path.basename(src)) || 'photo');
}

const destName = base + (ext === '.jpeg' ? '.jpg' : ext);
const dest = path.join(destDir, destName);

if (fs.existsSync(dest) && !flags.has('--force')) {
  die(destName + ' already exists in that folder. Pass --force to replace it.');
}

fs.mkdirSync(destDir, { recursive: true });
if (flags.has('--move')) fs.renameSync(src, dest);
else fs.copyFileSync(src, dest);

// ── Report ────────────────────────────────────────────────────────────────

const size = fs.statSync(dest).size;
const dim = dimensions(dest);
const webUrl = '/images/blog/' + slug + '/' + destName;
const webpTwin = path.join(destDir, base + '.webp');
const hasWebp = fs.existsSync(webpTwin);

console.log('\n  ✓ ' + (flags.has('--move') ? 'Moved' : 'Copied') + ' to  images/blog/' + slug + '/' + destName);
console.log('    ' + (dim ? dim.w + ' x ' + dim.h + ' px' : 'dimensions unreadable') + ', ' + human(size));

const warn = [];
if (dim && dim.w < MIN_WIDTH) {
  warn.push('Only ' + dim.w + 'px wide. A hero wants ' + TARGET_WIDTH + 'px; under ' + MIN_WIDTH + 'px looks soft on a phone.');
}
if (dim && dim.w > TARGET_WIDTH * 1.25) {
  warn.push(dim.w + 'px is wider than needed. Resize down to ' + TARGET_WIDTH + 'px to save the visitor the bytes.');
}
if (size > WARN_BYTES) {
  warn.push(human(size) + ' is heavy for one image. Aim under ' + human(WARN_BYTES) + '.');
}
if (!hasWebp && ext !== '.webp') {
  warn.push('No ' + base + '.webp beside it. Ask Claude to make one — it doubles as the modern-browser version and usually halves the weight.');
}
if (warn.length) {
  console.log('\n  Worth fixing:');
  warn.forEach((w) => console.log('    - ' + w));
}

console.log('\n  Markup for the post:\n');
if (hasWebp || ext === '.webp') {
  console.log('    <picture>');
  console.log('      <source srcset="' + '/images/blog/' + slug + '/' + base + '.webp" type="image/webp">');
  console.log('      <img src="' + webUrl + '" width="' + (dim ? dim.w : '') + '" height="' + (dim ? dim.h : '') + '" alt="" loading="lazy" decoding="async">');
  console.log('    </picture>');
} else {
  console.log('    <img src="' + webUrl + '" width="' + (dim ? dim.w : '') + '" height="' + (dim ? dim.h : '') + '" alt="" loading="lazy" decoding="async">');
}
console.log('\n  Write a real alt describing what is IN the photo. It is what gets');
console.log('  the image into image search, and it is the accessibility floor.\n');
