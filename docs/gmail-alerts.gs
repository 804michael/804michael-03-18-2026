/**
 * Gmail to Pushover alert bridge
 *
 * Replaces Verizon's email-to-text forwarding. That path has been unreliable
 * for a while and the carrier gateway behind it (vtext.com) is scheduled to
 * shut down 2027-03-31, after T-Mobile's died in late 2024 and AT&T's in June
 * 2025. When those stop, messages are dropped silently with no bounce, which
 * is the worst possible failure for an alerting path.
 *
 * WHAT IT DOES
 *   Every 5 minutes it looks for Gmail messages carrying one of the alert
 *   labels below, sends a Pushover notification for each new one, and records
 *   the message id so it is never sent twice. Tracking is per MESSAGE, not per
 *   thread, so a later reply on an already-alerted thread still notifies.
 *
 * SETUP
 *   1. Gmail > Settings > Labels > create two labels, named exactly:
 *        alert-critical
 *        alert-normal
 *   2. Gmail > Settings > Filters > new filter > "Apply the label". Start
 *      narrow, one or two senders, and widen once you trust it. Anything the
 *      filter catches becomes an alert.
 *   3. script.google.com > New project > paste this file in.
 *   4. Project Settings > Script Properties > add two properties:
 *        PUSHOVER_TOKEN   app token from pushover.net/apps/build
 *        PUSHOVER_USER    your user key from the Pushover dashboard
 *      Properties keep the keys out of the code, the same reason the site's
 *      API keys live in the Cloudflare dashboard and not in this repo.
 *   5. Run installTrigger() once and approve the OAuth prompt. It will warn
 *      that the app is unverified; that is expected for your own script.
 *   6. Run sendTestAlert() to confirm Pushover is wired up.
 *
 * FIRST RUN IS SILENT ON PURPOSE. It marks everything it already finds as
 * seen and notifies nothing, so labelling a filter retroactively does not
 * dump a hundred alerts on your phone. Real alerts start from run two.
 *
 * COST: none. This uses 288 runs a day against limits far above that.
 *
 * LATER: to route through the site instead of straight to Pushover, change
 * ENDPOINT to https://804re.com/api/notify and adjust the payload built in
 * send(). Nothing else in this file needs to move.
 */

'use strict';

// -- Config ---------------------------------------------------------------
var ENDPOINT = 'https://api.pushover.net/1/messages.json';

var RULES = [
  {
    label: 'alert-critical',
    priority: 2,      // repeats until you acknowledge it on the device
    sound: 'siren',
    retry: 60,        // seconds between repeats; Pushover's minimum is 30
    expire: 1800      // stop after 30 min; Pushover's max is 10800
  },
  {
    label: 'alert-normal',
    priority: 0,      // ordinary notification, respects quiet hours
    sound: 'pushover'
  }
];

// Only look at recent mail. Anything older was either already handled or is
// not worth waking you for, and it keeps each search cheap.
var SEARCH_WINDOW = 'newer_than:2d';
var MAX_THREADS_PER_RUN = 15;

// Script Properties cap a single value at 9KB, so cap the seen-list well
// under that. Message ids run about 16 characters.
var MAX_SEEN_IDS = 400;

// -- Main -----------------------------------------------------------------
function checkMail() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('PUSHOVER_TOKEN');
  var user  = props.getProperty('PUSHOVER_USER');

  if (!token || !user) {
    console.error('PUSHOVER_TOKEN or PUSHOVER_USER missing from Script Properties. Nothing sent.');
    return;
  }

  var priming = props.getProperty('PRIMED') !== 'yes';
  var seen = loadSeen(props);
  var seenSet = {};
  for (var i = 0; i < seen.length; i++) seenSet[seen[i]] = true;

  var sentCount = 0;
  var newIds = [];

  for (var r = 0; r < RULES.length; r++) {
    var rule = RULES[r];
    var threads;

    try {
      threads = GmailApp.search('label:' + rule.label + ' ' + SEARCH_WINDOW, 0, MAX_THREADS_PER_RUN);
    } catch (err) {
      console.error('Search failed for ' + rule.label + ': ' + err);
      continue;
    }

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();

      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];
        var id = msg.getId();
        if (seenSet[id]) continue;

        // On the very first run, record without notifying.
        if (priming) {
          seenSet[id] = true;
          newIds.push(id);
          continue;
        }

        if (send(token, user, rule, msg, threads[t])) {
          sentCount++;
          seenSet[id] = true;
          newIds.push(id);
        }
        // A message that failed to send stays unrecorded, so the next run
        // retries it. See send() for which failures count as permanent.
      }
    }
  }

  if (newIds.length) saveSeen(props, seen.concat(newIds));

  if (priming) {
    props.setProperty('PRIMED', 'yes');
    console.log('Primed: marked ' + newIds.length + ' existing message(s) as seen. Alerts start next run.');
  } else if (sentCount) {
    console.log('Sent ' + sentCount + ' alert(s).');
  }
}

// -- Sending --------------------------------------------------------------
function send(token, user, rule, msg, thread) {
  var payload = {
    token: token,
    user: user,
    title: truncate(msg.getFrom(), 100),
    message: truncate(msg.getSubject() || '(no subject)', 200) + '\n\n' + truncate(msg.getPlainBody(), 600),
    url: 'https://mail.google.com/mail/u/0/#all/' + thread.getId(),
    url_title: 'Open in Gmail',
    priority: rule.priority,
    sound: rule.sound
  };

  if (rule.priority === 2) {
    payload.retry = rule.retry;
    payload.expire = rule.expire;
  }

  var res;
  try {
    res = UrlFetchApp.fetch(ENDPOINT, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('Request threw, will retry next run: ' + err);
    return false;
  }

  var code = res.getResponseCode();
  if (code === 200) return true;

  console.error('Pushover returned ' + code + ': ' + res.getContentText());

  // 4xx means Pushover rejected the message itself (bad token, malformed
  // field). Retrying that every 5 minutes forever would only fill the log,
  // so treat it as handled. 5xx and network errors are transient, so leave
  // the message unrecorded and try again next run.
  return code >= 400 && code < 500;
}

// -- Seen-list storage ----------------------------------------------------
function loadSeen(props) {
  var raw = props.getProperty('SEEN_IDS');
  return raw ? raw.split(',') : [];
}

function saveSeen(props, ids) {
  if (ids.length > MAX_SEEN_IDS) ids = ids.slice(ids.length - MAX_SEEN_IDS);
  props.setProperty('SEEN_IDS', ids.join(','));
}

// -- Helpers --------------------------------------------------------------
function truncate(s, n) {
  s = (s || '').toString().replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// -- One-off maintenance functions, run by hand ---------------------------
function installTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(5).create();
  console.log('Trigger installed: checkMail every 5 minutes.');
}

function sendTestAlert() {
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      token: props.getProperty('PUSHOVER_TOKEN'),
      user: props.getProperty('PUSHOVER_USER'),
      title: 'Gmail bridge',
      message: 'Test alert. If you can read this, the script is wired up correctly.',
      priority: 0
    }
  });
  console.log(res.getResponseCode() + ': ' + res.getContentText());
}

/**
 * Clears the seen-list and the primed flag. Use this after changing which
 * labels are watched. It does NOT resend old alerts, because the next run
 * primes silently again.
 */
function resetState() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('SEEN_IDS');
  props.deleteProperty('PRIMED');
  console.log('State cleared. Next run will prime silently.');
}
