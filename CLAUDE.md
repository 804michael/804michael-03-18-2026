# 804re.com — project context for Claude Code

Read this first. The two files in `docs/` are the real reference; this page is
the short version plus the rules that are easy to break.

- `docs/site-design-notes.md` — the full design/decision history. Large (~260KB),
  so open it when you need a specific section, not on every task. It is the only
  source of truth for the site's conventions.
- `docs/version-stamp-convention.md` — the per-page version stamp. Read this
  before editing any page; it applies to nearly every edit.

## What this is

A static real-estate site for Michael Hottman (804Michael), deployed to
Cloudflare Pages. A push to origin IS the deploy (Cloudflare Pages rebuilds from
GitHub). Push finished work yourself without asking — see rule 8 for what still
needs a check-in first.

There is no build step: pages are hand-written HTML with their own embedded
`<style>` and `<script>`.

`functions/` holds Cloudflare Pages Functions (the `/api/*` endpoints). They read
secrets and KV bindings from the Cloudflare dashboard; a new binding or key only
takes effect on a NEW deployment.

## Cloudflare bindings — which endpoint needs what

Configured in the Cloudflare dashboard, never in this repo. Nothing here is
checked in, so a missing one looks like a bug in the page, not in the setup.

| Binding | Kind | Used by |
| --- | --- | --- |
| `TOURS_KV` | KV namespace | `api/tours.js`, `api/tour-page.js`, `api/shorten-link.js`, `s/[code].js` |
| `DEV_ORDER_KV` | KV namespace | `api/dev-order.js`, `api/dev-notes.js`, `api/dev-cards.js` |
| `ORS_API_KEY` | env var | `api/route-optimize.js` (OpenRouteService/HeiGIT) |
| `FRED_API_KEY` | env var | `api/rates.js` (Freddie Mac PMMS via FRED) |
| `STHAN_PROFILE_NAME` + `STHAN_PROFILE_PASSWORD` | env vars | `api/address-autocomplete.js` |

`api/county-lookup.js` and `api/heigit-status.js` need nothing — they are plain
server-side fetches that exist only to dodge CORS.

Related endpoints deliberately **share one namespace under different keys**
(`card-order` / `notes-list` / `cards-state` all live in `DEV_ORDER_KV`) rather
than asking for another dashboard setup step. Follow that when adding one.

**The contract: nothing hard-fails.** Every endpoint degrades instead of
erroring — a missing KV binding returns HTTP 501 and the page falls back to
`localStorage`; a missing key or a third-party outage falls back to a computed
estimate (haversine routing, static rate numbers) and reports which path ran in
a `source` field. A calculator must never break because someone else's API had a
bad day. Keep new endpoints in that shape.

Watch out: `address-autocomplete.js` at the repo root is the browser-side
Nominatim autocomplete for the home-value modal. It is a different file with a
different job from `functions/api/address-autocomplete.js`, which proxies the
paid sthan.io API server-side to keep those credentials off the page.

## Rules that are easy to break

1. **Version stamp, every edit.** Every page carries `vYY.MM.DD_HH-MM-XXXX` in
   THREE places: the `SITE VERSION:` line in its top comment block, the
   `const SITE_VERSION` in its script, and the visible line near the footer. The
   4-digit counter is per-file and increments by one on every write — read the
   current number off the file and add 1. Use the real current time. Details in
   `docs/version-stamp-convention.md`.

2. **New pages and tools stay hidden until Michael says otherwise.**
   `noindex`/`nofollow`, no link in `nav-partial.html`, no `sitemap.xml` entry,
   reachable only from its card on `dev.html`. Never flip any of those three on
   your own initiative. Building and committing is not launching.

3. **CTA wording is fixed:** "Call 804-Michael" and "Text 804-642-4235" — never
   the reverse.

4. **No em dashes in visitor-facing copy**, and avoid generic AI phrasing.

5. **Seller first, buyer second** whenever both are mentioned in prose. The nav's
   section order (Buyer Tools above Seller Tools) is a confirmed exception.

6. **Never commit a third-party logo image** for a portal-style reference. Style
   the brand's name as text in its own colour instead.

7. **Client-facing output must never carry agent-only data.** `client-tour.html`
   and `/api/tour-page.js` enforce an allow-list server-side; private notes and
   agent ratings must not cross it.

8. **Commit and push when the work is done — do not ask first.** (Changed
   2026-09-06 at Michael's request; this rule previously said the opposite.) A
   Stop hook (`.claude/hooks/auto-commit.sh`, wired up in
   `.claude/settings.json`) commits whatever changed when you finish a task, so
   nothing is left uncommitted. Then run `git push origin main` yourself and
   report what went live, including the version stamp now serving. A push to
   origin is the deploy, so verify before pushing, not after: `node --check` the
   inline script, check tag balance, and confirm the diff is the size you
   intended — an encoding round-trip that rewrites a whole file is the failure
   this catches (see the UTF-8 standing rule in the design notes).

   **Still stop and ask** before anything that changes what the public sees in a
   way a commit message cannot undo: launching a hidden page (rule 2), deleting
   content, restructuring URLs, or any change to `_redirects`, `_headers`,
   `robots.txt` or `sitemap.xml` that affects live routing. Pushing ordinary
   page and tool work needs no permission.

## Layout conventions

- **Black hero bar** — one shared standard across all 14 pages. Barlow 800,
  `clamp(26px,4.5vw,42px)`, padding `24px 28px 20px`, 5px red `::after` strip,
  no `text-transform`. A hero must be a direct child of `<body>` and must NOT
  use a `width:100vw` breakout — `100vw` includes the scrollbar and pushes the
  bar ~8px out of line. Full values in the design notes.
- **Two page archetypes:** guide pages (shared nav, black hero, breadcrumb,
  `pg-body`/`pg-main`/`pg-side`) and landing pages (no nav, frosted form card).
  Landing pages omit the nav deliberately — don't "fix" it.
- **`.pg-main,.pg-side{min-width:0}`** wherever that two-column layout is used,
  or a grid track's min-content minimum blows the page out sideways on a phone.
- **Per-page CSS.** `:root` tokens, `.btn`, and the hero rules are duplicated in
  every file — only `nav.css`/`nav.js`/`nav-partial.html` are shared. A change to
  a "shared" component is an every-file sweep, and nothing in code enforces it.

## Verifying work

The convention on this project is to check rather than assume: `node --check` the
extracted inline script, a tag-balance check, and a real headless render
(measuring computed styles / bounding boxes, and `page.pdf()` for print layout)
before delivering. Several bugs in the history were caught only by rendering.

Note the repo lives inside OneDrive, and a first write to a file has repeatedly
reported success without landing — read the file back after writing it.

## Reporting back — how to end every reply

Michael reads these replies to learn the codebase, not just to approve work, so
the write-up is part of the deliverable. Structure every substantive reply this
way:

1. **Version line first** — `📌 Version: vYY.MM.DD_HH-MM-XXXX`, per rule 1.
2. **Explanation, under `##` headings.** One heading per thing you changed,
   named for the change ("Card height", "Mobile drag", "Colour picker"). Say
   what was wrong, why it was wrong, and what you did — the root cause, not just
   the symptom. This is the part he's reading to understand the code.
3. **An `## Issues found` heading** whenever you hit a bug, a wrong assumption,
   or something that looked right and wasn't — including ones you caused and
   fixed, and ones already in the file that you noticed in passing. Do not bury
   these in the prose above; he wants them called out. Say "none" if there were
   none.
4. **A `## Summary` bullet list** at the end. One bullet per heading above,
   reusing the exact same heading text in bold so the bullets map onto the
   sections one-to-one. One line each.
5. **A `## Pushed` heading last**, naming the commit(s) that went live and the
   version stamp now serving, confirmed against the live URL rather than
   assumed. If something was deliberately held back for Michael to decide (rule
   8), say so there instead.

Occasionally — not every reply — add a short `## Worth knowing` note about a
Claude Code or Claude capability that would help his actual work (connectors,
skills, scheduled tasks, artifacts, hooks). Concrete and tied to something he
just did, never a feature tour.
