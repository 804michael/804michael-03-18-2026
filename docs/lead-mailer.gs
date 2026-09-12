/**
 * 804re.com lead mailer: receives website form submissions, logs every lead
 * as a row in the Sheet this script is attached to, and emails them to
 * Michael from this Google account, either one by one or as a digest.
 * (Added 2026-09-12; digests added the same day.)
 *
 * WHY THIS EXISTS: EmailJS's free plan allows only 2 email templates. The
 * Home Value and Map Search forms use those two; the Message button (every
 * page), Seller Intake and Buyer Intake send here instead. The pages try this
 * script first when their LEAD_SCRIPT_URL is set, fall back to EmailJS if it
 * fails, and show "please call or text" only if both fail.
 * The Home Value ('valuation') and Map Search ('map') layouts are already
 * defined below, so moving those forms here later is a page-only change.
 *
 * DELIVERY: each form in FORMS below has delivery 'digest' or 'immediate'.
 *  - digest: the lead is logged with Emailed = "queued" and goes out in ONE
 *    combined email at the hours in DIGEST_HOURS (nothing is sent when
 *    nothing is waiting). Each lead in the digest has its own "Reply to" link.
 *  - immediate: its own email the moment it arrives, Reply-To set to the
 *    visitor. alsoTo: [...] sends a copy to more addresses (e.g. a webinar
 *    partner). Anything over the hourly cap or the daily quota is queued for
 *    the next digest instead of being lost.
 *  Fail-safe: if the digest triggers were never installed, digest forms are
 *  emailed immediately, so a skipped setup step can't strand a lead.
 *  SUBJECTS start with a red "!" emoji: "Seller LEAD from 804re.com: ..." for
 *  an immediate lead, "Lead digest from 804re.com: 3 new (...)" for a digest.
 *  Every lead shows a Form row (which form) and a Page row (which page), plus
 *  a "Reply to" link whose subject is safe for the client to see.
 *
 * SETUP (one time, about 15 minutes, signed in as 804re.com@gmail.com):
 *  1. Create a new Google Sheet named "804re.com Leads".
 *  2. Extensions > Apps Script. Delete the sample code. Paste this WHOLE file:
 *     open https://raw.githubusercontent.com/804michael/804michael-03-18-2026/main/docs/lead-mailer.gs
 *     then Ctrl+A, Ctrl+C, and Ctrl+V into the editor. Save (Ctrl+S).
 *     The last line of the file is the closing brace of json().
 *  3. Project Settings (gear icon) > Time zone: (GMT-04:00) Eastern Time -
 *     New York. DIGEST_HOURS are read in this time zone.
 *  4. Back in the editor, pick setupSheet in the function dropdown, click Run,
 *     and approve the permission prompt (Google shows "unverified app" for
 *     your own scripts: Advanced > Go to project > Allow).
 *  5. Pick installDigestTriggers and click Run. It schedules the digests.
 *  6. Pick sendTestLead and click Run. Within a minute a test digest should
 *     reach TO_EMAIL and a test row should appear in the Sheet.
 *  7. Deploy > New deployment > type: Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *     Copy the Web app URL (ends in /exec) and send it to Claude, who puts it
 *     into LEAD_SCRIPT_URL in nav.js, seller-intake.html and buyer-intake.html.
 *  LATER EDITS: Deploy > Manage deployments > pencil > Version: New version >
 *  Deploy. That keeps the same URL. "New deployment" would make a new URL and
 *  the pages would keep calling the old one. After changing DIGEST_HOURS, run
 *  installDigestTriggers again.
 *
 * LIMITS: a personal Google account can email 100 recipients a day from a
 * script (Google Workspace: 1,500). A Google One / Google AI Pro subscription
 * does not change that. A digest is one recipient however many leads it
 * holds. Time triggers fire at a random minute within their hour.
 *
 * SAFETY:
 *  - Honeypot: a filled "company" field (people never see one; bots fill
 *    everything) is accepted silently and dropped.
 *  - Duplicate guard: the same submission twice within 10 minutes (a double
 *    click, a retry) is logged and sent once.
 *  - Everything a visitor typed is HTML-escaped in the email and
 *    formula-proofed in the Sheet (a cell can't start with = + - or @).
 */

var TO_EMAIL = 'michael@804michael.com';
var SENDER_NAME = '804re.com';
var ALERT = String.fromCharCode(0x2757);  // the red "!" emoji (U+2757) that starts every subject line
var DIGEST_HOURS = [8, 12, 16, 20];  // local hours; every 3 hours would be [6, 9, 12, 15, 18, 21]
var MAX_PER_HOUR = 30;               // immediate emails per hour; extras wait for the digest
var HEADERS = ['Timestamp', 'Form', 'Name', 'Email', 'Phone', 'Details', 'Page', 'Emailed', 'Data'];

// One entry per form: how it's delivered, its email subject, and the rows
// shown, in order. Keys match exactly what each page sends.
var FORMS = {
  contact: {
    title: 'Website Message', short: 'message', delivery: 'digest',
    label: 'Message', formName: 'Message button (site menu, any page)',
    replySubject: 'Your message to 804Michael',
    detail: function (f) { return f.from_name; },
    rows: [['Name', 'from_name'], ['Email', 'from_email'], ['Phone', 'phone'],
           ['Message', 'message', 'long']]
  },
  seller: {
    title: 'New Seller Lead', short: 'seller', delivery: 'immediate',  // speed matters on listings
    label: 'Seller', formName: 'Seller Intake form (804re.com/seller-intake)',
    replySubject: 'Your home sale inquiry with 804Michael',
    detail: function (f) { return f.from_name + ', ' + f.address + ', ' + f.city + ' (' + f.timeline + ')'; },
    rows: [['Name', 'from_name'], ['Preferred Contact', 'preferred_contact'], ['Best Time to Reach', 'preferred_time'],
           ['Email', 'from_email'], ['Phone', 'phone'],
           ['Street', 'address'], ['City', 'city'], ['State', 'state'], ['Zip', 'zip'],
           ['Timeline', 'timeline'], ['Reason for Selling', 'reason'], ['Has a Mortgage', 'mortgage_status'],
           ['Occupancy', 'occupancy'], ['Already Has an Agent', 'has_agent'], ['Notes', 'notes', 'long']]
  },
  buyer: {
    title: 'New Buyer Lead', short: 'buyer', delivery: 'digest',
    label: 'Buyer', formName: 'Buyer Intake form (804re.com/buyer-intake)',
    replySubject: 'Your home search with 804Michael',
    detail: function (f) { return f.from_name + ' (' + f.budget + ', ' + f.timeline + ')'; },
    rows: [['Name', 'from_name'], ['Preferred Contact', 'preferred_contact'], ['Best Time to Reach', 'preferred_time'],
           ['Email', 'from_email'], ['Phone', 'phone'],
           ['Timeline', 'timeline'], ['Budget', 'budget'], ['Areas of Interest', 'areas'],
           ['Financing', 'financing'], ['Already Has an Agent', 'has_agent'], ['Notes', 'notes', 'long']]
  },
  valuation: {
    title: 'New Home Value Request', short: 'home value', delivery: 'digest',
    label: 'Home Value', formName: 'Home Value form',
    replySubject: 'Your home value request with 804Michael',
    detail: function (f) { return f.from_name + ', ' + f.address; },
    rows: [['Name', 'from_name'], ['Preferred Contact', 'preferred_contact'], ['Email', 'from_email'], ['Phone', 'phone'],
           ['Street', 'address'], ['City', 'city'], ['State', 'state'], ['Zip', 'zip'], ['Notes', 'notes', 'long']]
  },
  map: {
    title: 'Home Search Map', short: 'map', delivery: 'digest',
    label: 'Map', formName: 'Map Search share form (804re.com/map-search)',
    replySubject: 'Your home search map',
    detail: function (f) { return f.from_name; },
    rows: [['Name', 'from_name'], ['Email', 'from_email'], ['Map', 'map_url', 'link'], ['Their Note', 'message', 'long']]
  }
  // An immediate form with a second recipient looks like this (no page sends
  // it yet; a webinar signup page would need building first):
  // , webinar: {
  //   title: 'Webinar Registration', short: 'webinar', delivery: 'immediate',
  //   alsoTo: ['partner@example.com'],
  //   label: 'Webinar', formName: 'Webinar signup page', replySubject: 'Your webinar registration',
  //   detail: function (f) { return f.from_name; },
  //   rows: [['Name', 'from_name'], ['Email', 'from_email'], ['Phone', 'phone']]
  // }
};

function setupSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// Schedules sendDigest once a day at each hour in DIGEST_HOURS, replacing any
// digest schedule already installed. Run again after changing DIGEST_HOURS.
function installDigestTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDigest') ScriptApp.deleteTrigger(t);
  });
  DIGEST_HOURS.forEach(function (h) {
    ScriptApp.newTrigger('sendDigest').timeBased().atHour(h).everyDays(1).create();
  });
  Logger.log('Digest scheduled daily at ' + DIGEST_HOURS.join(', ') + ' (' + Session.getScriptTimeZone() + ')');
}

function digestInstalled() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sendDigest'; });
  } catch (e) { return false; }
}

// Control characters (codes 0-31 and 127), built from character codes so
// this file stays plain ASCII. A raw NUL character in the source makes
// copy-paste stop at that point, which cut the first paste of this file short.
var CTRL = charClass([[0, 31], [127, 127]]);
var CTRL_KEEP_NEWLINE = charClass([[0, 9], [11, 31], [127, 127]]);
function charClass(ranges) {
  return new RegExp('[' + ranges.map(function (r) {
    return String.fromCharCode(r[0]) + '-' + String.fromCharCode(r[1]);
  }).join('') + ']', 'g');
}

// Text in, safe cell value out: trimmed, control characters removed,
// capped, and never starting with a formula character.
function clean(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(CTRL, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// Same as clean() but keeps line breaks (for messages and notes in the email).
function text(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v);
  return s.replace(/\r\n?/g, '\n').replace(CTRL_KEEP_NEWLINE, ' ').trim().slice(0, max);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.company) return json({ status: 'ok' }); // honeypot tripped

    var form = FORMS[data.form];
    if (!form) return json({ status: 'error', message: 'unknown form' });

    // Only the fields this form defines, each one capped.
    var f = {}, raw = data.fields || {};
    form.rows.forEach(function (r) {
      f[r[1]] = text(raw[r[1]], r[2] === 'long' ? 3000 : 300) || '(not provided)';
    });
    var page = text(data.page_url, 300);
    if (!/^https:\/\/(www\.)?804re\.com\//.test(page)) page = '';

    var cache = CacheService.getScriptCache();
    var fingerprint = Utilities.base64Encode(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, data.form + JSON.stringify(f)));
    if (cache.get('dup:' + fingerprint)) return json({ status: 'ok', duplicate: true });

    var immediate = form.delivery === 'immediate' || !digestInstalled();
    var emailed = 'queued';
    if (immediate) {
      var hourKey = 'count:' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMddHH');
      var sentThisHour = parseInt(cache.get(hourKey) || '0', 10);
      var recipients = 1 + (form.alsoTo || []).length;
      if (sentThisHour >= MAX_PER_HOUR) {
        emailed = 'queued (hourly cap)';
      } else if (MailApp.getRemainingDailyQuota() < recipients) {
        emailed = 'queued (daily quota)';
      } else {
        sendLeadEmail(form, f, page);
        cache.put(hourKey, String(sentThisHour + 1), 3600);
        emailed = 'yes';
      }
    }
    cache.put('dup:' + fingerprint, '1', 600);

    logLead(data.form, f, page, emailed);
    return json({ status: 'ok', delivery: emailed === 'yes' ? 'sent' : 'queued' });
  } catch (err) {
    return json({ status: 'error', message: err.message });
  }
}

// The table of one lead's fields, shared by single emails and digests.
function leadTableHtml(form, f, page) {
  var rowsHtml = form.rows.map(function (r) {
    var raw = f[r[1]] === undefined ? '(not provided)' : f[r[1]];
    var v = esc(raw);
    if (r[2] === 'long') v = '<span style="white-space:pre-wrap">' + v + '</span>';
    if (r[2] === 'link' && /^https:\/\//.test(raw)) v = '<a href="' + esc(raw) + '">' + v + '</a>';
    return '<tr><td valign="top"><b>' + esc(r[0]) + ':</b></td><td>' + v + '</td></tr>';
  }).join('');
  return '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    '<tr><td><b>Form:</b></td><td>' + esc(form.formName || form.title) + '</td></tr>' +
    rowsHtml +
    '<tr><td><b>Page:</b></td><td>' + (page ? '<a href="' + esc(page) + '">' + esc(page) + '</a>' : '(not recorded)') + '</td></tr>' +
    '</table>';
}

function leadPlain(form, f, page) {
  return 'Form: ' + (form.formName || form.title) + '\n' +
         form.rows.map(function (r) { return r[0] + ': ' + (f[r[1]] === undefined ? '(not provided)' : f[r[1]]); }).join('\n') +
         '\nPage: ' + (page || '(not recorded)');
}

// Subject of an immediate email, e.g.
// "(red !) Seller LEAD from 804re.com: Jane Doe, 1 Main St, Ashland (1-3 months)".
function leadSubject(form, f) {
  var detail = form.detail ? form.detail(f) : f.from_name;
  return (ALERT + ' ' + (form.label || form.title) + ' LEAD from 804re.com: ' + detail).slice(0, 200);
}

// "Reply to Jane" link with a subject the client can see. Hitting Reply on
// the notification would show them "Re: ... LEAD from 804re.com" instead.
function replyLinkHtml(form, f) {
  if (!isEmail(f.from_email)) return '<p style="color:#666">No email given; use the phone number above.</p>';
  return '<p><a href="mailto:' + encodeURIComponent(f.from_email) + '?subject=' +
    encodeURIComponent(form.replySubject || 'Following up from 804Michael') + '">Reply to ' +
    esc(f.from_name || f.from_email) + '</a></p>';
}

function sendLeadEmail(form, f, page) {
  var html = '<p><strong>' + esc(form.title) + '</strong></p>' + leadTableHtml(form, f, page) + replyLinkHtml(form, f) +
    '<p style="font-size:12px;color:#666">The link above answers ' + esc(f.from_name) + ' with a client-friendly ' +
    'subject. Hitting Reply also reaches them, but they would see this subject line.</p>';
  var options = { htmlBody: html, name: SENDER_NAME };
  if (isEmail(f.from_email)) options.replyTo = f.from_email;
  var to = [TO_EMAIL].concat(form.alsoTo || []).join(',');
  MailApp.sendEmail(to, leadSubject(form, f), form.title + '\n\n' + leadPlain(form, f, page), options);
}

// Emails every row whose Emailed column starts with "queued" as ONE message,
// then marks those rows with the digest time. Sends nothing when none wait.
function sendDigest() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var values = sheet.getDataRange().getValues();
    var headers = values[0];
    var cT = headers.indexOf('Timestamp'), cF = headers.indexOf('Form'), cP = headers.indexOf('Page'),
        cE = headers.indexOf('Emailed'), cD = headers.indexOf('Data');
    if (cE < 0 || cD < 0) throw new Error('Sheet headers are out of date: run setupSheet() once.');

    var pending = [];
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][cE]).indexOf('queued') === 0) pending.push(r);
    }
    if (!pending.length) return 'nothing queued';
    if (MailApp.getRemainingDailyQuota() < 1) return 'daily quota used up; will retry at the next digest hour';

    var tz = Session.getScriptTimeZone();
    var counts = {}, htmlParts = [], plainParts = [];
    pending.forEach(function (r) {
      var key = String(values[r][cF]);
      var f = {};
      try { f = JSON.parse(values[r][cD]); } catch (e) { f = {}; }
      var form = FORMS[key] || { title: key, short: key,
        rows: Object.keys(f).map(function (k) { return [k, k]; }) };
      var page = String(values[r][cP] || '');
      var when = Utilities.formatDate(new Date(values[r][cT]), tz, 'EEE MMM d, h:mm a');
      counts[form.short] = (counts[form.short] || 0) + 1;

      var reply = replyLinkHtml(form, f);
      htmlParts.push('<h3 style="font-family:Arial,sans-serif;margin:24px 0 8px">' + esc(form.title) +
        ' <span style="font-weight:normal;color:#666">&middot; ' + esc(when) + '</span></h3>' +
        leadTableHtml(form, f, page) + reply);
      plainParts.push(form.title + ' (' + when + ')\n' + leadPlain(form, f, page));
    });

    var summary = Object.keys(counts).map(function (k) { return counts[k] + ' ' + k; }).join(', ');
    var subject = ALERT + ' Lead digest from 804re.com: ' + pending.length + ' new (' + summary + ')';
    var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
    var html = '<p style="font-family:Arial,sans-serif"><strong>' + pending.length + ' new lead' +
      (pending.length === 1 ? '' : 's') + '</strong> since the last digest. ' +
      '<a href="' + esc(sheetUrl) + '">Open the lead log</a></p>' + htmlParts.join('<hr>');
    MailApp.sendEmail(TO_EMAIL, subject, plainParts.join('\n\n----\n\n') + '\n\nLead log: ' + sheetUrl,
                      { htmlBody: html, name: SENDER_NAME });

    var stamp = 'digest ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    pending.forEach(function (r) { sheet.getRange(r + 1, cE + 1).setValue(stamp); });
    return 'sent ' + pending.length;
  } finally {
    lock.releaseLock();
  }
}

function logLead(formKey, f, page, emailed) {
  var details = Object.keys(f).filter(function (k) {
    return ['from_name', 'from_email', 'phone'].indexOf(k) < 0;
  }).map(function (k) { return k + ': ' + f[k]; }).join(' | ');
  var values = {
    'Timestamp': new Date(),
    'Form': formKey,
    'Name': clean(f.from_name, 120),
    'Email': clean(f.from_email, 200),
    'Phone': clean(f.phone, 40),
    'Details': clean(details, 5000),
    'Page': clean(page, 300),
    'Emailed': clean(emailed, 60),
    'Data': JSON.stringify(f)   // starts with "{", so it can never read as a formula
  };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return values.hasOwnProperty(h) ? values[h] : ''; });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { sheet.appendRow(row); } finally { lock.releaseLock(); }
}

// Run from the editor: logs a test lead, then sends the digest right away,
// so one run proves the Sheet, the digest and email delivery all work.
function sendTestLead() {
  var out = doPost({ postData: { contents: JSON.stringify({
    form: 'contact',
    page_url: 'https://804re.com/',
    fields: { from_name: 'Test Lead', from_email: TO_EMAIL, phone: '804-000-0000',
              message: 'This is a test from sendTestLead().\nSecond line.' }
  }) } });
  Logger.log('doPost: ' + out.getContent());
  Logger.log('sendDigest: ' + sendDigest() + '  | emails left today: ' + MailApp.getRemainingDailyQuota());
}

function doGet() {
  return ContentService.createTextOutput('804re.com lead mailer is live.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
