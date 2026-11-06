/* Library Log Book - front end (plain JavaScript, no libraries). */
(function () {
  'use strict';

  const CFG = Object.assign({ apiUrl: '', title: 'Library Log Book', loanDays: 14 }, window.LIBRARY_CONFIG || {});
  const DEMO = !String(CFG.apiUrl || '').trim();
  const LOAN_DAYS = Math.max(1, parseInt(CFG.loanDays, 10) || 14);

  /* ---------------- small helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };

  /* ---------------- dates ("YYYY-MM-DD HH:mm", local office time) ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const stamp = (d) => { d = d || new Date(); return dateStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const parts = (s) => /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''));
  const dayNum = (s) => { const m = parts(s); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 86400000 : NaN; };
  const fmtDate = (s) => { const m = parts(s); return m ? m[3] + ' ' + MONTHS[m[2] - 1] + ' ' + m[1] : (s || ''); };
  const fmtStamp = (s) => { const m = parts(s); return m ? fmtDate(s) + (m[4] ? ', ' + m[4] + ':' + m[5] : '') : (s || ''); };
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function loanStatus(l) {
    if (l.returned_at) return { key: 'returned', label: 'Returned', cls: 'done' };
    const diff = dayNum(dateStr()) - dayNum(l.due_date);
    if (isNaN(diff)) return { key: 'open', label: 'Issued', cls: 'out' };
    if (diff > 0) return { key: 'overdue', label: 'Overdue ' + plural(diff, 'day'), cls: 'late' };
    if (diff === 0) return { key: 'open', label: 'Due today', cls: 'out' };
    return { key: 'open', label: 'Due in ' + plural(-diff, 'day'), cls: 'out' };
  }

  /* ---------------- shared validation (demo backend mirrors Code.gs) ---------------- */
  const clean = (v) => (v === undefined || v === null ? '' : String(v).trim().substring(0, 300));
  const required = (v, label) => { const s = clean(v); if (!s) throw new Error(label + ' is required.'); return s; };
  const findById = (rows, id) => {
    const key = String(id || '').trim().toLowerCase();
    return key ? rows.find((r) => r.id.toLowerCase() === key) || null : null;
  };
  const openLoanFor = (loans, bookId) => loans.find((l) => l.book_id === bookId && !l.returned_at) || null;
  const nextId = (prefix, rows, width) => {
    const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
    let max = 0;
    rows.forEach((r) => { const m = re.exec(r.id); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return prefix + String(max + 1).padStart(width, '0');
  };

  /* ---------------- backends ---------------- */
  const Remote = {
    async call(action, data) {
      let res;
      try {
        res = await fetch(CFG.apiUrl, {
          method: 'POST', // text/plain body: a "simple" request, no CORS pre-flight for Apps Script
          body: JSON.stringify({ action: action, pin: store.get('lib_pin', ''), data: data || {} }),
        });
      } catch (e) {
        throw new Error('Cannot reach the server - check the internet connection.');
      }
      if (!res.ok) throw new Error('Server error (' + res.status + ').');
      let out;
      try { out = await res.json(); } catch (e) {
        throw new Error('Unexpected reply from the server - check apiUrl in config.js.');
      }
      if (!out.ok) {
        const err = new Error(out.error || 'Something went wrong.');
        if (out.error === 'BAD_PIN') err.code = 'BAD_PIN';
        else if (String(out.error).indexOf('PIN_NOT_SET') === 0) err.code = 'PIN_NOT_SET';
        throw err;
      }
      return out.data;
    },
  };

  const DEMO_KEY = 'lib_demo_db';
  const Local = {
    load() {
      let db = store.get(DEMO_KEY, null);
      if (!db || !Array.isArray(db.books)) { db = demoSeed(); store.set(DEMO_KEY, db); }
      return db;
    },
    async call(action, data) {
      const db = this.load();
      if (action !== 'list') {
        const fn = LOCAL_ACTIONS[action];
        if (!fn) throw new Error('Unknown action: ' + action);
        fn(db, data || {});
        store.set(DEMO_KEY, db);
      }
      return JSON.parse(JSON.stringify({ books: db.books, people: db.people, loans: db.loans, server_time: stamp() }));
    },
  };

  const LOCAL_ACTIONS = {
    addBook(db, d) {
      const title = required(d.title, 'Book title');
      let id = clean(d.id);
      if (id) { if (findById(db.books, id)) throw new Error('Book number "' + id + '" already exists.'); }
      else id = nextId('B', db.books, 3);
      db.books.push({ id, title, author: clean(d.author), category: clean(d.category),
        location: clean(d.location), notes: clean(d.notes), added_on: stamp() });
    },
    updateBook(db, d) {
      const b = findById(db.books, d.id);
      if (!b) throw new Error('Book not found.');
      Object.assign(b, { title: required(d.title, 'Book title'), author: clean(d.author),
        category: clean(d.category), location: clean(d.location), notes: clean(d.notes) });
    },
    deleteBook(db, d) {
      const b = findById(db.books, d.id);
      if (!b) throw new Error('Book not found.');
      if (openLoanFor(db.loans, b.id)) throw new Error('This book is currently issued - return it before deleting.');
      db.books = db.books.filter((x) => x !== b);
    },
    addPerson(db, d) {
      const name = required(d.name, 'Name');
      if (db.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('"' + name + '" is already in the list.');
      db.people.push({ id: nextId('P', db.people, 3), name, phone: clean(d.phone), dept: clean(d.dept),
        notes: clean(d.notes), added_on: stamp() });
    },
    updatePerson(db, d) {
      const p = findById(db.people, d.id);
      if (!p) throw new Error('Person not found.');
      Object.assign(p, { name: required(d.name, 'Name'), phone: clean(d.phone), dept: clean(d.dept), notes: clean(d.notes) });
    },
    deletePerson(db, d) {
      const p = findById(db.people, d.id);
      if (!p) throw new Error('Person not found.');
      if (db.loans.some((l) => l.person_id === p.id && !l.returned_at)) throw new Error(p.name + ' still has a book - return it before deleting.');
      db.people = db.people.filter((x) => x !== p);
    },
    issue(db, d) {
      const book = findById(db.books, d.book_id);
      if (!book) throw new Error('Book not found.');
      const person = findById(db.people, d.person_id);
      if (!person) throw new Error('Borrower not found.');
      const open = openLoanFor(db.loans, book.id);
      if (open) throw new Error('"' + book.title + '" is already issued to ' + open.person_name + '.');
      const due = clean(d.due_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Please give a valid due date.');
      db.loans.push({ id: nextId('L', db.loans, 4), book_id: book.id, book_title: book.title,
        person_id: person.id, person_name: person.name, issued_at: stamp(), issued_by: clean(d.operator),
        due_date: due, returned_at: '', received_by: '', issue_remarks: clean(d.remarks), return_remarks: '' });
    },
    returnBook(db, d) {
      const l = findById(db.loans, d.loan_id);
      if (!l) throw new Error('Issue record not found.');
      if (l.returned_at) throw new Error('Already returned on ' + l.returned_at + '.');
      Object.assign(l, { returned_at: stamp(), received_by: clean(d.operator), return_remarks: clean(d.remarks) });
    },
  };

  function demoSeed() {
    const ago = (n, hh) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, 15, 0, 0); return stamp(d); };
    const dueAgo = (n) => addDays(-n);
    return {
      books: [
        { id: 'B001', title: 'Introduction to Robotics', author: 'J. J. Craig', category: 'Robotics', location: 'Shelf 1', notes: '', added_on: ago(30, 10) },
        { id: 'B002', title: 'Probabilistic Robotics', author: 'S. Thrun, W. Burgard, D. Fox', category: 'Robotics', location: 'Shelf 1', notes: '', added_on: ago(30, 10) },
        { id: 'B003', title: 'Modern Robotics', author: 'K. Lynch, F. Park', category: 'Robotics', location: 'Shelf 2', notes: '', added_on: ago(30, 10) },
        { id: 'B004', title: 'Planning Algorithms', author: 'S. M. LaValle', category: 'Motion planning', location: 'Shelf 2', notes: '', added_on: ago(30, 10) },
      ],
      people: [
        { id: 'P001', name: 'Asha (sample)', phone: '', dept: 'PhD scholar', notes: '', added_on: ago(30, 10) },
        { id: 'P002', name: 'Ravi (sample)', phone: '', dept: 'Project staff', notes: '', added_on: ago(30, 10) },
      ],
      loans: [
        { id: 'L0001', book_id: 'B003', book_title: 'Modern Robotics', person_id: 'P002', person_name: 'Ravi (sample)',
          issued_at: ago(20, 11), issued_by: 'Asha (sample)', due_date: dueAgo(6), returned_at: '', received_by: '',
          issue_remarks: '', return_remarks: '' },
        { id: 'L0002', book_id: 'B001', book_title: 'Introduction to Robotics', person_id: 'P001', person_name: 'Asha (sample)',
          issued_at: ago(12, 16), issued_by: 'Ravi (sample)', due_date: dueAgo(-2), returned_at: ago(3, 10),
          received_by: 'Ravi (sample)', issue_remarks: 'chapter 4', return_remarks: 'good condition' },
        { id: 'L0003', book_id: 'B002', book_title: 'Probabilistic Robotics', person_id: 'P001', person_name: 'Asha (sample)',
          issued_at: ago(2, 14), issued_by: 'Asha (sample)', due_date: dueAgo(-12), returned_at: '', received_by: '',
          issue_remarks: '', return_remarks: '' },
      ],
    };
  }

  /* ---------------- app state ---------------- */
  const api = DEMO ? Local : Remote;
  let state = { books: [], people: [], loans: [] };
  let idx = {};
  let busy = false;
  let lastSync = 0;

  function buildIndex() {
    const bookById = {}, personById = {}, openByBook = {}, openByPerson = {};
    state.books.forEach((b) => { bookById[b.id] = b; });
    state.people.forEach((p) => { personById[p.id] = p; });
    state.loans.forEach((l) => {
      if (l.returned_at) return;
      openByBook[l.book_id] = l;
      (openByPerson[l.person_id] = openByPerson[l.person_id] || []).push(l);
    });
    idx = { bookById, personById, openByBook, openByPerson };
  }
  const bookTitle = (l) => (idx.bookById[l.book_id] || {}).title || l.book_title || l.book_id;
  const personName = (l) => (idx.personById[l.person_id] || {}).name || l.person_name || l.person_id;
  const operatorName = () => (idx.personById[store.get('lib_operator', '')] || {}).name || '';

  async function run(action, data, okMsg) {
    if (busy) { toast('Please wait - still saving the last change.'); return false; }
    setBusy(true, action === 'list' ? 'Loading…' : 'Saving…');
    try {
      state = await api.call(action, data);
      lastSync = Date.now();
      render();
      setSync('ok');
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      setSync('err');
      if (e.code === 'BAD_PIN') {
        store.del('lib_pin');
        showPin('That PIN is not correct. Please try again.');
      } else if (e.code === 'PIN_NOT_SET') {
        toast('The office PIN has not been set yet in the Google Sheet (menu: Library -> Set / change PIN).', true);
      } else {
        toast(e.message, true);
        if (action !== 'list') setTimeout(() => run('list'), 300); // someone else may have changed it - reload
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function setBusy(v, label) {
    busy = v;
    $$('button[type="submit"]').forEach((b) => { b.disabled = v; });
    if (v) { const s = $('#sync'); s.className = 'pill busy'; s.textContent = label; }
  }

  function setSync(kind) {
    const s = $('#sync');
    if (kind === 'err') { s.className = 'pill err'; s.textContent = 'Not saved / offline'; return; }
    s.className = 'pill ok';
    s.textContent = DEMO ? 'Demo – this PC only' : 'Synced ' + stamp().slice(11);
  }

  let toastTimer = 0;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 3000);
  }

  function requireOperator() {
    if (operatorName()) return true;
    toast('First choose your own name at the top ("You are").', true);
    $('#operator').focus();
    return false;
  }

  /* ---------------- rendering ---------------- */
  function render() {
    buildIndex();
    renderOperator();
    renderDashboard();
    renderIssueForm();
    renderBooks();
    renderPeople();
    renderHistory();
    $('#foot').textContent = plural(state.books.length, 'book') + ' · ' + plural(state.people.length, 'person').replace('persons', 'people') +
      ' · ' + plural(state.loans.length, 'record') + (DEMO ? ' · demo mode' : ' · saved in the shared Google Sheet');
  }

  function renderOperator() {
    const sel = $('#operator');
    const cur = store.get('lib_operator', '');
    const people = state.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">— choose your name —</option>' +
      people.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  }

  function tag(st) { return '<span class="tag ' + st.cls + '">' + esc(st.label) + '</span>'; }

  function renderDashboard() {
    const open = state.loans.filter((l) => !l.returned_at);
    const overdue = open.filter((l) => loanStatus(l).key === 'overdue');
    const available = state.books.filter((b) => !idx.openByBook[b.id]).length;
    $('#stats').innerHTML = [
      ['Books', state.books.length, ''],
      ['On the shelf', available, 'ok'],
      ['With people', open.length, ''],
      ['Overdue', overdue.length, overdue.length ? 'warn' : ''],
    ].map((s) => '<div class="stat ' + s[2] + '"><div class="num">' + s[1] + '</div><div class="lbl">' + s[0] + '</div></div>').join('');

    open.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    $('#out-list').innerHTML = open.length ? table(
      ['Book', 'With', 'Taken on', 'Return by', 'Status', ''],
      open.map((l) => {
        const st = loanStatus(l);
        return '<tr class="' + (st.key === 'overdue' ? 'late' : '') + '">' +
          '<td>' + esc(bookTitle(l)) + '<div class="sub">#' + esc(l.book_id) + '</div></td>' +
          '<td>' + esc(personName(l)) + '</td>' +
          '<td class="mono">' + esc(fmtStamp(l.issued_at)) + (l.issued_by ? '<div class="sub">given by ' + esc(l.issued_by) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(fmtDate(l.due_date)) + '</td>' +
          '<td>' + tag(st) + '</td>' +
          '<td class="actions"><button class="btn small primary" data-act="return" data-id="' + esc(l.id) + '">Returned</button></td></tr>';
      })
    ) : '<div class="empty">All books are on the shelf.</div>';

    const events = [];
    state.loans.forEach((l) => {
      events.push({ t: l.issued_at, html: '<b>' + esc(personName(l)) + '</b> took <b>' + esc(bookTitle(l)) + '</b>' +
        (l.issued_by && l.issued_by !== personName(l) ? ' <span class="sub">(given by ' + esc(l.issued_by) + ')</span>' : '') });
      if (l.returned_at) {
        events.push({ t: l.returned_at, html: '<b>' + esc(personName(l)) + '</b> returned <b>' + esc(bookTitle(l)) + '</b>' +
          (l.return_remarks ? ' <span class="sub">– ' + esc(l.return_remarks) + '</span>' : '') });
      }
    });
    events.sort((a, b) => String(b.t).localeCompare(String(a.t)));
    $('#activity').innerHTML = events.length
      ? events.slice(0, 12).map((e) => '<li><span class="when mono">' + esc(fmtStamp(e.t)) + '</span><span>' + e.html + '</span></li>').join('')
      : '<li class="empty">Nothing yet.</li>';
  }

  function renderIssueForm() {
    const bookSel = $('#issue-book'), personSel = $('#issue-person'), due = $('#issue-due');
    const curBook = bookSel.value, curPerson = personSel.value;
    const books = state.books.slice().sort((a, b) => a.title.localeCompare(b.title));
    const avail = books.filter((b) => !idx.openByBook[b.id]);
    const out = books.filter((b) => idx.openByBook[b.id]);
    bookSel.innerHTML = '<option value="">— choose a book —</option>' +
      avail.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.title) + ' (#' + esc(b.id) + ')</option>').join('') +
      (out.length ? '<optgroup label="Already with someone">' +
        out.map((b) => '<option disabled>' + esc(b.title) + ' – with ' + esc(personName(idx.openByBook[b.id])) + '</option>').join('') +
        '</optgroup>' : '');
    if (avail.some((b) => b.id === curBook)) bookSel.value = curBook;

    const people = state.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    personSel.innerHTML = '<option value="">— choose a person —</option>' +
      people.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
    if (people.some((p) => p.id === curPerson)) personSel.value = curPerson;

    due.min = dateStr();
    if (!due.value) due.value = addDays(LOAN_DAYS);
    updateIssueHint();
  }

  function updateIssueHint() {
    const due = $('#issue-due').value;
    const n = dayNum(due) - dayNum(dateStr());
    let hint = isNaN(n) ? '' : 'Due back on ' + fmtDate(due) + ' (' + plural(n, 'day') + ' from today).';
    if (!state.people.length) hint = 'Add people first (People tab).';
    else if (!state.books.length) hint = 'Add books first (Books tab).';
    $('#issue-hint').textContent = hint + (operatorName() ? ' Given by: ' + operatorName() + '.' : '');
  }

  function table(head, rows) {
    return '<div class="table-wrap"><table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function renderBooks() {
    const q = $('#books-search').value.trim().toLowerCase();
    const books = state.books.filter((b) => !q ||
      [b.id, b.title, b.author, b.category, b.location].join(' ').toLowerCase().indexOf(q) >= 0)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    $('#categories').innerHTML = Array.from(new Set(state.books.map((b) => b.category).filter(Boolean)))
      .map((c) => '<option value="' + esc(c) + '">').join('');
    $('#books-list').innerHTML = books.length ? table(
      ['No.', 'Book', 'Category / kept at', 'Status', ''],
      books.map((b) => {
        const l = idx.openByBook[b.id];
        const status = l
          ? tag({ cls: loanStatus(l).cls, label: 'With ' + personName(l) }) + '<div class="sub">since ' + esc(fmtDate(l.issued_at)) +
            ', due ' + esc(fmtDate(l.due_date)) + '</div>'
          : tag({ cls: 'avail', label: 'On the shelf' });
        return '<tr><td class="mono">' + esc(b.id) + '</td>' +
          '<td>' + esc(b.title) + (b.author ? '<div class="sub">' + esc(b.author) + '</div>' : '') + '</td>' +
          '<td>' + esc(b.category || '—') + (b.location ? '<div class="sub">' + esc(b.location) + '</div>' : '') + '</td>' +
          '<td>' + status + '</td><td class="actions">' +
          (l ? '<button class="btn small primary" data-act="return" data-id="' + esc(l.id) + '">Returned</button>'
             : '<button class="btn small primary" data-act="issue-book" data-id="' + esc(b.id) + '">Issue</button>') +
          '<button class="btn small" data-act="hist-book" data-id="' + esc(b.id) + '">History</button>' +
          '<button class="btn small" data-act="edit-book" data-id="' + esc(b.id) + '">Edit</button>' +
          '<button class="btn small danger" data-act="del-book" data-id="' + esc(b.id) + '">Delete</button></td></tr>';
      })
    ) : '<div class="empty">' + (q ? 'No book matches "' + esc(q) + '".' : 'No books yet – press "+ Add book".') + '</div>';
  }

  function renderPeople() {
    const people = state.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    $('#people-list').innerHTML = people.length ? table(
      ['Name', 'Phone', 'Group / role', 'Has now', ''],
      people.map((p) => {
        const has = idx.openByPerson[p.id] || [];
        return '<tr><td>' + esc(p.name) + (p.notes ? '<div class="sub">' + esc(p.notes) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(p.phone || '—') + '</td><td>' + esc(p.dept || '—') + '</td>' +
          '<td>' + (has.length ? has.map((l) => tag({ cls: loanStatus(l).cls, label: bookTitle(l) })).join(' ') : '<span class="sub">nothing</span>') + '</td>' +
          '<td class="actions"><button class="btn small" data-act="edit-person" data-id="' + esc(p.id) + '">Edit</button>' +
          '<button class="btn small danger" data-act="del-person" data-id="' + esc(p.id) + '">Delete</button></td></tr>';
      })
    ) : '<div class="empty">No people yet – press "+ Add person" and add everyone in the team (including yourself).</div>';
  }

  function historyRows() {
    const q = $('#hist-search').value.trim().toLowerCase();
    const f = $('#hist-filter').value;
    return state.loans.filter((l) => {
      const st = loanStatus(l).key;
      if (f === 'open' && st === 'returned') return false;
      if (f === 'overdue' && st !== 'overdue') return false;
      if (f === 'returned' && st !== 'returned') return false;
      return !q || [bookTitle(l), personName(l), l.book_id, l.issue_remarks, l.return_remarks].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
  }

  function loanTable(loans, showBook) {
    return table(
      (showBook ? ['Book'] : []).concat(['Person', 'Taken on', 'Return by', 'Returned on', 'Status', 'Remarks']),
      loans.map((l) => {
        const st = loanStatus(l);
        const remarks = [l.issue_remarks && 'Out: ' + l.issue_remarks, l.return_remarks && 'Back: ' + l.return_remarks].filter(Boolean);
        return '<tr class="' + (st.key === 'overdue' ? 'late' : '') + '">' +
          (showBook ? '<td>' + esc(bookTitle(l)) + '<div class="sub">#' + esc(l.book_id) + '</div></td>' : '') +
          '<td>' + esc(personName(l)) + '</td>' +
          '<td class="mono">' + esc(fmtStamp(l.issued_at)) + (l.issued_by ? '<div class="sub">by ' + esc(l.issued_by) + '</div>' : '') + '</td>' +
          '<td class="mono">' + esc(fmtDate(l.due_date)) + '</td>' +
          '<td class="mono">' + (l.returned_at ? esc(fmtStamp(l.returned_at)) + (l.received_by ? '<div class="sub">received by ' + esc(l.received_by) + '</div>' : '') : '—') + '</td>' +
          '<td>' + tag(st) + '</td><td>' + (remarks.length ? remarks.map(esc).join('<br>') : '—') + '</td></tr>';
      })
    );
  }

  function renderHistory() {
    const rows = historyRows();
    $('#hist-list').innerHTML = rows.length ? loanTable(rows, true) : '<div class="empty">No records.</div>';
  }

  /* ---------------- CSV export ---------------- */
  function exportCsv() {
    const rows = historyRows();
    const head = ['Record', 'Book no.', 'Book', 'Person', 'Taken on', 'Given by', 'Return by', 'Returned on', 'Received by', 'Status', 'Issue remarks', 'Return remarks'];
    const cell = (v) => {
      v = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(v)) v = "'" + v; // stop Excel treating text as a formula
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [head].concat(rows.map((l) => [l.id, l.book_id, bookTitle(l), personName(l), l.issued_at, l.issued_by,
      l.due_date, l.returned_at, l.received_by, loanStatus(l).label, l.issue_remarks, l.return_remarks]));
    const csv = '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'library-log-' + dateStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- views / navigation ---------------- */
  const VIEWS = ['dashboard', 'issue', 'books', 'people', 'history'];
  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'dashboard';
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  const goto = (name) => {
    if (location.hash === '#' + name) showView(name);
    else location.hash = name;
  };

  /* ---------------- dialogs ---------------- */
  function openBookDialog(book) {
    const f = $('#form-book');
    f.reset();
    f.dataset.mode = book ? 'edit' : 'add';
    $('#book-dlg-title').textContent = book ? 'Edit book' : 'Add book';
    f.elements.id.readOnly = !!book;
    if (book) ['id', 'title', 'author', 'category', 'location', 'notes'].forEach((k) => { f.elements[k].value = book[k] || ''; });
    $('#dlg-book').showModal();
    (book ? f.elements.title : f.elements.id).focus();
  }

  function openPersonDialog(p) {
    const f = $('#form-person');
    f.reset();
    $('#person-dlg-title').textContent = p ? 'Edit person' : 'Add person';
    f.elements.id.value = p ? p.id : '';
    if (p) ['name', 'phone', 'dept', 'notes'].forEach((k) => { f.elements[k].value = p[k] || ''; });
    $('#dlg-person').showModal();
    f.elements.name.focus();
  }

  function openReturnDialog(loan) {
    if (!requireOperator()) return;
    const f = $('#form-return');
    f.reset();
    f.dataset.loan = loan.id;
    const st = loanStatus(loan);
    $('#return-info').innerHTML = '<b>' + esc(bookTitle(loan)) + '</b><br>with ' + esc(personName(loan)) + ' since ' +
      esc(fmtStamp(loan.issued_at)) + '<br>' + tag(st) + ' <span class="sub">received by ' + esc(operatorName()) + '</span>';
    $('#dlg-return').showModal();
  }

  function openBookHistory(book) {
    $('#bookhist-title').textContent = 'History – ' + book.title;
    const loans = state.loans.filter((l) => l.book_id === book.id)
      .sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
    $('#bookhist-list').innerHTML = loans.length ? loanTable(loans, false) : '<div class="empty">This book has never been issued.</div>';
    $('#dlg-bookhist').showModal();
  }

  function showPin(errMsg) {
    $('#pin-error').textContent = errMsg || '';
    $('#pin-input').value = '';
    const d = $('#dlg-pin');
    if (!d.open) d.showModal();
    $('#pin-input').focus();
  }

  const anyDialogOpen = () => $$('dialog').some((d) => d.open);

  /* ---------------- events ---------------- */
  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => goto(t.dataset.view)));
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

    document.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('dialog').close(); return; }
      const g = e.target.closest('[data-goto]');
      if (g) { goto(g.dataset.goto); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      const act = b.dataset.act;
      if (act === 'return') { const l = findById(state.loans, id); if (l) openReturnDialog(l); }
      else if (act === 'issue-book') { goto('issue'); $('#issue-book').value = id; $('#issue-person').focus(); }
      else if (act === 'hist-book') { const bk = idx.bookById[id]; if (bk) openBookHistory(bk); }
      else if (act === 'edit-book') { const bk = idx.bookById[id]; if (bk) openBookDialog(bk); }
      else if (act === 'del-book') {
        const bk = idx.bookById[id];
        if (bk && confirm('Delete "' + bk.title + '" from the book list?\n(Its past records stay in History.)')) {
          run('deleteBook', { id }, 'Book deleted.');
        }
      } else if (act === 'edit-person') { const p = idx.personById[id]; if (p) openPersonDialog(p); }
      else if (act === 'del-person') {
        const p = idx.personById[id];
        if (p && confirm('Remove ' + p.name + ' from the people list?\n(Their past records stay in History.)')) {
          run('deletePerson', { id }, 'Person removed.');
        }
      }
    });

    $('#operator').addEventListener('change', (e) => {
      store.set('lib_operator', e.target.value);
      updateIssueHint();
    });
    $('#btn-refresh').addEventListener('click', () => run('list', null, 'Up to date.'));
    $('#btn-lock').addEventListener('click', () => {
      store.del('lib_pin');
      state = { books: [], people: [], loans: [] };
      render();
      showPin('Locked. Enter the PIN to open again.');
    });
    $('#btn-demo-reset').addEventListener('click', () => {
      if (confirm('Delete all demo records saved in this browser?')) {
        store.set(DEMO_KEY, { books: [], people: [], loans: [] });
        run('list', null, 'Demo data cleared.');
      }
    });
    $('#books-search').addEventListener('input', renderBooks);
    $('#hist-search').addEventListener('input', renderHistory);
    $('#hist-filter').addEventListener('change', renderHistory);
    $('#btn-export').addEventListener('click', exportCsv);
    $('#btn-add-book').addEventListener('click', () => openBookDialog(null));
    $('#btn-add-person').addEventListener('click', () => openPersonDialog(null));
    $('#issue-due').addEventListener('change', updateIssueHint);

    $('#form-issue').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!requireOperator()) return;
      const f = e.target;
      const book = idx.bookById[f.elements.book_id.value];
      const person = idx.personById[f.elements.person_id.value];
      if (!book || !person) { toast('Choose a book and a person.', true); return; }
      const ok = await run('issue', {
        book_id: book.id, person_id: person.id, due_date: f.elements.due_date.value,
        remarks: f.elements.remarks.value, operator: operatorName(),
      }, '"' + book.title + '" issued to ' + person.name + '.');
      if (ok) { f.reset(); renderIssueForm(); goto('dashboard'); }
    });

    $('#form-book').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const data = {};
      ['id', 'title', 'author', 'category', 'location', 'notes'].forEach((k) => { data[k] = f.elements[k].value; });
      const edit = f.dataset.mode === 'edit';
      if (await run(edit ? 'updateBook' : 'addBook', data, edit ? 'Book updated.' : 'Book added.')) $('#dlg-book').close();
    });

    $('#form-person').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const data = {};
      ['id', 'name', 'phone', 'dept', 'notes'].forEach((k) => { data[k] = f.elements[k].value; });
      const edit = !!data.id;
      if (await run(edit ? 'updatePerson' : 'addPerson', data, edit ? 'Saved.' : data.name.trim() + ' added.')) $('#dlg-person').close();
    });

    $('#form-return').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const l = findById(state.loans, f.dataset.loan);
      const ok = await run('returnBook', { loan_id: f.dataset.loan, remarks: f.elements.remarks.value, operator: operatorName() },
        l ? '"' + bookTitle(l) + '" marked as returned.' : 'Returned.');
      if (ok) $('#dlg-return').close();
    });

    $('#form-pin').addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = $('#pin-input').value.trim();
      if (!pin) return;
      store.set('lib_pin', pin);
      $('#dlg-pin').close();
      run('list');
    });
    $('#dlg-pin').addEventListener('cancel', (e) => e.preventDefault()); // Esc must not skip the PIN

    // keep every PC up to date (other people's changes) - every minute, and when the tab is reopened
    setInterval(() => {
      if (!DEMO && !busy && document.visibilityState === 'visible' && !anyDialogOpen() && store.get('lib_pin', '')) run('list');
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!DEMO && document.visibilityState === 'visible' && Date.now() - lastSync > 30000 &&
          !busy && !anyDialogOpen() && store.get('lib_pin', '')) run('list');
    });
  }

  /* ---------------- start ---------------- */
  function start() {
    document.title = CFG.title;
    $('#app-title').textContent = CFG.title;
    $('#demo-banner').hidden = !DEMO;
    $('#btn-lock').hidden = DEMO;
    bind();
    showView(location.hash.slice(1));
    render();
    if (DEMO || store.get('lib_pin', '')) run('list');
    else { setSync('err'); $('#sync').textContent = 'Locked'; showPin(); }
  }

  start();
})();
