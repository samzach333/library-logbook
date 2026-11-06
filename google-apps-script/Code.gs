/**
 * Atul sir's Library - Google Apps Script backend
 * ===============================================
 * Paste this whole file into: Google Sheet -> Extensions -> Apps Script -> Code.gs
 * Full setup steps are in README.md.
 *
 * The Google Sheet is the database. Three tabs are created automatically:
 *   Books, People, Loans
 *
 * Two passwords, both stored ONLY in this script's properties (never in any file,
 * so this file is safe to keep on public GitHub). Set them from the sheet menu:
 *   Library -> 2. Set member password   (everyone types it to open the site)
 *   Library -> 3. Set admin password    (only the admin: add/edit/delete, history)
 */

const TABLES = {
  Books:  ['id', 'title', 'author', 'category', 'location', 'notes', 'added_on'],
  People: ['id', 'name', 'phone', 'dept', 'notes', 'added_on'],
  Loans:  ['id', 'book_id', 'book_title', 'person_id', 'person_name',
           'issued_at', 'issued_by', 'due_date',
           'returned_at', 'received_by', 'issue_remarks', 'return_remarks'],
};
const MAX_LEN = 300;

// Who may call what. 'member' = anyone with the member password.
const ACCESS = {
  list: 'member', issue: 'member', returnBook: 'member',
  checkAdmin: 'admin',
  addBook: 'admin', updateBook: 'admin', deleteBook: 'admin',
  addPerson: 'admin', updatePerson: 'admin', deletePerson: 'admin',
  editLoan: 'admin', deleteLoan: 'admin',
};

/* ------------------------------------------------------------------ */
/* Web entry points                                                     */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, message: 'Library API is running.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  try {
    const action = String(req.action || '');
    const need = ACCESS[action];
    if (!need) return json_({ ok: false, error: 'Unknown action: ' + action });
    const role = role_(req);
    if (need === 'admin' && role !== 'admin') throw new Error('ADMIN_ONLY');

    if (action === 'list' || action === 'checkAdmin') {
      return json_({ ok: true, role: role, data: snapshot_() });
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return json_({ ok: false, error: 'Server busy - please try again.' });
    try {
      WRITE_ACTIONS[action](req.data || {});
      SpreadsheetApp.flush();
      return json_({ ok: true, role: role, data: snapshot_() });
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

function role_(req) {
  const props = PropertiesService.getScriptProperties();
  const member = props.getProperty('PIN');
  const admin = props.getProperty('ADMIN_PIN');
  if (!member || !admin) {
    throw new Error('PIN_NOT_SET: open the Google Sheet and use the Library menu to set both passwords.');
  }
  if (String(req.pin || '') !== member && String(req.pin || '') !== admin) {
    Utilities.sleep(1000); // slow down password guessing
    throw new Error('BAD_PIN');
  }
  if (req.admin_pin) {
    if (String(req.admin_pin) !== admin) {
      Utilities.sleep(1000);
      throw new Error('BAD_ADMIN_PIN');
    }
    return 'admin';
  }
  return 'member';
}

/* ------------------------------------------------------------------ */
/* Write actions                                                        */
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
    const b = findById_(readTable_('Books'), d.id);
    if (!b) throw new Error('Book not found (maybe deleted already).');
    updateRow_('Books', b.id, {
      title: req_(d.title, 'Book title'), author: clean_(d.author), category: clean_(d.category),
      location: clean_(d.location), notes: clean_(d.notes),
    });
  },

  deleteBook: function (d) {
    const b = findById_(readTable_('Books'), d.id);
    if (!b) throw new Error('Book not found.');
    if (openLoanForBook_(readTable_('Loans'), b.id)) {
      throw new Error('This book is with someone right now - mark it returned before deleting.');
    }
    deleteRow_('Books', b.id);
  },

  addPerson: function (d) {
    const people = readTable_('People');
    const name = req_(d.name, 'Name');
    if (people.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
      throw new Error('"' + name + '" is already in the list.');
    }
    appendRow_('People', {
      id: nextId_('P', people, 3), name: name, phone: clean_(d.phone),
      dept: clean_(d.dept), notes: clean_(d.notes), added_on: now_(),
    });
  },

  updatePerson: function (d) {
    const p = findById_(readTable_('People'), d.id);
    if (!p) throw new Error('Person not found (maybe deleted already).');
    updateRow_('People', p.id, {
      name: req_(d.name, 'Name'), phone: clean_(d.phone), dept: clean_(d.dept), notes: clean_(d.notes),
    });
  },

  deletePerson: function (d) {
    const p = findById_(readTable_('People'), d.id);
    if (!p) throw new Error('Person not found.');
    if (readTable_('Loans').some(function (l) { return l.person_id === p.id && !l.returned_at; })) {
      throw new Error(p.name + ' still has a book - mark it returned before removing them.');
    }
    deleteRow_('People', p.id);
  },

  issue: function (d) {
    const book = findById_(readTable_('Books'), d.book_id);
    if (!book) throw new Error('Book not found.');
    const person = findById_(readTable_('People'), d.person_id);
    if (!person) throw new Error('Your name is not in the list - ask the admin to add you.');
    const loans = readTable_('Loans');
    const open = openLoanForBook_(loans, book.id);
    if (open) throw new Error('Sorry - "' + book.title + '" was just taken by ' + open.person_name + '.');
    const due = validDue_(d.due_date);
    appendRow_('Loans', {
      id: nextId_('L', loans, 4), book_id: book.id, book_title: book.title,
      person_id: person.id, person_name: person.name,
      issued_at: now_(), issued_by: clean_(d.operator) || person.name, due_date: due,
      returned_at: '', received_by: '', issue_remarks: clean_(d.remarks), return_remarks: '',
    });
  },

  returnBook: function (d) {
    const loan = findById_(readTable_('Loans'), d.loan_id);
    if (!loan) throw new Error('Record not found.');
    if (loan.returned_at) throw new Error('Already returned on ' + loan.returned_at + '.');
    updateRow_('Loans', loan.id, {
      returned_at: now_(), received_by: clean_(d.operator), return_remarks: clean_(d.remarks),
    });
  },

  editLoan: function (d) {
    const loan = findById_(readTable_('Loans'), d.loan_id);
    if (!loan) throw new Error('Record not found.');
    const due = clean_(d.due_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Please give a valid return date.');
    updateRow_('Loans', loan.id, {
      due_date: due, issue_remarks: clean_(d.issue_remarks), return_remarks: clean_(d.return_remarks),
    });
  },

  deleteLoan: function (d) {
    const loan = findById_(readTable_('Loans'), d.loan_id);
    if (!loan) throw new Error('Record not found.');
    deleteRow_('Loans', loan.id);
  },
};

function validDue_(v) {
  const due = clean_(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Please choose the date you will return the book.');
  if (due < today_()) throw new Error('The return date cannot be in the past.');
  return due;
}

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

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ */
/* Sheet menu: one-time setup + passwords                               */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Library')
    .addItem('1. Set up sheets', 'setupSheets')
    .addItem('2. Set member password', 'setMemberPassword')
    .addItem('3. Set admin password', 'setAdminPassword')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (name) {
    const sh = sheet_(name);
    if (sh.getLastRow() === 0) initSheet_(sh, name);
  });
  const extra = ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);
  SpreadsheetApp.getUi().alert('Done: Books, People and Loans tabs are ready.');
}

function setMemberPassword() {
  setPassword_('PIN', 'ADMIN_PIN', 'Member password',
    'The password EVERYONE types to open the library website (at least 6 characters):');
}

function setAdminPassword() {
  setPassword_('ADMIN_PIN', 'PIN', 'Admin password',
    'The password ONLY YOU use to add/edit/delete books and people (at least 6 characters, different from the member password):');
}

function setPassword_(key, otherKey, title, text) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = res.getResponseText().trim();
  if (pw.length < 6) { ui.alert('Must be at least 6 characters. Nothing changed.'); return; }
  const props = PropertiesService.getScriptProperties();
  if (pw === props.getProperty(otherKey)) {
    ui.alert('Member and admin passwords must be different. Nothing changed.');
    return;
  }
  props.setProperty(key, pw);
  ui.alert(title + ' saved.');
}
