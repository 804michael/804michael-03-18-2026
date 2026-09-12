/**
 * Seasonal Decoration Map: receives "Add a House" submissions from
 * seasonal-map.html and appends them to the map's own Google Sheet.
 *
 * This is deliberately a SEPARATE Sheet and script from the Farm Stand
 * (docs/addstand.gs). One Sheet serves both seasons: the Season column
 * says which map a row belongs to, and Year keeps last year's houses from
 * reappearing automatically.
 *
 * SETUP (one time, about 10 minutes, signed in as 804re.com@gmail.com):
 *  1. Create a new Google Sheet, e.g. "Seasonal Decoration Map".
 *  2. Extensions > Apps Script. Paste this whole file in (replace the
 *     sample code). Save.
 *  3. Run setupSheet() once from the editor (pick it in the function
 *     dropdown, click Run, approve the permissions). It writes the header
 *     row below into the first tab.
 *  4. Deploy > New deployment > type: Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *     Copy the Web app URL into SUBMIT_URL in seasonal-map.html.
 *  5. In the Sheet: File > Share > Publish to web > pick the first tab,
 *     format "Comma-separated values (.csv)" > Publish. Copy that URL into
 *     CSV_URL in seasonal-map.html.
 *
 * COLUMNS (setupSheet writes these; the page matches them by name, so the
 * order can change but the names cannot):
 *   Timestamp | Season | Year | Name | Address | Category | When |
 *   Description | Lat | Lng | Owner OK | Source | Approved
 *
 * MODERATION: every row arrives with Approved = FALSE. The page shows a row
 * only when Approved is exactly TRUE, Season matches, and Year is this
 * season's year (or blank). To carry a favourite house into next year,
 * change its Year rather than resubmitting it.
 *
 * SAFETY:
 *  - Honeypot: the page has an invisible "company" field. People never see
 *    it; form-filling bots do. A filled one is accepted silently and dropped.
 *  - Formula injection: a cell that starts with = + - or @ is prefixed with
 *    an apostrophe, so a submission can't run as a Sheets formula. The
 *    apostrophe isn't displayed and isn't included in the published CSV.
 *  - Every text field is length-capped.
 *
 * FAILED ADDRESS LOOKUP: the page normally sends coordinates (GPS, or a
 * picked autocomplete suggestion). If a row ever arrives with an address
 * but no coordinates, it is geocoded here; if that fails the row is still
 * saved, flagged "NEEDS ADDRESS FIX" in Description, and emailed to you.
 */

var HEADERS = ['Timestamp', 'Season', 'Year', 'Name', 'Address', 'Category', 'When',
               'Description', 'Lat', 'Lng', 'Owner OK', 'Source', 'Approved'];
var SEASONS = ['halloween', 'christmas'];

function setupSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// Text in, safe cell value out: trimmed, control characters removed,
// capped, and never starting with a formula character.
function clean(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function num(v) {
  var n = parseFloat(v);
  return isFinite(n) ? n : '';
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.company) return json({ status: 'ok' }); // honeypot tripped

    var season = String(data.season || '').toLowerCase();
    if (SEASONS.indexOf(season) < 0) return json({ status: 'error', message: 'unknown season' });
    if (data.ownerOk !== true) return json({ status: 'error', message: 'owner confirmation missing' });

    var year = parseInt(data.year, 10);
    if (!(year >= 2024 && year <= 2100)) year = new Date().getFullYear();

    var lat = num(data.lat), lng = num(data.lng);
    var address = clean(data.address, 160);
    var description = clean(data.description, 500);
    var geocodeFailed = false;

    if ((lat === '' || lng === '') && address) {
      var result = Maps.newGeocoder().geocode(address + ', VA');
      if (result.status === 'OK' && result.results.length) {
        lat = result.results[0].geometry.location.lat;
        lng = result.results[0].geometry.location.lng;
        address = clean(result.results[0].formatted_address || address, 160);
      } else {
        geocodeFailed = true;
        description = clean('NEEDS ADDRESS FIX: lookup could not find this address. ' + description, 600);
      }
    }

    var values = {
      'Timestamp': new Date(),
      'Season': season,
      'Year': year,
      'Name': clean(data.name, 80),
      'Address': address,
      'Category': clean(data.category, 120),
      'When': clean(data.when, 80),
      'Description': description,
      'Lat': lat,
      'Lng': lng,
      'Owner OK': 'Yes',
      'Source': clean(data.source, 40),
      'Approved': 'FALSE'
    };

    // Write by header name, so a reordered or extended sheet still works.
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = headers.map(function (h) { return values.hasOwnProperty(h) ? values[h] : ''; });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { sheet.appendRow(row); } finally { lock.releaseLock(); }

    if (geocodeFailed) {
      try {
        MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
          'Seasonal map: address needs a fix (' + season + ')',
          'A submission came in whose address could not be placed on the map.\n\n' +
          'Address entered: ' + address + '\n\n' +
          'The row is saved with blank Lat/Lng and flagged NEEDS ADDRESS FIX. ' +
          'Fix the address or paste coordinates in, then set Approved to TRUE.');
      } catch (mailErr) { Logger.log('Email failed: ' + mailErr.message); }
    }
    return json({ status: 'ok' });
  } catch (err) {
    return json({ status: 'error', message: err.message });
  }
}

function doGet() {
  return ContentService.createTextOutput('Seasonal map submission endpoint is live.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
