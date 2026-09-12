// ─────────────────────────────────────────────────────────────────────────────
//  Is today the first business day of this week?  (added 2026-09-12)
//
//  The weekly site check fires at 7:20 AM every weekday, because cron cannot
//  skip holidays. This gate lets only one of those runs through: Monday, or,
//  when Monday is a US federal holiday, the next weekday that isn't one.
//
//    node tools/first-business-day.mjs            exit 0 = run today, 3 = skip
//    node tools/first-business-day.mjs 2026-05-26 test a specific date
//
//  Federal holidays use the OPM "observed" rule: one falling on a Saturday is
//  observed the Friday before, one on a Sunday the Monday after.
// ─────────────────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// nth weekday (0=Sun..6=Sat) of a month; n = -1 means the last one
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const d = new Date(year, month, 1);
    d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (n - 1) * 7);
    return d;
  }
  const d = new Date(year, month + 1, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  return d;
}

function observed(d) {
  const o = new Date(d);
  if (o.getDay() === 6) o.setDate(o.getDate() - 1);
  if (o.getDay() === 0) o.setDate(o.getDate() + 1);
  return o;
}

function federalHolidays(year) {
  return [
    observed(new Date(year, 0, 1)),   // New Year's Day
    nthWeekday(year, 0, 1, 3),        // Martin Luther King Jr. Day
    nthWeekday(year, 1, 1, 3),        // Washington's Birthday
    nthWeekday(year, 4, 1, -1),       // Memorial Day
    observed(new Date(year, 5, 19)),  // Juneteenth
    observed(new Date(year, 6, 4)),   // Independence Day
    nthWeekday(year, 8, 1, 1),        // Labor Day
    nthWeekday(year, 9, 1, 2),        // Columbus Day
    observed(new Date(year, 10, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4),       // Thanksgiving
    observed(new Date(year, 11, 25)), // Christmas
  ].map(key);
}

const arg = process.argv[2];
const today = arg ? new Date(`${arg}T12:00:00`) : new Date();
const y = today.getFullYear();
// next year's list too: New Year's on a Saturday is observed Dec 31
const holidays = new Set([...federalHolidays(y), ...federalHolidays(y + 1)]);
const isBusinessDay = d => d.getDay() >= 1 && d.getDay() <= 5 && !holidays.has(key(d));

let run = false;
if (isBusinessDay(today)) {
  run = true;
  const d = new Date(today);
  while (d.getDay() > 1) {           // walk back to Monday
    d.setDate(d.getDate() - 1);
    if (isBusinessDay(d)) { run = false; break; }
  }
}

console.log(`${key(today)}: ${run ? 'RUN (first business day of the week)' : 'SKIP'}`);
process.exit(run ? 0 : 3);
