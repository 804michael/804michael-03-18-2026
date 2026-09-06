/* ═══════════════════════════════════════════════════════════════════════════
   Virginia real estate tax rates — ONE canonical list for the whole site.

   Created 2026-09-06 because there were already two. The affordability
   calculator (determine-your-budget.html) carried a maintained list, and
   route-planner-pro.html was seeded with a second set that disagreed with it on
   four of nine localities — Ashland, Henrico, Chesterfield, Caroline and New
   Kent were all wrong. Two copies of a number that changes annually is a
   guarantee that one of them is stale, and the wrong one will be the one
   somebody quotes.

   HOW TO UPDATE
   1. Check each locality's own site (search "<county> VA real estate tax rate").
      Rates are set with each locality's annual budget, usually spring, effective
      1 July. A town rate (Ashland) STACKS on top of its county's.
   2. Edit the numbers below and set AS_OF to the month you checked.
   3. That is all. system-status.html reads AS_OF and starts warning at six
      months, so this file tells you when it is due.

   Rates are a percentage of assessed value — Virginia publishes them as
   "$0.81 per $100", which is the same thing as 0.81%.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var TAX_RATES = {
    // Month these were last verified. system-status.html compares against it.
    AS_OF: '2026-08',

    // Ordered the way the calculator's dropdown lists them: Michael's home
    // county first, then outward. label is what a person reads; pct is the rate.
    localities: [
      { key: 'Hanover',      label: 'Hanover County',                  pct: 0.81 },
      { key: 'Ashland',      label: 'Ashland (Town + Hanover County)', pct: 0.91 },
      { key: 'Henrico',      label: 'Henrico County',                  pct: 0.83 },
      { key: 'Richmond City', label: 'City of Richmond',               pct: 1.20 },
      { key: 'Caroline',     label: 'Caroline County',                 pct: 0.77 },
      { key: 'Goochland',    label: 'Goochland County',                pct: 0.53 },
      { key: 'Powhatan',     label: 'Powhatan County',                 pct: 0.77 },
      { key: 'Chesterfield', label: 'Chesterfield County',             pct: 0.89 },
      { key: 'New Kent',     label: 'New Kent County',                 pct: 0.60 },
      { key: 'King William', label: 'King William County',             pct: 0.62 }
    ]
  };

  // "Hanover", "hanover county", "Hanover County, VA" all find the same row.
  TAX_RATES.find = function (name) {
    var n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    var list = TAX_RATES.localities;
    for (var i = 0; i < list.length; i++) {
      var k = list[i].key.toLowerCase();
      if (n === k || n === k + ' county' || n.indexOf(k) === 0) return list[i];
    }
    return null;
  };

  // Whole months since AS_OF. system-status turns this into a warning.
  TAX_RATES.monthsOld = function (now) {
    var p = /^(\d{4})-(\d{2})$/.exec(TAX_RATES.AS_OF);
    if (!p) return null;
    var d = now || new Date();
    return (d.getFullYear() - Number(p[1])) * 12 + (d.getMonth() + 1 - Number(p[2]));
  };

  root.VA_TAX_RATES = TAX_RATES;
})(typeof window !== 'undefined' ? window : globalThis);
