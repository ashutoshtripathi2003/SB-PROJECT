/**
 * Client Greetings
 *
 * Sends birthday and festival wishes to clients from your Gmail, using a
 * Google Sheet as the client list. Paste this whole file into
 * Extensions → Apps Script of your Google Sheet (see README.md).
 *
 * Sheets it uses (created by "Set up sheets"):
 *   Clients    – one row per client
 *   Occasions  – Birthday + festivals, with date, subject and message
 *   Settings   – mode (SEND / DRAFT / TEST), company name, signature …
 *   Log        – every email sent or drafted; also stops double-sending
 */

const SHEETS = {
  CLIENTS: 'Clients',
  OCCASIONS: 'Occasions',
  SETTINGS: 'Settings',
  LOG: 'Log',
};

const BIRTHDAY = 'Birthday';

const CLIENT_HEADERS = [
  'Name', 'Greet As', 'Email', 'Company', 'Birthday',
  'Birthday Wishes', 'Festival Wishes', 'Notes',
];

const OCCASION_HEADERS = [
  'Occasion', 'Date', 'Every Year', 'Subject', 'Message', 'Image URL', 'Active', 'Notes',
];

const LOG_HEADERS = ['Logged At', 'For Date', 'Occasion', 'Name', 'Email', 'Status', 'Details'];

const DEFAULT_SETTINGS = [
  ['Setting', 'Value', 'What it does'],
  ['Mode', 'DRAFT',
    'SEND = email clients automatically. DRAFT = create Gmail drafts for you to check and send. ' +
    'TEST = send every greeting to the Test Email below instead of to clients.'],
  ['Your Company Name', 'Desire Chemicals', 'Used for {YourCompany} in messages.'],
  ['Sender Name', 'Desire Chemicals', 'The name clients see in the "From" field.'],
  ['Signature', 'Warm regards,\nTeam Desire Chemicals', 'Added at the end of every email.'],
  ['Test Email', '', 'Where TEST mode and "Send test email to me" go. Blank = your own Gmail.'],
  ['Daily Summary To', '', 'Optional. On days something is sent, a short summary is emailed here.'],
  ['Send Hour', 9, 'Hour of the day to send (0–23) in this sheet\'s time zone. 9 = between 9 and 10 AM.'],
  ['Reply To', '', 'Optional. Replies from clients go to this address.'],
];

const SAMPLE_CLIENTS = [
  ['Rajesh Sharma', 'Mr. Sharma', 'your.own.email@example.com', 'Sharma Industries', '15/08/1980', 'Yes', 'Yes',
    'Sample row – replace with real clients'],
];

const SAMPLE_OCCASIONS = [
  [BIRTHDAY, '', '', 'Happy Birthday, {GreetAs}!',
    'Dear {GreetAs},\n\n' +
    'On behalf of everyone at {YourCompany}, we wish you a very happy birthday!\n\n' +
    'Thank you for your continued trust and partnership. May the year ahead bring you good health, ' +
    'happiness and great success.\n\n' +
    'Have a wonderful day!',
    '', 'Yes', 'Date stays blank – each client\'s own birthday is used.'],
  ['Diwali', '08/11/2026', 'No', 'Happy Diwali from {YourCompany}',
    'Dear {GreetAs},\n\n' +
    'Wishing you and your family a very happy and prosperous Diwali! May this festival of lights ' +
    'bring joy, good health and success to you and your team.\n\n' +
    'Thank you for being a valued partner of {YourCompany}. We look forward to growing together ' +
    'in the year ahead.',
    '', 'Yes', 'Date changes every year – update it each year.'],
  ['Christmas', '25/12/2026', 'Yes', 'Season\'s Greetings from {YourCompany}',
    'Dear {GreetAs},\n\n' +
    'Wishing you and your loved ones a Merry Christmas and a joyful holiday season.\n\n' +
    'Thank you for your support and partnership this year.',
    '', 'Yes', 'Same date every year.'],
  ['New Year', '01/01/2027', 'Yes', 'Happy New Year {Year}, {GreetAs}!',
    'Dear {GreetAs},\n\n' +
    'Wishing you a very happy and prosperous New Year {Year}! May this year bring new opportunities, ' +
    'good health and success to you and your business.\n\n' +
    'We look forward to continuing our partnership in {Year}.',
    '', 'Yes', 'Same date every year.'],
  ['Holi', '22/03/2027', 'No', 'Happy Holi from {YourCompany}',
    'Dear {GreetAs},\n\n' +
    'Wishing you and your family a colourful and joyful Holi! May this festival fill your life ' +
    'with happiness, prosperity and success.',
    '', 'Yes', 'Date changes every year – please confirm the date.'],
  ['Eid', '', 'No', 'Eid Mubarak, {GreetAs}!',
    'Dear {GreetAs},\n\n' +
    'Eid Mubarak! Wishing you and your family peace, happiness and prosperity on this blessed occasion.',
    '', 'No', 'Date depends on the moon – fill in the date and set Active to Yes.'],
];

// Header colour and emoji per occasion (anything else uses DEFAULT_THEME).
const THEMES = {
  birthday: { color: '#8e44ad', emoji: '🎂' },
  diwali: { color: '#e67e22', emoji: '🪔' },
  christmas: { color: '#c0392b', emoji: '🎄' },
  'new year': { color: '#2c3e50', emoji: '🎉' },
  holi: { color: '#e91e63', emoji: '🎨' },
  eid: { color: '#16a085', emoji: '🌙' },
};
const DEFAULT_THEME = { color: '#2e7d32', emoji: '✨' };

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/* ───────────────────────────── Menu ───────────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎉 Greetings')
    .addItem('1. Set up sheets (first time only)', 'setupSheets')
    .addSeparator()
    .addItem('Preview today\'s greetings', 'previewToday')
    .addItem('Preview another date…', 'previewDate')
    .addItem('Send test email to me', 'sendTestEmail')
    .addSeparator()
    .addItem('Send today\'s greetings now', 'sendTodaysGreetingsFromMenu')
    .addItem('Turn ON daily automatic sending', 'installDailyTrigger')
    .addItem('Turn OFF daily automatic sending', 'removeDailyTrigger')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  const made = [];

  if (ensureSheet_(ss, SHEETS.CLIENTS, CLIENT_HEADERS, SAMPLE_CLIENTS)) made.push(SHEETS.CLIENTS);
  if (ensureSheet_(ss, SHEETS.OCCASIONS, OCCASION_HEADERS, SAMPLE_OCCASIONS)) made.push(SHEETS.OCCASIONS);
  if (ensureSheet_(ss, SHEETS.SETTINGS, DEFAULT_SETTINGS[0], DEFAULT_SETTINGS.slice(1))) made.push(SHEETS.SETTINGS);
  if (ensureSheet_(ss, SHEETS.LOG, LOG_HEADERS, [])) made.push(SHEETS.LOG);

  // Dates are typed as text (dd/mm/yyyy) so Google Sheets never swaps day and month.
  ss.getSheetByName(SHEETS.CLIENTS).getRange('E:E').setNumberFormat('@');
  ss.getSheetByName(SHEETS.OCCASIONS).getRange('B:B').setNumberFormat('@');

  SpreadsheetApp.getUi().alert(made.length
    ? 'Created: ' + made.join(', ') + '.\n\nNext: fill in the Clients sheet, check Settings, ' +
      'then use "Send test email to me".'
    : 'All sheets already exist – nothing changed.');
}

function ensureSheet_(ss, name, headers, rows) {
  if (ss.getSheetByName(name)) return false;
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
  if (rows.length) {
    // Write everything as text first so dd/mm/yyyy is never re-interpreted.
    sh.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
  }
  sh.getRange(1, 1, Math.max(rows.length + 1, 1), headers.length).setWrap(true).setVerticalAlignment('top');
  sh.autoResizeColumns(1, headers.length);
  return true;
}

/* ─────────────────────────── Menu actions ─────────────────────────── */

function previewToday() {
  showPreview_(new Date());
}

function previewDate() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Preview a date', 'Type a date as dd/mm/yyyy (e.g. 08/11/2026 for Diwali):',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const ymd = parseDate_(res.getResponseText());
  if (!ymd || !ymd.y) {
    ui.alert('Could not read that date. Please use dd/mm/yyyy.');
    return;
  }
  showPreview_(new Date(ymd.y, ymd.m - 1, ymd.d, 12));
}

function showPreview_(date) {
  const result = runGreetings_(date, { previewOnly: true });
  const lines = result.jobs.map(j => '• ' + j.occasion.name + ' → ' + j.client.name + ' <' + j.to + '>\n' +
    '   Subject: ' + j.subject);
  const warn = result.warnings.length ? '\n\nNotes:\n' + result.warnings.map(w => '• ' + w).join('\n') : '';
  SpreadsheetApp.getUi().alert(
    'Greetings for ' + result.dateLabel + ' (mode: ' + result.mode + ')',
    (lines.length ? lines.join('\n') : 'Nothing to send on this date.') + warn,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function sendTestEmail() {
  const ss = SpreadsheetApp.getActive();
  const settings = readSettings_(ss);
  const to = settings['test email'] || Session.getActiveUser().getEmail();
  const clients = readClients_(ss).clients;
  const sample = clients[0] || { name: 'Rajesh Sharma', greetAs: 'Mr. Sharma', company: 'Sharma Industries' };
  const occasions = readOccasions_(ss, ss.getSpreadsheetTimeZone()).occasions.filter(o => o.active);
  const year = Number(Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy'));

  if (!occasions.length) {
    SpreadsheetApp.getUi().alert('No active occasions found in the Occasions sheet.');
    return;
  }
  occasions.forEach(o => {
    const email = buildEmail_(o, sample, settings, o.date ? o.date.y || year : year);
    GmailApp.sendEmail(to, '[TEST] ' + email.subject, email.text, mailOptions_(settings, email.html));
  });
  SpreadsheetApp.getUi().alert('Sent ' + occasions.length + ' test email(s) to ' + to +
    ', one per active occasion, using "' + sample.name + '" as the example client.');
}

function sendTodaysGreetingsFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const preview = runGreetings_(new Date(), { previewOnly: true });
  if (!preview.jobs.length) {
    ui.alert('Nothing to send today (' + preview.dateLabel + ').');
    return;
  }
  const ok = ui.alert('Send now?', preview.jobs.length + ' greeting(s) for ' + preview.dateLabel +
    ' in ' + preview.mode + ' mode. Continue?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  const result = sendTodaysGreetings();
  ui.alert(result.summary);
}

function installDailyTrigger() {
  const ss = SpreadsheetApp.getActive();
  const settings = readSettings_(ss);
  let hour = parseInt(settings['send hour'], 10);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 9;

  removeTriggers_();
  ScriptApp.newTrigger('sendTodaysGreetings')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .inTimezone(ss.getSpreadsheetTimeZone())
    .create();
  SpreadsheetApp.getUi().alert('Daily sending is ON. Greetings will go out every day between ' +
    hour + ':00 and ' + (hour + 1) + ':00 (' + ss.getSpreadsheetTimeZone() + ').\n\n' +
    'Current mode: ' + (settings['mode'] || 'DRAFT').toUpperCase());
}

function removeDailyTrigger() {
  const n = removeTriggers_();
  SpreadsheetApp.getUi().alert(n ? 'Daily sending is OFF.' : 'Daily sending was already off.');
}

function removeTriggers_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendTodaysGreetings') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

/* ─────────────────────────── Daily job ─────────────────────────── */

/** Run by the daily trigger. Safe to run more than once a day: already-sent greetings are skipped. */
function sendTodaysGreetings() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Another greetings run is already in progress.');
  try {
    return runGreetings_(new Date(), { previewOnly: false });
  } finally {
    lock.releaseLock();
  }
}

function runGreetings_(date, opts) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const settings = readSettings_(ss);
  const mode = String(settings['mode'] || 'DRAFT').trim().toUpperCase();
  const today = dateToYmd_(date, tz);
  const dateKey = ymdKey_(today);
  const dateLabel = Utilities.formatDate(date, tz, 'EEE, dd MMM yyyy');

  const clientData = readClients_(ss);
  const occasionData = readOccasions_(ss, tz);
  const warnings = clientData.warnings.concat(occasionData.warnings);

  if (['SEND', 'DRAFT', 'TEST'].indexOf(mode) < 0) {
    warnings.push('Mode "' + mode + '" is not SEND, DRAFT or TEST – nothing will be sent.');
  }

  const jobs = planGreetings_(clientData.clients, occasionData.occasions, today)
    .map(j => {
      const email = buildEmail_(j.occasion, j.client, settings, today.y);
      return Object.assign(j, { to: j.client.emails.join(', '), subject: email.subject, email: email });
    });

  if (opts.previewOnly) return { jobs: jobs, warnings: warnings, mode: mode, dateLabel: dateLabel };

  const done = mode === 'TEST' ? {} : alreadyDone_(ss, dateKey);
  const testTo = settings['test email'] || Session.getEffectiveUser().getEmail();
  const counts = { SENT: 0, DRAFTED: 0, TEST: 0, SKIPPED: 0, ERROR: 0, 'NO QUOTA': 0 };
  const logRows = [];
  const log = (j, status, details) => {
    counts[status] = (counts[status] || 0) + 1;
    logRows.push([new Date(), dateKey, j.occasion.name, j.client.name, j.to, status, details || '']);
  };

  jobs.forEach(j => {
    if (['SEND', 'DRAFT', 'TEST'].indexOf(mode) < 0) return log(j, 'SKIPPED', 'Unknown mode ' + mode);
    if (done[doneKey_(j.occasion.name, j.to)]) return log(j, 'SKIPPED', 'Already sent/drafted today');

    try {
      const options = mailOptions_(settings, j.email.html);
      if (mode === 'DRAFT') {
        GmailApp.createDraft(j.to, j.email.subject, j.email.text, options);
        log(j, 'DRAFTED');
      } else {
        const recipients = mode === 'TEST' ? 1 : j.client.emails.length;
        if (MailApp.getRemainingDailyQuota() < recipients) return log(j, 'NO QUOTA', 'Gmail daily limit reached');
        if (mode === 'TEST') {
          GmailApp.sendEmail(testTo, '[TEST for ' + j.to + '] ' + j.email.subject, j.email.text, options);
          log(j, 'TEST', 'Sent to ' + testTo);
        } else {
          GmailApp.sendEmail(j.to, j.email.subject, j.email.text, options);
          log(j, 'SENT');
        }
      }
    } catch (e) {
      log(j, 'ERROR', String(e && e.message || e));
    }
  });

  if (logRows.length) {
    const sh = ss.getSheetByName(SHEETS.LOG) || ss.insertSheet(SHEETS.LOG);
    if (sh.getLastRow() === 0) sh.appendRow(LOG_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, logRows.length, LOG_HEADERS.length).setValues(logRows);
  }

  const parts = Object.keys(counts).filter(k => counts[k]).map(k => counts[k] + ' ' + k.toLowerCase());
  const summary = 'Greetings for ' + dateLabel + ' (' + mode + ' mode): ' +
    (parts.length ? parts.join(', ') : 'nothing to send') + '.' +
    (warnings.length ? '\n\nNotes:\n' + warnings.map(w => '• ' + w).join('\n') : '');

  const summaryTo = settings['daily summary to'];
  if (summaryTo && logRows.length) {
    const lines = logRows.map(r => r[2] + ' – ' + r[3] + ' <' + r[4] + '>: ' + r[5] + (r[6] ? ' (' + r[6] + ')' : ''));
    GmailApp.sendEmail(summaryTo, 'Client greetings – ' + dateLabel, summary + '\n\n' + lines.join('\n'));
  }

  console.log(summary);
  return { jobs: jobs, warnings: warnings, mode: mode, dateLabel: dateLabel, counts: counts, summary: summary };
}

/** Which (client, occasion) pairs are due on the given day. Pure function. */
function planGreetings_(clients, occasions, today) {
  const birthday = occasions.find(o => o.active && o.isBirthday);
  const festivals = occasions.filter(o => o.active && !o.isBirthday && occasionIsOn_(o, today));
  const jobs = [];

  clients.forEach(c => {
    if (!c.emails.length) return;
    if (birthday && c.birthdayWishes && c.birthday && birthdayIsOn_(c.birthday, today)) {
      jobs.push({ client: c, occasion: birthday });
    }
    if (c.festivalWishes) festivals.forEach(f => jobs.push({ client: c, occasion: f }));
  });
  return jobs;
}

function occasionIsOn_(o, today) {
  if (!o.date) return false;
  if (o.everyYear) return o.date.m === today.m && o.date.d === today.d;
  return o.date.y === today.y && o.date.m === today.m && o.date.d === today.d;
}

/** 29 Feb birthdays are wished on 28 Feb in non-leap years. */
function birthdayIsOn_(b, today) {
  if (b.m === today.m && b.d === today.d) return true;
  return b.m === 2 && b.d === 29 && today.m === 2 && today.d === 28 && !isLeapYear_(today.y);
}

function isLeapYear_(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function alreadyDone_(ss, dateKey) {
  const sh = ss.getSheetByName(SHEETS.LOG);
  const done = {};
  if (!sh || sh.getLastRow() < 2) return done;
  sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEADERS.length).getDisplayValues().forEach(r => {
    if (r[1] === dateKey && (r[5] === 'SENT' || r[5] === 'DRAFTED')) done[doneKey_(r[2], r[4])] = true;
  });
  return done;
}

function doneKey_(occasion, to) {
  return String(occasion).toLowerCase() + '|' + String(to).toLowerCase();
}

/* ─────────────────────────── Reading sheets ─────────────────────────── */

function readSettings_(ss) {
  const sh = ss.getSheetByName(SHEETS.SETTINGS);
  const out = {};
  DEFAULT_SETTINGS.slice(1).forEach(r => { out[r[0].toLowerCase()] = r[1]; });
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const key = String(r[0]).trim().toLowerCase();
    if (key) out[key] = typeof r[1] === 'string' ? r[1].trim() : r[1];
  });
  return out;
}

function readTable_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found. Use 🎉 Greetings → Set up sheets first.');
  if (sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim().toLowerCase());
  return values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, c) => { if (h) obj[h] = row[c]; });
    return obj;
  });
}

function readClients_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const warnings = [];
  const clients = [];
  readTable_(ss, SHEETS.CLIENTS).forEach(r => {
    const name = String(r['name'] || '').trim();
    const rawEmail = String(r['email'] || '').trim();
    if (!name && !rawEmail) return; // empty row
    const parsed = parseEmails_(rawEmail);
    if (parsed.bad.length || !parsed.good.length) {
      warnings.push('Clients row ' + r._row + ' (' + (name || 'no name') + '): check email "' + rawEmail + '"');
    }
    const birthday = r['birthday'] === '' || r['birthday'] == null ? null : toYmd_(r['birthday'], tz);
    if (r['birthday'] !== '' && r['birthday'] != null && !birthday) {
      warnings.push('Clients row ' + r._row + ' (' + name + '): could not read birthday "' + r['birthday'] + '"');
    }
    clients.push({
      row: r._row,
      name: name,
      greetAs: String(r['greet as'] || '').trim(),
      emails: parsed.good,
      company: String(r['company'] || '').trim(),
      birthday: birthday,
      birthdayWishes: yes_(r['birthday wishes']),
      festivalWishes: yes_(r['festival wishes']),
    });
  });
  return { clients: clients, warnings: warnings };
}

function readOccasions_(ss, tz) {
  const warnings = [];
  const occasions = [];
  readTable_(ss, SHEETS.OCCASIONS).forEach(r => {
    const name = String(r['occasion'] || '').trim();
    if (!name) return;
    const isBirthday = name.toLowerCase() === BIRTHDAY.toLowerCase();
    const active = yes_(r['active']);
    const date = isBirthday || r['date'] === '' || r['date'] == null ? null : toYmd_(r['date'], tz);
    const everyYear = String(r['every year'] || '').trim().toLowerCase().startsWith('y');
    if (active && !isBirthday && (!date || (!date.y && !everyYear))) {
      warnings.push('Occasions row ' + r._row + ' (' + name + '): needs a full date (dd/mm/yyyy).');
    }
    occasions.push({
      row: r._row,
      name: name,
      isBirthday: isBirthday,
      date: date,
      everyYear: everyYear,
      subject: String(r['subject'] || '').trim(),
      message: String(r['message'] || ''),
      imageUrl: String(r['image url'] || '').trim(),
      active: active,
    });
  });
  return { occasions: occasions, warnings: warnings };
}

/** Blank counts as Yes, so new clients get wished unless you opt them out. */
function yes_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '' || s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

function parseEmails_(raw) {
  const good = [];
  const bad = [];
  String(raw || '').split(/[,;\s]+/).filter(Boolean).forEach(e => {
    (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? good : bad).push(e);
  });
  return { good: good, bad: bad };
}

/* ─────────────────────────── Dates ─────────────────────────── */

function toYmd_(value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : dateToYmd_(value, tz);
  }
  return parseDate_(value);
}

function dateToYmd_(date, tz) {
  const p = Utilities.formatDate(date, tz, 'yyyy-MM-dd').split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

function ymdKey_(ymd) {
  return ymd.y + '-' + pad2_(ymd.m) + '-' + pad2_(ymd.d);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * Reads Indian-style dates: 15/08/1980, 15-08-1980, 15.08.1980, 15/08,
 * 15 Aug 1980, 15-Aug, Aug 15 1980, and ISO 1980-08-15.
 * Returns {y, m, d} (y is null when no year was given) or null.
 */
function parseDate_(value) {
  const s = String(value == null ? '' : value).trim().replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  if (!s) return null;
  let m;
  let y = null;
  let mo;
  let d;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2,4}))?$/))) {
    d = +m[1]; mo = +m[2]; y = m[3] ? fullYear_(+m[3]) : null;
  } else if ((m = s.match(/^(\d{1,2})[-/. ]+([a-z]+)\.?(?:[-/. ]+(\d{2,4}))?$/i))) {
    d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = m[3] ? fullYear_(+m[3]) : null;
  } else if ((m = s.match(/^([a-z]+)\.?[-/. ]+(\d{1,2})(?:[-/. ]+(\d{2,4}))?$/i))) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = m[3] ? fullYear_(+m[3]) : null;
  } else {
    return null;
  }

  if (!mo || mo < 1 || mo > 12 || d < 1) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > maxDay) return null;
  if (y && mo === 2 && d === 29 && !isLeapYear_(y)) return null;
  return { y: y, m: mo, d: d };
}

function fullYear_(y) {
  if (y >= 100) return y;
  return y <= 30 ? 2000 + y : 1900 + y;
}

/* ─────────────────────────── Email content ─────────────────────────── */

function buildEmail_(occasion, client, settings, year) {
  const firstName = String(client.name || '').split(/\s+/)[0] || '';
  const vars = {
    name: client.name || '',
    firstname: firstName,
    greetas: client.greetAs || firstName || 'Sir/Madam',
    company: client.company || '',
    yourcompany: settings['your company name'] || '',
    occasion: occasion.name,
    year: String(year || ''),
  };
  const fill = text => String(text || '').replace(/\{(\w+)\}/g, (all, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : all;
  });

  const subject = fill(occasion.subject) || (occasion.name + ' greetings from ' + vars.yourcompany);
  const body = fill(occasion.message).trim();
  const signature = String(settings['signature'] || '').trim();
  const text = body + (signature ? '\n\n' + signature : '');

  const theme = THEMES[occasion.name.toLowerCase()] || DEFAULT_THEME;
  const toHtml = t => escapeHtml_(t).replace(/\n/g, '<br>');
  const image = occasion.imageUrl
    ? '<img src="' + escapeHtml_(occasion.imageUrl) + '" alt="' + escapeHtml_(occasion.name) +
      '" style="display:block;width:100%;max-width:600px;height:auto;border:0">'
    : '';

  const html =
    '<div style="background:#f4f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.08)">' +
        '<div style="background:' + theme.color + ';color:#ffffff;padding:28px 24px;text-align:center">' +
          '<div style="font-size:40px;line-height:1">' + theme.emoji + '</div>' +
          '<div style="font-size:24px;font-weight:bold;margin-top:10px">' + escapeHtml_(subject) + '</div>' +
        '</div>' +
        image +
        '<div style="padding:24px;font-size:15px;line-height:1.6;color:#333333">' +
          toHtml(body) +
          (signature ? '<p style="margin:24px 0 0;color:#555555">' + toHtml(signature) + '</p>' : '') +
        '</div>' +
      '</div>' +
    '</div>';

  return { subject: subject, text: text, html: html };
}

function mailOptions_(settings, html) {
  const options = { htmlBody: html };
  if (settings['sender name']) options.name = String(settings['sender name']);
  if (settings['reply to']) options.replyTo = String(settings['reply to']);
  return options;
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
