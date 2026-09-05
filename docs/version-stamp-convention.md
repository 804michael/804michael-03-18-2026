# Version-Stamp Convention — 804re.com (canonical reference)

This is the single source of truth for the site's page version-stamp format. It lives beside `site-design-notes.md` because it's a rule a session needs at the *start* of any page edit, not something to go hunting for inside a much larger design doc.

## The format

```
vYY.MM.DD_HH-MM-XXXX
```

Date, underscore, time (hyphen between hours and minutes), hyphen, 4-digit revision counter. Displayed with a lowercase `v` prefix. Example: `v26.09.03_00-28-0050`.

The stored constant (`SITE_VERSION` / `MAP_VERSION`) holds everything *except* the `v` — the JS prepends it:

```js
const SITE_VERSION = '26.09.03_00-28-0050';
```

## The counter (XXXX)

- **Per-file, not sitewide.** Each page owns its own counter. There is no global sequence and no shared number to look up.
- **Increments by 1 on every single write to that file** — including trivial edits.
- **There is no counter file or tracking mechanism.** The next session reads the last revision number off the file itself (any of the three stamp spots below) and adds 1. The file is self-documenting; each page's own top comment block restates this rule.

## Three spots, every edit — no exceptions

Every edit to a version-stamped page MUST update all three:

1. The `SITE VERSION:` (or `MAP VERSION:`) line in the page's top `AI ASSISTANT INSTRUCTIONS` comment block
2. `const SITE_VERSION` / `const MAP_VERSION` in the main `<script>` block
3. The visible version text near the footer (`#site-version-display`, or `#map-version-display` on `map-search.html`)

The chat-response rule also stands: open the reply to Michael by stating the current version, e.g. `📌 Version: v26.09.03_00-28-0050`, before describing any changes.

**Box-drawing alignment matters.** The top comment block is a `║ … ║` frame. When a rewritten line changes length, pad it back to its original character count rather than letting the frame reflow.

## Which files carry it (18 as of 2026-09-05)

`SITE_VERSION` (17): `index.html`, `find-a-home.html`, `tour-a-home.html`, `determine-your-budget.html`, `cash-to-buy-a-home.html`, `seller-net-sheet.html`, `home-value-estimate.html`, `farmstand.html`, `dev.html`, `due-diligence.html`, `utility-providers.html`, `buyer-intake.html`, `seller-intake.html`, `market-stats.html`, `financing-commandments.html`, `tour-planner.html`, `system-status.html`, `client-tour.html`

`MAP_VERSION` (1): `map-search.html`

Note `client-tour.html` has only **three** occurrences of the version string, not four — its visible version line is written by JS from the constant rather than hard-coded in the markup.

**Not covered, deliberately:**

- `nav.css` / `nav.js` / `nav-partial.html` — shared components have never carried a version stamp. This is a per-page convention, not a per-component one. Editing the shared nav needs no bump.
- Cloudflare Pages Functions under `functions/` — same reasoning.
- `ashland.html`, `hanover.html`, `mechanicsville.html`, `glen-allen.html`, `farmstand-trail.html`, `home-affordability-calculator.html` — these have no `AI ASSISTANT INSTRUCTIONS` block at all and were left alone. **Still open:** whether Michael wants the convention added to the four area-guide pages, since right now they can be edited with no version-tracking safety net.

## History — the sitewide rollout, 2026-09-05

The counter format was introduced on `tour-planner.html` on 2026-09-04 and rolled out to the rest of the site the next day. Two decisions Michael made when asked:

- **Counter start: per-file, all beginning at `0050`** — each page keeps its own independent counter, but they all started at the same number so they read as roughly in step for a while. (`tour-planner.html` kept its own, already past that point.)
- **Date/time preserved, not bumped.** Each page kept the date/time of its actual last content revision rather than being restamped to the rollout time, so the visible history of when each page last really changed stays readable. This was a deliberate departure from the 2026-09-02 format change, where every file was restamped to one shared timestamp.

The previous format was `vYY.MM.DD HH-MM` with no counter (and, before 2026-09-02, an underscore in the time and a capital `V`). `farmstand.html` was the last file still carrying that older underscore form and was brought in line during the rollout.

Beyond the three stamp values, each page's top comment block was rewritten so it documents the counter rule rather than the old format — otherwise a future session reading the file would follow stale instructions.

### How the rollout was verified

Done as a scripted transformation over staged copies rather than 16 hand edits, then checked:

- All three stamp spots parsed back out of every file and asserted equal to each other, per file.
- Zero remaining strings matching the old `YY.MM.DD HH-MM` / `HH_MM` shape anywhere.
- Each file diffed against its original with version strings masked out, confirming the only changed lines were inside the header comment block plus the single `const SITE_VERSION` line.
- `node --check` on each file's last inline `<script>` block.

That verify-by-measurement approach is the convention on this project generally, not just for this change.
