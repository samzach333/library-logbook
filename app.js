/* Atul sir's Library - front end (plain JavaScript, no libraries). */
(function () {
  'use strict';

  const CFG = Object.assign({
    apiUrl: '', title: "Atul sir's Library", subtitle: 'A shared bookshelf for our team',
    owner: 'Books kindly provided by Atul sir',
  }, window.LIBRARY_CONFIG || {});
  const DEMO = !String(CFG.apiUrl || '').trim();

  /* ---------------- helpers ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mkStore = (getArea) => ({
    get(k, d) { try { const v = getArea().getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { getArea().setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } },
    del(k) { try { getArea().removeItem(k); } catch (e) { /* blocked */ } },
  });
  const local = mkStore(() => window.localStorage);     // remembered on this PC
  const session = mkStore(() => window.sessionStorage); // forgotten when the browser closes

  /* ---------------- dates ("YYYY-MM-DD HH:mm", office local time) ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const stamp = (d) => { d = d || new Date(); return dateStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const parts = (s) => /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''));
  const dayNum = (s) => { const m = parts(s); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 86400000 : NaN; };
  const fmtDate = (s) => { const m = parts(s); return m ? +m[3] + ' ' + MONTHS[m[2] - 1] + ' ' + m[1] : (s || ''); };
  const fmtStamp = (s) => { const m = parts(s); return m ? fmtDate(s) + (m[4] ? ', ' + m[4] + ':' + m[5] : '') : (s || ''); };
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function loanStatus(l) {
    if (l.returned_at) return { key: 'returned', label: 'Returned', cls: 'done' };
    const diff = dayNum(dateStr()) - dayNum(l.due_date);
    if (isNaN(diff)) return { key: 'open', label: 'Taken', cls: 'out' };
    if (diff > 0) return { key: 'late', label: 'Overdue by ' + plural(diff, 'day'), cls: 'late', days: diff };
    if (diff === 0) return { key: 'open', label: 'Due today', cls: 'out' };
    return { key: 'open', label: plural(-diff, 'day') + ' left', cls: 'out' };
  }

  const SPINES = 8;
  const spineOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % SPINES; };
  const initials = (name) => String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  const firstName = (name) => String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || name;
  const avatar = (p) => '<span class="avatar" style="--c:var(--sp' + spineOf(p ? p.id : '?') + ')">' + esc(initials(p && p.name)) + '</span>';

  /* ---------------- shared validation (preview backend mirrors Code.gs) ---------------- */
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
  const ACCESS = {
    list: 'member', issue: 'member', returnBook: 'member', checkAdmin: 'admin',
    addBook: 'admin', updateBook: 'admin', deleteBook: 'admin', addPerson: 'admin', updatePerson: 'admin',
    deletePerson: 'admin', editLoan: 'admin', deleteLoan: 'admin',
  };
  const coded = (msg) => {
    const e = new Error(msg);
    if (/^(BAD_PIN|BAD_ADMIN_PIN|ADMIN_ONLY)$/.test(msg)) e.code = msg;
    else if (String(msg).indexOf('PIN_NOT_SET') === 0) e.code = 'PIN_NOT_SET';
    return e;
  };

  /* ---------------- backends ---------------- */
  const Remote = {
    async call(action, data) {
      let res;
      try {
        res = await fetch(CFG.apiUrl, {
          method: 'POST', // text/plain body = "simple" request, no CORS pre-flight for Apps Script
          body: JSON.stringify({
            action: action, pin: local.get('lib_pin', ''), admin_pin: session.get('lib_admin', ''), data: data || {},
          }),
        });
      } catch (e) {
        throw new Error('Cannot reach the library server - check the internet connection.');
      }
      if (!res.ok) throw new Error('Server error (' + res.status + ').');
      let out;
      try { out = await res.json(); } catch (e) { throw new Error('Unexpected reply from the server - check apiUrl in config.js.'); }
      if (!out.ok) throw coded(out.error || 'Something went wrong.');
      return out;
    },
  };

  const DEMO_KEY = 'lib_preview_db';
  const Local = {
    load() {
      let db = local.get(DEMO_KEY, null);
      if (!db || !Array.isArray(db.books)) { db = demoSeed(); local.set(DEMO_KEY, db); }
      return db;
    },
    async call(action, data) {
      const need = ACCESS[action];
      if (!need) throw new Error('Unknown action: ' + action);
      const role = session.get('lib_admin', '') ? 'admin' : 'member';
      if (need === 'admin' && role !== 'admin') throw coded('ADMIN_ONLY');
      const db = this.load();
      if (LOCAL_ACTIONS[action]) { LOCAL_ACTIONS[action](db, data || {}); local.set(DEMO_KEY, db); }
      return { ok: true, role, data: JSON.parse(JSON.stringify({ books: db.books, people: db.people, loans: db.loans })) };
    },
  };

  const validDue = (v) => {
    const due = clean(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Please choose the date you will return the book.');
    if (due < dateStr()) throw new Error('The return date cannot be in the past.');
    return due;
  };

  const LOCAL_ACTIONS = {
    addBook(db, d) {
      const title = required(d.title, 'Book title');
      let id = clean(d.id);
      if (id) { if (findById(db.books, id)) throw new Error('Book number "' + id + '" already exists.'); }
      else id = nextId('B', db.books, 3);
      db.books.push({ id, title, author: clean(d.author), category: clean(d.category), location: clean(d.location), notes: clean(d.notes), added_on: stamp() });
    },
    updateBook(db, d) {
      const b = findById(db.books, d.id);
      if (!b) throw new Error('Book not found.');
      Object.assign(b, { title: required(d.title, 'Book title'), author: clean(d.author), category: clean(d.category), location: clean(d.location), notes: clean(d.notes) });
    },
    deleteBook(db, d) {
      const b = findById(db.books, d.id);
      if (!b) throw new Error('Book not found.');
      if (openLoanFor(db.loans, b.id)) throw new Error('This book is with someone right now - mark it returned before deleting.');
      db.books = db.books.filter((x) => x !== b);
    },
    addPerson(db, d) {
      const name = required(d.name, 'Name');
      if (db.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('"' + name + '" is already in the list.');
      db.people.push({ id: nextId('P', db.people, 3), name, phone: clean(d.phone), dept: clean(d.dept), notes: clean(d.notes), added_on: stamp() });
    },
    updatePerson(db, d) {
      const p = findById(db.people, d.id);
      if (!p) throw new Error('Person not found.');
      Object.assign(p, { name: required(d.name, 'Name'), phone: clean(d.phone), dept: clean(d.dept), notes: clean(d.notes) });
    },
    deletePerson(db, d) {
      const p = findById(db.people, d.id);
      if (!p) throw new Error('Person not found.');
      if (db.loans.some((l) => l.person_id === p.id && !l.returned_at)) throw new Error(p.name + ' still has a book - mark it returned before removing them.');
      db.people = db.people.filter((x) => x !== p);
    },
    issue(db, d) {
      const book = findById(db.books, d.book_id);
      if (!book) throw new Error('Book not found.');
      const person = findById(db.people, d.person_id);
      if (!person) throw new Error('Your name is not in the list - ask the admin to add you.');
      const open = openLoanFor(db.loans, book.id);
      if (open) throw new Error('Sorry - "' + book.title + '" was just taken by ' + open.person_name + '.');
      const due = validDue(d.due_date);
      db.loans.push({ id: nextId('L', db.loans, 4), book_id: book.id, book_title: book.title, person_id: person.id, person_name: person.name,
        issued_at: stamp(), issued_by: clean(d.operator) || person.name, due_date: due, returned_at: '', received_by: '',
        issue_remarks: clean(d.remarks), return_remarks: '' });
    },
    returnBook(db, d) {
      const l = findById(db.loans, d.loan_id);
      if (!l) throw new Error('Record not found.');
      if (l.returned_at) throw new Error('Already returned on ' + l.returned_at + '.');
      Object.assign(l, { returned_at: stamp(), received_by: clean(d.operator), return_remarks: clean(d.remarks) });
    },
    editLoan(db, d) {
      const l = findById(db.loans, d.loan_id);
      if (!l) throw new Error('Record not found.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(d.due_date))) throw new Error('Please give a valid return date.');
      Object.assign(l, { due_date: clean(d.due_date), issue_remarks: clean(d.issue_remarks), return_remarks: clean(d.return_remarks) });
    },
    deleteLoan(db, d) {
      const l = findById(db.loans, d.loan_id);
      if (!l) throw new Error('Record not found.');
      db.loans = db.loans.filter((x) => x !== l);
    },
  };

  function demoSeed() {
    const ago = (n, hh) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, 15, 0, 0); return stamp(d); };
    const P = (id, name, dept) => ({ id, name, phone: '', dept, notes: '', added_on: ago(40, 10) });
    const B = (id, title, author, category, location) => ({ id, title, author, category, location, notes: '', added_on: ago(40, 10) });
    return {
      books: [
        B('B001', 'Introduction to Robotics', 'John J. Craig', 'Robotics', 'Shelf 1'),
        B('B002', 'Probabilistic Robotics', 'Thrun, Burgard & Fox', 'Robotics', 'Shelf 1'),
        B('B003', 'Modern Robotics', 'Kevin Lynch & Frank Park', 'Robotics', 'Shelf 2'),
        B('B004', 'Planning Algorithms', 'Steven M. LaValle', 'Motion planning', 'Shelf 2'),
        B('B005', 'Robot Modeling and Control', 'Spong, Hutchinson & Vidyasagar', 'Control', 'Shelf 2'),
        B('B006', 'Multiple View Geometry', 'Hartley & Zisserman', 'Vision', 'Shelf 3'),
      ],
      people: [P('P001', 'Asha (sample)', 'PhD scholar'), P('P002', 'Ravi (sample)', 'Project staff'), P('P003', 'Meera (sample)', 'Intern')],
      loans: [
        { id: 'L0001', book_id: 'B003', book_title: 'Modern Robotics', person_id: 'P002', person_name: 'Ravi (sample)',
          issued_at: ago(20, 11), issued_by: 'Ravi (sample)', due_date: addDays(-6), returned_at: '', received_by: '', issue_remarks: '', return_remarks: '' },
        { id: 'L0002', book_id: 'B001', book_title: 'Introduction to Robotics', person_id: 'P001', person_name: 'Asha (sample)',
          issued_at: ago(12, 16), issued_by: 'Asha (sample)', due_date: addDays(2), returned_at: ago(3, 10), received_by: 'Asha (sample)',
          issue_remarks: 'chapter 4', return_remarks: 'good condition' },
        { id: 'L0003', book_id: 'B002', book_title: 'Probabilistic Robotics', person_id: 'P001', person_name: 'Asha (sample)',
          issued_at: ago(2, 14), issued_by: 'Asha (sample)', due_date: addDays(12), returned_at: '', received_by: '', issue_remarks: '', return_remarks: '' },
        { id: 'L0004', book_id: 'B006', book_title: 'Multiple View Geometry', person_id: 'P003', person_name: 'Meera (sample)',
          issued_at: ago(5, 9), issued_by: 'Meera (sample)', due_date: addDays(0), returned_at: '', received_by: '', issue_remarks: '', return_remarks: '' },
      ],
    };
  }

  /* ---------------- state ---------------- */
  const api = DEMO ? Local : Remote;
  let data = { books: [], people: [], loans: [] };
  let role = 'member';
  let idx = { bookById: {}, personById: {}, openByBook: {}, openByPerson: {} };
  let busy = false;
  let lastSync = 0;
  let filter = 'all';
  let currentView = 'books';

  const isAdmin = () => role === 'admin';
  const meId = () => local.get('lib_me', '');
  const me = () => idx.personById[meId()] || null;

  function buildIndex() {
    const bookById = {}, personById = {}, openByBook = {}, openByPerson = {};
    data.books.forEach((b) => { bookById[b.id] = b; });
    data.people.forEach((p) => { personById[p.id] = p; });
    data.loans.forEach((l) => {
      if (l.returned_at) return;
      openByBook[l.book_id] = l;
      (openByPerson[l.person_id] = openByPerson[l.person_id] || []).push(l);
    });
    idx = { bookById, personById, openByBook, openByPerson };
  }
  const bookOf = (l) => idx.bookById[l.book_id] || { id: l.book_id, title: l.book_title };
  const bookTitle = (l) => bookOf(l).title || l.book_id;
  const personOf = (l) => idx.personById[l.person_id] || { id: l.person_id, name: l.person_name };
  const personName = (l) => personOf(l).name || l.person_id;

  async function call(action, payload, okMsg) {
    if (busy) { toast('Please wait - still working on the last request.'); return false; }
    setBusy(true, action === 'list' || action === 'checkAdmin' ? 'Loading…' : 'Saving…');
    try {
      const out = await api.call(action, payload);
      data = out.data;
      role = out.role === 'admin' ? 'admin' : 'member';
      lastSync = Date.now();
      render();
      setSync('ok');
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      setSync('err');
      handleError(e, action);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleError(e, action) {
    if (e.code === 'BAD_PIN') {
      local.del('lib_pin'); session.del('lib_admin');
      showGate('That password is not correct.');
    } else if (e.code === 'BAD_ADMIN_PIN') {
      session.del('lib_admin'); role = 'member'; render();
      if ($('#dlg-admin').open) $('#admin-error').textContent = 'Wrong admin password.';
      else toast('Admin password not accepted - admin mode switched off.', true);
    } else if (e.code === 'ADMIN_ONLY') {
      toast('Only the admin can do that.', true);
    } else if (e.code === 'PIN_NOT_SET') {
      showGate('The library passwords have not been set up yet (Google Sheet → Library menu).');
    } else {
      toast(e.message, true);
      if (action !== 'list' && action !== 'checkAdmin') setTimeout(() => call('list'), 400);
    }
  }

  function setBusy(v, label) {
    busy = v;
    $$('button[type="submit"]').forEach((b) => { b.disabled = v; });
    if (v) { const s = $('#sync'); s.className = 'pill busy'; s.textContent = label; }
  }

  function setSync(kind) {
    const s = $('#sync');
    if (kind === 'err') { s.className = 'pill err'; s.textContent = 'Not synced'; return; }
    s.className = 'pill ok';
    s.textContent = DEMO ? 'Preview' : 'Synced ' + stamp().slice(11);
  }

  let toastTimer = 0;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, isErr ? 6000 : 3200);
  }

  /* ---------------- gate / identity ---------------- */
  function showGate(msg) {
    $$('dialog').forEach((d) => { if (d.open) d.close(); });
    $('#app').hidden = true;
    $('#gate').hidden = false;
    $('#gate-error').textContent = msg || '';
    $('#gate-pin').value = '';
    setTimeout(() => $('#gate-pin').focus(), 50);
  }
  function showApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
  }

  function openWho() {
    const people = data.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    $('#who-grid').innerHTML = people.map((p) =>
      '<button type="button" class="who-btn' + (p.id === meId() ? ' active' : '') + '" data-act="pick-me" data-id="' + esc(p.id) + '">' +
      avatar(p) + '<span>' + esc(p.name) + '</span></button>').join('');
    $('#who-empty').hidden = people.length > 0;
    if (!$('#dlg-who').open) $('#dlg-who').showModal();
  }
  function ensureMe() { if (!me() && data.people.length) openWho(); }

  /* ---------------- render ---------------- */
  function render() {
    buildIndex();
    document.body.classList.toggle('is-admin', isAdmin());
    if (!isAdmin() && (currentView === 'people' || currentView === 'history')) showView('books');
    renderHeader();
    renderStats();
    renderAlert();
    renderMine();
    renderCatalogue();
    renderBorrowed();
    renderActivity();
    if (isAdmin()) { renderPeople(); renderHistory(); }
    $('#foot').textContent = CFG.owner + ' · ' + plural(data.books.length, 'book') + ' on our shelf';
  }

  function renderHeader() {
    const m = me();
    $('#btn-me').innerHTML = m ? avatar(m) + '<span>' + esc(firstName(m.name)) + '</span>'
      : '<span class="avatar">?</span><span>Who are you?</span>';
  }

  function renderStats() {
    const open = data.loans.filter((l) => !l.returned_at);
    const late = open.filter((l) => loanStatus(l).key === 'late');
    const avail = data.books.filter((b) => !idx.openByBook[b.id]).length;
    $('#stats').innerHTML = [
      ['', data.books.length, 'Books in the library'],
      ['ok', avail, 'On the shelf'],
      ['out', open.length, 'With people'],
      [late.length ? 'late' : '', late.length, 'Overdue'],
    ].map((s) => '<div class="stat ' + s[0] + '"><div class="num">' + s[1] + '</div><div class="lbl">' + s[2] + '</div></div>').join('');
    const c = $('#count-borrowed');
    c.textContent = open.length ? String(open.length) : '';
    c.classList.toggle('late', late.length > 0);
  }

  function renderAlert() {
    const mine = (idx.openByPerson[meId()] || []).filter((l) => loanStatus(l).key === 'late');
    const a = $('#my-alert');
    a.hidden = !mine.length;
    a.innerHTML = mine.length ? 'Please return: ' + mine.map((l) => '“' + esc(bookTitle(l)) + '” (was due ' + esc(fmtDate(l.due_date)) + ')').join(', ') : '';
  }

  function spine(b, small) {
    return '<div class="spine" style="--c:var(--sp' + spineOf(b.id) + ')">' + (small ? '' : '<span>' + esc(b.id) + '</span>') + '</div>';
  }

  function bookCard(b) {
    const l = idx.openByBook[b.id];
    const st = l ? loanStatus(l) : null;
    const mine = !!l && l.person_id === meId();
    let status;
    const acts = [];
    if (!l) {
      status = '<div class="bk-status ok"><span class="dot"></span>On the shelf' + (b.location ? ' · ' + esc(b.location) : '') + '</div>';
      acts.push('<button class="btn primary small" data-act="take" data-id="' + esc(b.id) + '">Take this book</button>');
    } else {
      const who = mine ? 'you' : esc(personName(l));
      if (st.key === 'late') {
        status = '<div class="bk-status late"><span class="dot"></span>Not returned yet – ' + esc(st.label.toLowerCase()) + '</div>' +
          '<div class="bk-meta">With ' + who + ' · was due ' + esc(fmtDate(l.due_date)) + '</div>';
      } else {
        status = '<div class="bk-status out"><span class="dot"></span>With ' + who + '</div>' +
          '<div class="bk-meta">Return by ' + esc(fmtDate(l.due_date)) + ' · ' + esc(st.label.toLowerCase()) + '</div>';
      }
      if (mine) acts.push('<button class="btn primary small" data-act="return" data-id="' + esc(l.id) + '">Return it</button>');
      else if (isAdmin()) acts.push('<button class="btn small" data-act="return" data-id="' + esc(l.id) + '">Mark returned</button>');
    }
    acts.push('<button class="btn ghost small" data-act="hist" data-id="' + esc(b.id) + '">History</button>');
    if (isAdmin()) {
      acts.push('<button class="btn ghost small" data-act="edit-book" data-id="' + esc(b.id) + '">Edit</button>');
      acts.push('<button class="btn ghost small danger" data-act="del-book" data-id="' + esc(b.id) + '">Delete</button>');
    }
    return '<article class="book ' + (st ? st.cls : 'avail') + '">' + spine(b) + '<div class="bk-body">' +
      (b.category ? '<div class="bk-cat">' + esc(b.category) + '</div>' : '') +
      '<h3 class="bk-title">' + esc(b.title) + '</h3>' +
      (b.author ? '<div class="bk-author">' + esc(b.author) + '</div>' : '') +
      status + '<div class="bk-actions">' + acts.join('') + '</div></div></article>';
  }

  function renderMine() {
    const mine = (idx.openByPerson[meId()] || []).map((l) => idx.bookById[l.book_id]).filter(Boolean);
    $('#mine-wrap').hidden = !mine.length;
    $('#mine').innerHTML = mine.map(bookCard).join('');
  }

  function renderCatalogue() {
    const cats = Array.from(new Set(data.books.map((b) => b.category).filter(Boolean))).sort();
    const catSel = $('#cat');
    const curCat = catSel.value;
    catSel.innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
    catSel.value = cats.indexOf(curCat) >= 0 ? curCat : '';
    catSel.hidden = cats.length < 2;
    $('#categories').innerHTML = cats.map((c) => '<option value="' + esc(c) + '">').join('');

    const q = $('#q').value.trim().toLowerCase();
    const books = data.books.filter((b) => {
      const l = idx.openByBook[b.id];
      const k = l ? loanStatus(l).key : 'avail';
      if (filter === 'avail' && l) return false;
      if (filter === 'out' && !l) return false;
      if (filter === 'late' && k !== 'late') return false;
      if (catSel.value && b.category !== catSel.value) return false;
      return !q || [b.id, b.title, b.author, b.category, b.location].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort((a, b) => a.title.localeCompare(b.title));
    $('#catalogue').innerHTML = books.length ? books.map(bookCard).join('')
      : '<div class="empty">' + (data.books.length ? 'No book matches.' : (isAdmin() ? 'No books yet – press “+ Add book”.' : 'No books yet.')) + '</div>';
  }

  function table(head, rows) {
    return '<table class="rt"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
  const td = (label, html, cls) => '<td data-l="' + esc(label) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>';
  const personCell = (l) => '<span class="person">' + avatar(personOf(l)) + esc(personName(l)) + '</span>';

  function waLink(l) {
    const p = personOf(l);
    let digits = String(p.phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '0') digits = digits.slice(1);
    if (digits.length === 10) digits = '91' + digits;
    if (digits.length < 11) return '';
    const msg = 'Hi ' + firstName(p.name) + ', a gentle reminder from ' + CFG.title + ': "' + bookTitle(l) +
      '" was due back on ' + fmtDate(l.due_date) + '. Please return it when you can. Thank you!';
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
  }

  function loanActions(l) {
    const acts = [];
    if (!l.returned_at && (isAdmin() || l.person_id === meId())) {
      acts.push('<button class="btn small ' + (l.person_id === meId() ? 'primary' : '') + '" data-act="return" data-id="' + esc(l.id) + '">' +
        (l.person_id === meId() ? 'Return it' : 'Mark returned') + '</button>');
    }
    if (isAdmin()) {
      if (!l.returned_at && loanStatus(l).key === 'late') {
        const wa = waLink(l);
        acts.push(wa ? '<a class="btn small wa" target="_blank" rel="noopener" href="' + esc(wa) + '">WhatsApp reminder</a>'
          : '<button class="btn small" disabled title="Add a phone number in People">No phone</button>');
      }
      acts.push('<button class="btn ghost small" data-act="edit-loan" data-id="' + esc(l.id) + '">Edit</button>');
    }
    return acts.join('');
  }

  function renderBorrowed() {
    const open = data.loans.filter((l) => !l.returned_at).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    $('#borrowed').innerHTML = open.length ? table(['Book', 'Taken by', 'Taken on', 'Return by', 'Status', ''], open.map((l) => {
      const st = loanStatus(l);
      return '<tr class="' + (st.key === 'late' ? 'late' : '') + '">' +
        td('Book', '<div class="t-title">' + esc(bookTitle(l)) + '</div><div class="sub">#' + esc(l.book_id) + '</div>') +
        td('Taken by', personCell(l)) +
        td('Taken on', esc(fmtStamp(l.issued_at)), 'num-col') +
        td('Return by', esc(fmtDate(l.due_date)), 'num-col') +
        td('Status', '<span class="tag ' + st.cls + '">' + (st.key === 'late' ? 'Not returned · ' : '') + esc(st.label) + '</span>') +
        td('', loanActions(l), 'act') + '</tr>';
    })) : '<div class="empty">Every book is on the shelf right now.</div>';
  }

  function renderActivity() {
    const ev = [];
    data.loans.forEach((l) => {
      ev.push({ t: l.issued_at, k: 'take', html: '<b>' + esc(personName(l)) + '</b> took <b>' + esc(bookTitle(l)) + '</b>' +
        ' <span class="sub">· return by ' + esc(fmtDate(l.due_date)) + '</span>' });
      if (l.returned_at) {
        ev.push({ t: l.returned_at, k: 'back', html: '<b>' + esc(personName(l)) + '</b> returned <b>' + esc(bookTitle(l)) + '</b>' +
          (l.return_remarks ? ' <span class="sub">– ' + esc(l.return_remarks) + '</span>' : '') });
      }
    });
    ev.sort((a, b) => String(b.t).localeCompare(String(a.t)));
    $('#activity').innerHTML = ev.length ? ev.slice(0, 30).map((e) =>
      '<li><span class="mark ' + e.k + '">' + (e.k === 'take' ? '↗' : '↙') + '</span><div>' + e.html +
      '<div class="when">' + esc(fmtStamp(e.t)) + '</div></div></li>').join('') : '<li class="empty">Nothing yet.</li>';
  }

  function renderPeople() {
    const people = data.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    $('#people').innerHTML = people.length ? table(['Name', 'Phone', 'Role', 'Has now', ''], people.map((p) => {
      const has = idx.openByPerson[p.id] || [];
      return '<tr>' + td('Name', '<span class="person">' + avatar(p) + esc(p.name) + '</span>' + (p.notes ? '<div class="sub">' + esc(p.notes) + '</div>' : '')) +
        td('Phone', esc(p.phone || '—'), 'num-col') + td('Role', esc(p.dept || '—')) +
        td('Has now', has.length ? has.map((l) => '<span class="tag ' + loanStatus(l).cls + '">' + esc(bookTitle(l)) + '</span>').join(' ') : '<span class="sub">nothing</span>') +
        td('', '<button class="btn ghost small" data-act="edit-person" data-id="' + esc(p.id) + '">Edit</button>' +
          '<button class="btn ghost small danger" data-act="del-person" data-id="' + esc(p.id) + '">Remove</button>', 'act') + '</tr>';
    })) : '<div class="empty">No one yet – press “+ Add person” and add every team member (including yourself).</div>';
  }

  function historyRows() {
    const q = $('#hq').value.trim().toLowerCase();
    const f = $('#hf').value;
    return data.loans.filter((l) => {
      const k = loanStatus(l).key;
      if (f === 'open' && k === 'returned') return false;
      if (f === 'late' && k !== 'late') return false;
      if (f === 'returned' && k !== 'returned') return false;
      return !q || [bookTitle(l), personName(l), l.book_id, l.issue_remarks, l.return_remarks].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
  }

  function loanTable(loans, showBook) {
    return table((showBook ? ['Book'] : []).concat(['Person', 'Taken on', 'Return by', 'Returned on', 'Status', 'Notes']).concat(isAdmin() ? [''] : []),
      loans.map((l) => {
        const st = loanStatus(l);
        const notes = [l.issue_remarks && 'Taken: ' + l.issue_remarks, l.return_remarks && 'Returned: ' + l.return_remarks].filter(Boolean);
        return '<tr class="' + (st.key === 'late' ? 'late' : '') + '">' +
          (showBook ? td('Book', '<div class="t-title">' + esc(bookTitle(l)) + '</div><div class="sub">#' + esc(l.book_id) + '</div>') : '') +
          td('Person', personCell(l)) +
          td('Taken on', esc(fmtStamp(l.issued_at)), 'num-col') +
          td('Return by', esc(fmtDate(l.due_date)), 'num-col') +
          td('Returned on', l.returned_at ? esc(fmtStamp(l.returned_at)) : '—', 'num-col') +
          td('Status', '<span class="tag ' + st.cls + '">' + esc(st.label) + '</span>') +
          td('Notes', notes.length ? notes.map(esc).join('<br>') : '—') +
          (isAdmin() ? td('', '<button class="btn ghost small" data-act="edit-loan" data-id="' + esc(l.id) + '">Edit</button>', 'act') : '') + '</tr>';
      }));
  }

  function renderHistory() {
    const rows = historyRows();
    $('#history').innerHTML = rows.length ? loanTable(rows, true) : '<div class="empty">No records.</div>';
  }

  function exportCsv() {
    const head = ['Record', 'Book no.', 'Book', 'Person', 'Taken on', 'Return by', 'Returned on', 'Status', 'Note when taken', 'Note when returned'];
    const cell = (v) => {
      v = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(v)) v = "'" + v;
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [head].concat(historyRows().map((l) => [l.id, l.book_id, bookTitle(l), personName(l), l.issued_at, l.due_date,
      l.returned_at, loanStatus(l).label, l.issue_remarks, l.return_remarks]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'library-history-' + dateStr() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- navigation ---------------- */
  const VIEWS = ['books', 'borrowed', 'activity', 'people', 'history'];
  function showView(name) {
    if (VIEWS.indexOf(name) < 0 || (!isAdmin() && (name === 'people' || name === 'history'))) name = 'books';
    currentView = name;
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  const goto = (name) => { if (location.hash === '#' + name) showView(name); else location.hash = name; };

  /* ---------------- dialogs ---------------- */
  const bookHead = (b, extra) => '<div class="dlg-book">' + spine(b, true) + '<div><div class="t-title">' + esc(b.title) + '</div>' +
    '<div class="sub">' + esc([b.author, '#' + b.id].filter(Boolean).join(' · ')) + '</div>' + (extra || '') + '</div></div>';

  let takeBookId = '';
  function openTake(bookId) {
    const b = idx.bookById[bookId];
    if (!b) return;
    if (!isAdmin() && !me()) { toast('First tell us who you are.'); openWho(); return; }
    takeBookId = b.id;
    const f = $('#form-take');
    f.reset();
    $('#take-book').innerHTML = bookHead(b);
    if (isAdmin()) {
      const people = data.people.slice().sort((a, c) => a.name.localeCompare(c.name));
      $('#take-who').innerHTML = '<select id="take-person" aria-label="Taken by">' + people.map((p) =>
        '<option value="' + esc(p.id) + '"' + (p.id === meId() ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>';
    } else {
      $('#take-who').innerHTML = '<b>' + esc(me().name) + '</b> <button type="button" class="link" data-act="switch-me">not you?</button>';
    }
    $('#take-when').innerHTML = '<b>' + esc(fmtStamp(stamp())) + '</b><span class="auto-tag">automatic</span>';
    const due = $('#take-due');
    due.min = dateStr();
    due.value = '';
    $$('#take-quick .chip').forEach((c) => c.classList.remove('active'));
    updateTakeHint();
    $('#dlg-take').showModal();
    due.focus();
  }
  function updateTakeHint() {
    const v = $('#take-due').value;
    const n = dayNum(v) - dayNum(dateStr());
    $('#take-hint').textContent = !v ? 'Choose a date, or tap 1 week / 2 weeks / 1 month.'
      : n < 0 ? 'That date is in the past.' : 'You will have it for ' + plural(n, 'day') + ' (until ' + fmtDate(v) + ').';
    $$('#take-quick .chip').forEach((c) => c.classList.toggle('active', addDays(+c.dataset.days) === v));
  }

  let returnLoanId = '';
  function openReturn(loanId) {
    const l = findById(data.loans, loanId);
    if (!l) return;
    if (!isAdmin() && l.person_id !== meId()) { toast('Only ' + personName(l) + ' or the admin can return this book.', true); return; }
    returnLoanId = l.id;
    $('#form-return').reset();
    const st = loanStatus(l);
    $('#return-book').innerHTML = bookHead(bookOf(l));
    $('#return-facts').innerHTML =
      '<div><span>Taken by</span><b>' + esc(personName(l)) + '</b></div>' +
      '<div><span>Taken on</span><b>' + esc(fmtStamp(l.issued_at)) + '</b></div>' +
      '<div><span>Was due</span><b>' + esc(fmtDate(l.due_date)) + '</b> <span class="tag ' + st.cls + '">' + esc(st.label) + '</span></div>' +
      '<div><span>Returned on</span><b>' + esc(fmtStamp(stamp())) + '</b><span class="auto-tag">automatic</span></div>';
    $('#dlg-return').showModal();
  }

  let loanEditId = '';
  function openLoanEdit(loanId) {
    const l = findById(data.loans, loanId);
    if (!l) return;
    loanEditId = l.id;
    const f = $('#form-loan');
    f.reset();
    $('#loan-book').innerHTML = bookHead(bookOf(l), '<div class="sub">' + esc(personName(l)) + ' · taken ' + esc(fmtStamp(l.issued_at)) +
      (l.returned_at ? ' · returned ' + esc(fmtStamp(l.returned_at)) : '') + '</div>');
    f.elements.due_date.value = l.due_date;
    f.elements.issue_remarks.value = l.issue_remarks || '';
    f.elements.return_remarks.value = l.return_remarks || '';
    $('#loan-ret-wrap').hidden = !l.returned_at;
    $('#dlg-loan').showModal();
  }

  function openBookDialog(book) {
    const f = $('#form-book');
    f.reset();
    f.dataset.mode = book ? 'edit' : 'add';
    $('#book-dlg-title').textContent = book ? 'Edit book' : 'Add a book';
    f.elements.id.readOnly = !!book;
    if (book) ['id', 'title', 'author', 'category', 'location', 'notes'].forEach((k) => { f.elements[k].value = book[k] || ''; });
    $('#dlg-book').showModal();
    (book ? f.elements.title : f.elements.id).focus();
  }

  function openPersonDialog(p) {
    const f = $('#form-person');
    f.reset();
    $('#person-dlg-title').textContent = p ? 'Edit person' : 'Add a person';
    f.elements.id.value = p ? p.id : '';
    if (p) ['name', 'phone', 'dept', 'notes'].forEach((k) => { f.elements[k].value = p[k] || ''; });
    $('#dlg-person').showModal();
    f.elements.name.focus();
  }

  function openBookHistory(b) {
    $('#hist-title').textContent = 'History – ' + b.title;
    const loans = data.loans.filter((l) => l.book_id === b.id).sort((x, y) => String(y.issued_at).localeCompare(String(x.issued_at)));
    $('#hist-list').innerHTML = loans.length ? loanTable(loans, false) : '<div class="empty">Nobody has taken this book yet.</div>';
    $('#dlg-hist').showModal();
  }

  /* ---------------- events ---------------- */
  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => goto(t.dataset.view)));
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

    $$('[data-toggle-pw]').forEach((b) => b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.togglePw);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.textContent = inp.type === 'password' ? 'Show' : 'Hide';
    }));

    document.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('dialog').close(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.act) {
        case 'take': openTake(id); break;
        case 'return': openReturn(id); break;
        case 'hist': if (idx.bookById[id]) openBookHistory(idx.bookById[id]); break;
        case 'edit-book': if (idx.bookById[id]) openBookDialog(idx.bookById[id]); break;
        case 'del-book': {
          const bk = idx.bookById[id];
          if (bk && confirm('Delete “' + bk.title + '” from the library?\n(Its past records stay in History.)')) call('deleteBook', { id }, 'Book deleted.');
          break;
        }
        case 'edit-person': if (idx.personById[id]) openPersonDialog(idx.personById[id]); break;
        case 'del-person': {
          const p = idx.personById[id];
          if (p && confirm('Remove ' + p.name + ' from the team list?\n(Their past records stay in History.)')) call('deletePerson', { id }, 'Removed.');
          break;
        }
        case 'edit-loan': openLoanEdit(id); break;
        case 'pick-me':
          local.set('lib_me', id);
          $('#dlg-who').close();
          render();
          toast('Welcome, ' + firstName((idx.personById[id] || {}).name) + '!');
          break;
        case 'switch-me': $('#dlg-take').close(); openWho(); break;
        default: break;
      }
    });

    $('#filters').addEventListener('click', (e) => {
      const c = e.target.closest('[data-filter]');
      if (!c) return;
      filter = c.dataset.filter;
      $$('#filters .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderCatalogue();
    });
    $('#q').addEventListener('input', renderCatalogue);
    $('#cat').addEventListener('change', renderCatalogue);
    $('#hq').addEventListener('input', renderHistory);
    $('#hf').addEventListener('change', renderHistory);
    $('#btn-export').addEventListener('click', exportCsv);
    $('#btn-me').addEventListener('click', openWho);
    $('#btn-add-book').addEventListener('click', () => openBookDialog(null));
    $('#btn-add-person').addEventListener('click', () => openPersonDialog(null));
    $('#btn-admin').addEventListener('click', () => {
      $('#form-admin').reset();
      $('#admin-error').textContent = DEMO ? 'Preview mode: any password works.' : '';
      $('#dlg-admin').showModal();
      $('#admin-pin').focus();
    });
    $('#btn-admin-exit').addEventListener('click', () => { session.del('lib_admin'); call('list', null, 'Admin mode off.'); });
    $('#btn-logout').addEventListener('click', () => {
      local.del('lib_pin'); session.del('lib_admin');
      data = { books: [], people: [], loans: [] }; role = 'member';
      render();
      showGate('You have logged out.');
    });
    $('#btn-demo-reset').addEventListener('click', () => {
      if (confirm('Reset the preview to its sample data?')) { local.del(DEMO_KEY); call('list', null, 'Preview reset.'); }
    });

    $('#form-gate').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = $('#gate-pin').value.trim();
      if (!pin) return;
      $('#gate-error').textContent = '';
      local.set('lib_pin', pin);
      if (await call('list')) { showApp(); ensureMe(); }
    });

    $('#form-admin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#admin-pin').value.trim();
      if (!pw) return;
      session.set('lib_admin', pw);
      if (await call('checkAdmin', null, 'Admin mode on.')) $('#dlg-admin').close();
    });

    $('#take-due').addEventListener('input', updateTakeHint);
    $('#take-quick').addEventListener('click', (e) => {
      const c = e.target.closest('[data-days]');
      if (!c) return;
      $('#take-due').value = addDays(+c.dataset.days);
      updateTakeHint();
    });

    $('#form-take').addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = idx.bookById[takeBookId];
      const personId = isAdmin() && $('#take-person') ? $('#take-person').value : meId();
      const person = idx.personById[personId];
      if (!b || !person) { toast('Choose who is taking the book.', true); return; }
      const ok = await call('issue', {
        book_id: b.id, person_id: person.id, due_date: $('#take-due').value,
        remarks: e.target.elements.remarks.value, operator: me() ? me().name : (isAdmin() ? 'Admin' : person.name),
      }, (person.id === meId() ? 'Enjoy reading “' : '“') + b.title + '”' + (person.id === meId() ? '!' : ' issued to ' + person.name + '.'));
      if (ok) $('#dlg-take').close();
    });

    $('#form-return').addEventListener('submit', async (e) => {
      e.preventDefault();
      const l = findById(data.loans, returnLoanId);
      const ok = await call('returnBook', { loan_id: returnLoanId, remarks: e.target.elements.remarks.value,
        operator: me() ? me().name : 'Admin' }, l ? 'Thanks! “' + bookTitle(l) + '” is back on the shelf.' : 'Returned.');
      if (ok) $('#dlg-return').close();
    });

    $('#form-loan').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (await call('editLoan', { loan_id: loanEditId, due_date: f.elements.due_date.value,
        issue_remarks: f.elements.issue_remarks.value, return_remarks: f.elements.return_remarks.value }, 'Record updated.')) $('#dlg-loan').close();
    });
    $('#btn-del-loan').addEventListener('click', async () => {
      if (!confirm('Delete this record completely? Use this only for mistakes.')) return;
      if (await call('deleteLoan', { loan_id: loanEditId }, 'Record deleted.')) $('#dlg-loan').close();
    });

    $('#form-book').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const d = {};
      ['id', 'title', 'author', 'category', 'location', 'notes'].forEach((k) => { d[k] = f.elements[k].value; });
      const edit = f.dataset.mode === 'edit';
      if (await call(edit ? 'updateBook' : 'addBook', d, edit ? 'Book updated.' : '“' + d.title.trim() + '” added to the library.')) $('#dlg-book').close();
    });

    $('#form-person').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const d = {};
      ['id', 'name', 'phone', 'dept', 'notes'].forEach((k) => { d[k] = f.elements[k].value; });
      const edit = !!d.id;
      if (await call(edit ? 'updatePerson' : 'addPerson', d, edit ? 'Saved.' : d.name.trim() + ' added.')) $('#dlg-person').close();
    });

    // other people's changes: refresh every minute, and when the tab is opened again
    const canAutoRefresh = () => !DEMO && !busy && !$('#app').hidden && document.visibilityState === 'visible' &&
      !$$('dialog').some((d) => d.open) && local.get('lib_pin', '');
    setInterval(() => { if (canAutoRefresh()) call('list'); }, 60000);
    document.addEventListener('visibilitychange', () => { if (canAutoRefresh() && Date.now() - lastSync > 30000) call('list'); });
  }

  function drawShelf() {
    const heights = [44, 52, 38, 56, 47, 41, 54, 36, 50, 45, 57, 40, 49, 53, 39, 46, 55, 42, 51, 37, 48, 44];
    $('#gate-shelf').innerHTML = heights.map((h, i) => '<i style="height:' + h + 'px;width:' + (9 + (i * 7) % 6) +
      'px;background:var(--sp' + ((i * 5) % SPINES) + ')"></i>').join('');
  }

  /* ---------------- start ---------------- */
  function start() {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
    document.title = CFG.title;
    $$('[data-title]').forEach((el) => { el.textContent = CFG.title; });
    $$('[data-subtitle]').forEach((el) => { el.textContent = CFG.subtitle; });
    $$('[data-owner]').forEach((el) => { el.textContent = CFG.owner; });
    $('#demo-banner').hidden = !DEMO;
    $('#gate-note').textContent = DEMO ? 'Preview mode – any password opens it until the Google Sheet is connected.' : '';
    drawShelf();
    bind();
    showView(location.hash.slice(1));
    if (local.get('lib_pin', '')) {
      showApp();
      call('list').then((ok) => { if (ok) ensureMe(); });
    } else {
      showGate('');
    }
  }

  start();
})();
