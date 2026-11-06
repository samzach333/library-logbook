/**
 * Library Log Book - Google Apps Script backend
 * =============================================
 * Paste this whole file into: Google Sheet -> Extensions -> Apps Script -> Code.gs
 * Full setup steps are in README.md.
 *
 * The Google Sheet is the database. Three tabs are created automatically:
 *   Books, People, Loans
 * Every request from the website must carry the office PIN, which is stored in
 * Script Properties (set it from the sheet menu:  Library -> Set / change PIN).
 * The PIN is NEVER written in this file, so this file is safe to keep on GitHub.
 */

const TABLES = {
  Books:  ['id', 'title', 'author', 'category', 'location', 'notes', 'added_on'],
  People: ['id', 'name', 'phone', 'dept', 'notes', 'added_on'],
  Loans:  ['id', 'book_id', 'book_title', 'person_id', 'person_name',
           'issued_at', 'issued_by', 'due_date',
           'returned_at', 'received_by', 'issue_remarks', 'return_remarks'],
};
const MAX_LEN = 300;

/* ------------------------------------------------------------------ */
/* Web entry points                                                     */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, message: 'Library Log Book API is running.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  try {
    checkPin_(req.pin);
    const action = String(req.action || '');
    const data = req.data || {};
    if (action === 'list') return json_({ ok: true, data: snapshot_() });

    const handler = WRITE_ACTIONS[action];
    if (!handler) return json_({ ok: false, error: 'Unknown action: ' + action });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return json_({ ok: false, error: 'Server busy - please try again.' });
    }
    try {
      handler(data);
      SpreadsheetApp.flush();
      return json_({ ok: true, data: snapshot_() });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkPin_(pin) {
  const saved = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!saved) throw new Error('PIN_NOT_SET: open the Google Sheet and use the menu Library -> Set / change PIN.');
  if (String(pin || '') !== saved) throw new Error('BAD_PIN');
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

const WRITE_ACTIONS = {
  addBook: function (d) {
    const books = readTable_('Books');
    const title = req_(d.title, 'Book title');
    let id = clean_(d.id);
    if (id) {
      if (findById_(books, id)) throw new Error('Book number "' + id + '" already exists.');
    } else {
      id = nextId_('B', books, 3);
    }
    appendRow_('Books', {
      id: id, title: title, author: clean_(d.author), category: clean_(d.category),
      location: clean_(d.location), notes: clean_(d.notes), added_on: now_(),
    });
  },

  updateBook: function (d) {
    const books = readTable_('Books');
    const b = findById_(books, d.id);
    if (!b) throw new Error('Book not found (maybe deleted by someone else).');
    updateRow_('Books', b.id, {
      title: req_(d.title, 'Book title'), author: clean_(d.author), category: clean_(d.category),
      location: clean_(d.location), notes: clean_(d.notes),
    });
  },

  deleteBook: function (d) {
    const books = readTable_('Books');
    const b = findById_(books, d.id);
    if (!b) throw new Error('Book not found.');
    if (openLoanForBook_(readTable_('Loans'), b.id)) {
      throw new Error('This book is currently issued - return it before deleting.');
    }
    deleteRow_('Books', b.id);
  },

  addPerson: function (d) {
    const people = readTable_('People');
    const name = req_(d.name, 'Name');
    const dup = people.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
    if (dup) throw new Error('"' + name + '" is already in the list.');
    appendRow_('People', {
      id: nextId_('P', people, 3), name: name, phone: clean_(d.phone),
      dept: clean_(d.dept), notes: clean_(d.notes), added_on: now_(),
    });
  },

  updatePerson: function (d) {
    const people = readTable_('People');
    const p = findById_(people, d.id);
    if (!p) throw new Error('Person not found (maybe deleted by someone else).');
    updateRow_('People', p.id, {
      name: req_(d.name, 'Name'), phone: clean_(d.phone), dept: clean_(d.dept), notes: clean_(d.notes),
    });
  },

  deletePerson: function (d) {
    const people = readTable_('People');
    const p = findById_(people, d.id);
    if (!p) throw new Error('Person not found.');
    const hasOpen = readTable_('Loans').some(function (l) { return l.person_id === p.id && !l.returned_at; });
    if (hasOpen) throw new Error(p.name + ' still has a book - return it before deleting.');
    deleteRow_('People', p.id);
  },

  issue: function (d) {
    const book = findById_(readTable_('Books'), d.book_id);
    if (!book) throw new Error('Book not found.');
    const person = findById_(readTable_('People'), d.person_id);
    if (!person) throw new Error('Borrower not found.');
    const loans = readTable_('Loans');
    const open = openLoanForBook_(loans, book.id);
    if (open) throw new Error('"' + book.title + '" is already issued to ' + open.person_name + '.');
    const due = clean_(d.due_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Please give a valid due date.');
    appendRow_('Loans', {
      id: nextId_('L', loans, 4), book_id: book.id, book_title: book.title,
      person_id: person.id, person_name: person.name,
      issued_at: now_(), issued_by: clean_(d.operator), due_date: due,
      returned_at: '', received_by: '', issue_remarks: clean_(d.remarks), return_remarks: '',
    });
  },

  returnBook: function (d) {
    const loan = findById_(readTable_('Loans'), d.loan_id);
    if (!loan) throw new Error('Issue record not found.');
    if (loan.returned_at) throw new Error('Already returned on ' + loan.returned_at + '.');
    updateRow_('Loans', loan.id, {
      returned_at: now_(), received_by: clean_(d.operator), return_remarks: clean_(d.remarks),
    });
  },
};

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                        */
/* ------------------------------------------------------------------ */

function snapshot_() {
  return {
    books: readTable_('Books'),
    people: readTable_('People'),
    loans: readTable_('Loans'),
    server_time: now_(),
  };
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    initSheet_(sh, name);
  }
  return sh;
}

function initSheet_(sh, name) {
  const head = TABLES[name];
  // Plain-text format everywhere: stops Sheets turning dates / phone numbers into other types.
  sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function readTable_(name) {
  const head = TABLES[name];
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, head.length).getValues();
  const tz = Session.getScriptTimeZone();
  const out = [];
  values.forEach(function (row) {
    const obj = {};
    head.forEach(function (key, i) {
      let v = row[i];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, tz, key === 'due_date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
      }
      v = (v === null || v === undefined) ? '' : String(v);
      if (v.charAt(0) === "'") v = v.substring(1);
      obj[key] = v;
    });
    if (obj.id) out.push(obj);
  });
  return out;
}

function rowIndex_(name, id) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function toRow_(name, obj) {
  return TABLES[name].map(function (k) {
    let v = obj[k] === undefined || obj[k] === null ? '' : String(obj[k]);
    if (/^[=+\-@]/.test(v)) v = "'" + v;   // never let typed text become a formula
    return v;
  });
}

function appendRow_(name, obj) {
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(row, 1, 1, TABLES[name].length).setNumberFormat('@').setValues([toRow_(name, obj)]);
}

function updateRow_(name, id, patch) {
  const idx = rowIndex_(name, id);
  if (idx < 0) throw new Error('Record ' + id + ' not found.');
  const current = findById_(readTable_(name), id);
  const merged = Object.assign({}, current, patch);
  sheet_(name).getRange(idx, 1, 1, TABLES[name].length).setNumberFormat('@').setValues([toRow_(name, merged)]);
}

function deleteRow_(name, id) {
  const idx = rowIndex_(name, id);
  if (idx < 0) throw new Error('Record ' + id + ' not found.');
  sheet_(name).deleteRow(idx);
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                      */
/* ------------------------------------------------------------------ */

function clean_(v) {
  return (v === undefined || v === null) ? '' : String(v).trim().substring(0, MAX_LEN);
}

function req_(v, label) {
  const s = clean_(v);
  if (!s) throw new Error(label + ' is required.');
  return s;
}

function findById_(rows, id) {
  const key = String(id || '').trim().toLowerCase();
  if (!key) return null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id.toLowerCase() === key) return rows[i];
  }
  return null;
}

function openLoanForBook_(loans, bookId) {
  for (let i = 0; i < loans.length; i++) {
    if (loans[i].book_id === bookId && !loans[i].returned_at) return loans[i];
  }
  return null;
}

function nextId_(prefix, rows, width) {
  let max = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
  rows.forEach(function (r) {
    const m = re.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  let n = String(max + 1);
  while (n.length < width) n = '0' + n;
  return prefix + n;
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/* ------------------------------------------------------------------ */
/* Sheet menu: one-time setup + PIN                                     */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Library')
    .addItem('1. Set up sheets', 'setupSheets')
    .addItem('2. Set / change PIN', 'setPin')
    .addToUi();
}

function setupSheets() {
  Object.keys(TABLES).forEach(function (name) {
    const sh = sheet_(name);
    if (sh.getLastRow() === 0) initSheet_(sh, name);
  });
  const extra = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(extra);
  }
  SpreadsheetApp.getUi().alert('Done: Books, People and Loans tabs are ready.');
}

function setPin() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Office PIN',
    'Enter the PIN everyone will type on the website (at least 6 characters):',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pin = res.getResponseText().trim();
  if (pin.length < 6) { ui.alert('PIN must be at least 6 characters. Nothing changed.'); return; }
  PropertiesService.getScriptProperties().setProperty('PIN', pin);
  ui.alert('PIN saved. Share it only with your team.');
}
