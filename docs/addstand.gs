/**
 * Receives "Add a Stand" submissions (name, category, description, days
 * available, open/close time, lat, lng) from the map page and appends
 * them to the same response sheet used by the Google Form, so both
 * paths feed one map.
 *
 * DEPLOY (signed in as 804re.com@gmail.com, the site's Google account; the
 * Farm Stand Sheet, Form and scripts are moving there from the personal
 * account, which gives this web app a new URL for ADD_STAND_URL):
 *  1. In the response Sheet: Extensions > Apps Script.
 *  2. Paste this in its own script file (e.g. "addstand.gs") — keep it
 *     separate from the geocode-on-submit.gs file since function names
 *     differ but mixing code into one file has caused mix-ups before.
 *  3. Make sure the sheet header row includes these columns (current
 *     short names shown first; the script also still recognizes the
 *     older long names if the sheet ever reverts):
 *     Timestamp | Name | Address | Category | Description |
 *     Days | Open | Close | Hours | Lat | Lng | Approved
 *     (Address, Days, Open, Close can stay blank for GPS submissions
 *     or multi-range entries that use Hours instead — that's expected.)
 *  4. Deploy > New deployment > type: Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *  5. Copy the deployment URL into ADD_STAND_URL in the map's <script> config.
 *
 * HEADER MATCHING: column lookups try the CURRENT header name first,
 * then fall back to older names, so this keeps working even if the
 * sheet gets renamed again later without needing a code change.
 *
 * MODERATION: every row is written with Approved = FALSE so nothing
 * appears on the public map until you flip that cell to TRUE.
 *
 * SAFETY: every visitor-typed field goes through clean() before it is
 * written: trimmed, control characters removed, length-capped, and
 * prefixed with an apostrophe if it starts with = + - or @, so a
 * submission can't run as a Sheets formula. The apostrophe isn't
 * displayed and isn't included in the published CSV. Lat/Lng must be
 * numbers. (Same approach as docs/seasonal-submit.gs.)
 *
 * ADDRESS NORMALIZATION: when a manually-typed address geocodes
 * successfully, the sheet's Address cell is overwritten with Google's own
 * formatted result ("Street, City, State Zip") instead of whatever the
 * visitor typed — keeps the sheet consistent even from loose input like
 * "Ashland". If geocoding fails, the visitor's original text is kept as-is
 * (see FAILED ADDRESS LOOKUP below).
 *
 * FAILED ADDRESS LOOKUP: if a manually-typed address can't be geocoded,
 * the row is still saved (with blank Lat/Lng) but its Description cell
 * is prefixed with "⚠️ NEEDS ADDRESS FIX" so it's obvious during review,
 * and an email is sent to the script owner (you) right away so you don't
 * have to go looking for it. Fix the address in the sheet, then either
 * re-run geocodeRow/geocodeMissingRows from the geocode script, or paste
 * coordinates in by hand.
 */

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
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // Try each candidate header name in order, return the first that exists.
    function col() {
      for (var i = 0; i < arguments.length; i++) {
        var idx = headers.indexOf(arguments[i]);
        if (idx > -1) return idx + 1;
      }
      return 0;
    }

    var lat = num(data.lat);
    var lng = num(data.lng);
    var geocodeFailed = false;
    var addressForSheet = clean(data.address, 200);

    // Fallback: if no coordinates but an address was typed manually (GPS
    // was unavailable/denied on the visitor's device), geocode it here
    // server-side, same approach as the Form's onFormSubmit script.
    if ((!lat || !lng) && data.address) {
      var geocoder = Maps.newGeocoder();
      var fullAddress = data.address + ", Hanover County, VA";
      var result = geocoder.geocode(fullAddress);
      if (result.status === "OK" && result.results.length > 0) {
        var loc = result.results[0].geometry.location;
        lat = loc.lat;
        lng = loc.lng;
        // Overwrite whatever the visitor typed with Google's own normalized
        // result ("Street, City, State Zip"), so the sheet stays consistent
        // no matter how loosely the address was entered (e.g. "Ashland").
        if (result.results[0].formatted_address) {
          addressForSheet = clean(result.results[0].formatted_address, 200);
        }
      } else {
        geocodeFailed = true;
        Logger.log("doPost geocode failed for: " + fullAddress + " (status: " + result.status + ")");
        // Row still gets saved below with blank Lat/Lng — flagged in the
        // Description column and emailed to you so it's easy to catch.
      }
    }

    var row = new Array(lastCol).fill("");

    var c;
    if ((c = col("Timestamp")) > 0)        row[c - 1] = new Date();
    if ((c = col("Name", "Farm Name", "Farm/Vendor Name")) > 0) row[c - 1] = clean(data.name, 120);
    if ((c = col("Address")) > 0)          row[c - 1] = addressForSheet;
    if ((c = col("Category", "Goods Sold", "Good Sold")) > 0) row[c - 1] = clean(data.category, 200);
    if ((c = col("Description")) > 0) {
      row[c - 1] = geocodeFailed
        ? "⚠️ NEEDS ADDRESS FIX — automatic lookup couldn't find this address. " + clean(data.description, 1000)
        : clean(data.description, 1000);
    }
    if ((c = col("Website", "Website or Social Link", "Link", "Social Link")) > 0) row[c - 1] = clean(data.website, 300);
    if ((c = col("Days", "Days Available")) > 0)   row[c - 1] = clean(data.days, 80);
    if ((c = col("Open", "Open Time")) > 0)        row[c - 1] = clean(data.openTime, 20);
    if ((c = col("Close", "Close Time")) > 0)      row[c - 1] = clean(data.closeTime, 20);
    if ((c = col("Hours", "Hours or Dates Available")) > 0) row[c - 1] = clean(data.hours, 300); // legacy fallback field
    if ((c = col("Lat")) > 0)              row[c - 1] = lat;
    if ((c = col("Lng")) > 0)              row[c - 1] = lng;
    if ((c = col("Approved")) > 0)         row[c - 1] = "FALSE";

    sheet.appendRow(row);

    if (geocodeFailed) {
      try {
        MailApp.sendEmail(
          Session.getEffectiveUser().getEmail(),
          "Farmstand Trail: address needs manual fix — " + (data.name || "Unnamed stand"),
          "A new stand submission came in but the address couldn't be automatically located on the map:\n\n" +
          "Name: " + (data.name || "") + "\n" +
          "Address entered: " + (data.address || "") + "\n\n" +
          "The row was still saved to the sheet with blank Lat/Lng, and its Description column is flagged " +
          "with a ⚠️ NEEDS ADDRESS FIX note. Open the Sheet, fix or clarify the address, then either " +
          "run geocodeRow (set the row number first) or geocodeMissingRows from the geocode script, or paste " +
          "coordinates in by hand."
        );
      } catch (mailErr) {
        Logger.log("Failed to send geocode-failure email: " + mailErr.message);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({status: "ok"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({status: "error", message: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Farmstand Trail add-a-stand endpoint is live.");
}
