# Tour Planner — continuation brief for a fresh Claude session

Paste/attach this file in a new chat so Claude has the context to keep going without re-explaining the project. This is a working internal tool for 804Michael Real Estate (804re.com) — not a general request, a specific in-progress file edit.

## How to reconnect

- This work happens on Michael's own computer via the device/folder bridge (Cowork's "linked computer" feature) — the repo is **not** copied into the cloud session by default.
- Repo folder: `C:\Users\Micha\OneDrive\2026 804michael Real Estate\GetHub-CloudFlare Website\804michael-website` on the device named **804len-book14**.
- If this new chat isn't already linked to that computer, ask Michael to link it (desktop app → "Link to this computer" on this task, or start a new task with that computer selected).
- If this chat is attached to the **"804michael Real Estate Website"** Claude project, read `claude/site-design-notes.md` there first — it's the full standing-conventions doc (design system, content rules, per-page history, the "seller's first, buyer's second" preference, the version-stamp discipline, etc.). This handoff file is a short pointer to the *current* task, not a replacement for that doc.

## What file, what state

- File: `tour-planner.html` at the repo root (a hidden/internal `noindex,nofollow` Dev-hub tool at `804re.com/tour-planner` — not linked in nav, not launched publicly; see the "Standing rule: new pages/tools stay hidden" section in `site-design-notes.md`).
- **Current delivered version: `v26.09.04 07-05`** — already staged, committed to Michael's device, and re-staged (confirmed written). Nothing has been deployed live — Michael runs `push-live.bat` himself whenever he chooses.
- Companion Cloudflare Pages Functions (not touched in the most recent rounds, no changes pending): `functions/api/route-optimize.js` (ORS/HeiGIT routing, key already configured and working), `functions/api/shorten-link.js` + `functions/s/[code].js` (self-hosted KV short-link shortener, replaced is.gd/TinyURL), `functions/api/tours.js` (Save/Reuse Tours, KV-backed, `TOURS_KV` binding confirmed active).

## Standing workflow for editing this file (follow exactly)

1. Re-stage the file from the device first (`device_stage_files` on the path above) before editing — don't assume the local copy is current.
2. Make the edit(s) with Edit/Write on the staged copy.
3. Verify before sending anything back:
   - Extract the last `<script>` block and run `node --check` on it.
   - Regex tag-balance check on div/svg/a/button/select/textarea/span/label, and `<p>` vs `<path>` handled separately (paths are inside the inline SVG logo).
   - For layout/visual changes, actually render the page with Playwright (`/opt/pw-browsers/chromium`) and screenshot or measure `getBoundingClientRect()` — don't just reason about CSS. Note: this sandbox has **no network access to cdnjs.cloudflare.com** (org policy blocks it), so Leaflet won't load in a real render — stub `window.L` with no-op methods (map/tileLayer/marker/divIcon/polyline/latLngBounds/control.attribution, all chainable) via `page.route()` before `page.goto()`, and mock Nominatim responses the same way if bulk-add/geocoding logic needs testing end-to-end.
4. Bump the version stamp in all 3 places (top comment `SITE VERSION:`, `#site-version-display` footer text, `const SITE_VERSION` in the script) to the actual current UTC time (`date -u +"%y.%m.%d %H-%M"`) — never guess it.
5. Deliver: `SendUserFile` → `device_commit_files` (with `expectedMtimeMs` from the staging call) → immediately re-stage again, since staging always overwrites the local working copy with whatever's now on the device.
6. Reply starts with `📌 Version: v...`, then a short summary of what changed, then more detail if needed.

## Important lesson from this session — read this before touching anything

Michael sends **annotated screenshots** with colored boxes/lines/arrows drawn on them to point at specific UI elements. **Those annotation colors are just his markup tool's marker colors — they are almost never a literal instruction to make something that color.** Earlier in this session that mistake was made twice: a red box drawn around "Google Calendar" and green boxes around "Outlook (Web)" / "Apple/Outlook Desktop" got misread as "make these buttons red/green/yellow," which was wrong and had to be reverted back to a uniform red-outline/red-text style for all three. When an annotated image comes in, read the **words** Michael writes about it as the actual instruction, and treat the drawn colors only as pointers to *which element* he means — never as a color spec — unless he explicitly says "make it [color]."

More generally: when a request is genuinely ambiguous, it's better to render/verify multiple interpretations or ask a quick clarifying question than to guess and ship the wrong thing.

## Current state of the two most recent rounds (already done, both delivered)

**Round A (v26.09.04 06-49):**
- Warning icon (⚠ next to "Text This Link") no longer bounces/scales — static amber glow only.
- "+ Paste address list" → "+ Paste bulk address list".
- Bulk-add box now rolls itself up and hides after a fully successful "Add These Stops" (no leftover "Added N stops, you can close this box now" message).
- Stops heading and Route Map heading vertically aligned across the two columns.
- Calendar buttons regrouped: Google Calendar + Outlook (Web) stacked in one column under "Tour date," Apple/Outlook (.ics) spanning both rows in a second column under "Start time."

**Round B (v26.09.04 07-05) — corrections to Round A based on Michael's follow-up:**
- The "Default time/stop" field was wrongly stacked *below* the intro paragraph in Round A. Fixed: it's back to sitting top-right, side-by-side with the intro text (text flex-grows on the left and wraps to 2 lines; field is pinned top-right, its right edge flush with the "+ Paste bulk address list" row below it — confirmed via render, 0px difference on both the right-edge and top-edge alignment).
- The three calendar buttons had been given three different colors (red/green/amber) in Round A — this was the annotation-color misread described above. Reverted to all three being uniform red-outline/red-text, matching the site's existing red-outline convention. The stacked-column layout itself (Google+Outlook under Tour date, Apple/.ics under Start time) was correct and unchanged.

## Open items / not yet done (carried over, none urgent)

- Map (Leaflet) attribution transparency was set to a reasonable-looking value (`rgba(255,255,255,.4)`) but never pixel-matched against Michael's actual `farmstand.html` map styling — worth a side-by-side check if he flags it.
- `804re.link` / ElkQR branded short link is still just research, not built — not a blocker since the self-hosted `804re.com/s/CODE` shortener already works.
- This tool is under active, iterative review by Michael — expect more small UI-polish rounds like the two above. Don't assume the last delivered version is "final."

## Michael's standing personal preference (applies site-wide, not just this file)

Whenever sellers and buyers are mentioned together in copy, order it **seller's first, buyer's second** (e.g., "for sellers and buyers"). Doesn't come up much on this internal tool since its copy is agent-facing, but keep it in mind if any client-facing text is ever added here.
