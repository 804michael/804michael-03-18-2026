#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  804re.com live health check  (added 2026-09-12)
#
#  Curls the live site and reports anything answering the wrong way:
#    - internal repo files that must stay hidden (functions/_middleware.js
#      + _routes.json answer them with 404)
#    - files deleted from the repo that must stay gone
#    - real pages, data files and API endpoints that must keep working
#
#  Prints one FAIL line per problem, then a one-line verdict. Exit 0 = all
#  good, exit 1 = something failed. A weekly scheduled task runs it and only
#  bothers Michael when it exits 1.
#
#  Every URL gets a ?cb=<random> cache-buster, so a stale copy in
#  Cloudflare's edge cache can't hide a real problem or fake one.
#  This file lives under tools/, which the middleware keeps off the site.
# ─────────────────────────────────────────────────────────────────────────────
set -u
BASE=${1:-https://804re.com}
fails=0; total=0

# The cache-buster is appended as ?cb= or &cb= depending on whether the path
# already has a query string.
expect() { # kind path   kind: 404 | live (2xx/3xx) | api (anything but 000/5xx other than 501)
  local kind=$1 p=$2 got; got=$(curl -s -o /dev/null -m 20 -w '%{http_code}' \
    "$BASE$p$([[ $p == *\?* ]] && echo '&' || echo '?')cb=$RANDOM$RANDOM" 2>/dev/null || echo 000)
  total=$((total+1))
  case "$kind" in
    404)  [ "$got" = 404 ] && return ;;
    live) [[ $got == 2* || $got == 3* ]] && return ;;
    api)  [[ $got != 000 && ( $got != 5* || $got == 501 ) ]] && return ;;
  esac
  fails=$((fails+1)); printf 'FAIL  %-4s  expected %-4s  %s\n' "$got" "$kind" "$p"
}

# Internal files: must be hidden
for p in /CLAUDE.md /docs/site-design-notes.md /docs/version-stamp-convention.md \
         /docs/addstand.gs /docs/gmail-alerts.gs /docs/seasonal-submit.gs \
         /.claude/settings.json /.claude/hooks/auto-commit.sh /.gitignore /.gitattributes \
         /push-live.bat /tools/site-check.sh /tools/webp-convert.mjs /tools/add-blog-image.mjs; do
  expect 404 "$p"; done

# Deleted 2026-09-12: must stay gone
for p in /index_files/css2 /804schools-old.csv /804schools-lat-long.csv /804schools-jacked-lat-long.csv; do
  expect 404 "$p"; done

# Public pages and assets: must serve
for p in / /map-search /home-value-estimate /determine-your-budget /cash-to-buy-a-home \
         /seller-net-sheet /market-stats /find-a-home /tour-a-home /due-diligence \
         /financing-commandments /utility-providers /ashland /glen-allen /hanover /mechanicsville \
         /farmstand /privacy /terms /accessibility /fair-housing \
         /dev /tour-planner /route-planner-pro /system-status /t/healthcheck \
         /llms.txt /robots.txt /sitemap.xml /nav.css /nav.js /nav-partial /tax-rates.js \
         /address-autocomplete.js /804michael.vcf /804schools.csv /blog-corpus.json; do
  expect live "$p"; done

# Functions: must answer from the function (501 = a binding/key not set,
# which is a config gap, not an outage; reported separately below)
for p in /api/rates /api/dev-cards /api/dev-notes /api/heigit-status /api/tours \
         "/api/address-autocomplete?q=100%20Main%20St" "/api/tour-page?code=healthcheck"; do
  expect api "$p"; done

# Lead mailer: the Google Apps Script web app (804re.com@gmail.com) that the
# Message, Seller and Buyer forms post to. A GET just answers "live".
LEAD_URL="https://script.google.com/macros/s/AKfycbxlN-Kr-nNbZK5k19owUTIDfeHK9f-gbgjZGWJmBdbhdhaMkNU1YWg5S_qzEQRphOnMng/exec"
total=$((total+1))
if ! curl -s -L -m 30 "$LEAD_URL" 2>/dev/null | grep -q "lead mailer is live"; then
  fails=$((fails+1)); echo "FAIL  lead mailer web app not answering ($LEAD_URL)"
fi

# Config gaps worth nagging about until fixed
cfg=$(curl -s -m 20 "$BASE/api/tours?cb=$RANDOM" 2>/dev/null)
if [[ $cfg == *agent_key_not_configured* ]]; then
  fails=$((fails+1)); echo "FAIL  501   AGENT_KEY is not set in Cloudflare (saved tours, client tour pages and short links are locked)"
fi

if [ "$fails" -eq 0 ]; then echo "ALL OK: $total checks passed on $BASE"; exit 0; fi
echo "PROBLEMS: $fails of $((total+1)) checks failed on $BASE"; exit 1
