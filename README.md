# Atul sir's Library

A small private library website for our team: see every book, take one (the date and time are recorded
automatically, you choose your return date), return it, and see who has what and what is overdue.

- **Website**: plain HTML/CSS/JavaScript, hosted free on GitHub Pages.
- **Database**: a Google Sheet (tabs `Books`, `People`, `Loans`) shared by every PC. The admin can also
  open it like a normal spreadsheet.
- **Two passwords**, both checked by Google, never stored in any file of this repository:
  - **Member password**: everyone types it to open the site.
  - **Admin password**: only the admin. Unlocks adding/editing/deleting books and people, the full history,
    fixing records and WhatsApp reminders.

## What members can do
- Browse and search all books, filter by *On the shelf / Taken / Overdue* and by category.
- **Take this book**: the taken-on date and time are filled in automatically; they must choose a
  return date (or tap 1 week / 2 weeks / 1 month).
- **Return it**: for their own books only. The return time is recorded automatically.
- See **Borrowed** (who has what and until when) and **Activity**.
- Overdue books show **"Not returned yet – overdue by N days"** in red, and the person who has one sees
  a red reminder bar at the top.

## What the admin can do (Admin button → admin password)
- Add / edit / delete books, and add / edit / remove team members (with phone for reminders).
- Mark any book returned, change a return date, fix or delete wrong records.
- Full history with search and **Export to Excel**.
- **WhatsApp reminder** button on overdue books (opens WhatsApp with a polite message ready).
- Admin mode ends when the browser is closed, or with **exit**.

---

## 1. Preview (no setup)

While `apiUrl` in `config.js` is empty the site runs in **preview mode**: sample data, saved only in that
browser, and *any* password opens it. Fine for looking around, but not for real use.

## 2. Connect the Google Sheet (one time, about 10 minutes)

Do this with the Google account that should **own** the records.

1. Open <https://sheets.google.com> → **Blank** spreadsheet → name it `Atul sir's Library`.
2. **Extensions → Apps Script**. Delete everything in `Code.gs`, paste the whole of
   `google-apps-script/Code.gs` from this repository, press **Save**.
3. Time zone: **Project Settings** (gear) → tick **Show "appsscript.json"** → open it in the editor →
   make sure it says `"timeZone": "Asia/Kolkata"` → Save.
4. Go back to the Sheet tab and **reload** it. A **Library** menu appears.
   - **Library → 1. Set up sheets**. The first time, Google asks for permission: choose your account →
     *"Google hasn't verified this app"* → **Advanced** → **Go to … (unsafe)** → **Allow**.
     (Normal for your own script. It only touches this sheet.)
   - **Library → 2. Set member password**: the password the team will use.
   - **Library → 3. Set admin password**: your own, different one.
5. Apps Script: **Deploy → New deployment** → gear → **Web app**:
   *Execute as* **Me**, *Who has access* **Anyone** → **Deploy** → copy the **Web app URL** (ends in `/exec`).
   ("Anyone" lets office PCs reach it without a Google login. The passwords are what protect it.)
6. On GitHub, open `config.js` → pencil (Edit) → paste the URL into `apiUrl: '…'` → **Commit changes**.
7. After about a minute, open the site, press **Ctrl+Shift+R**, enter the member password.
   Then **Admin** → admin password → **People** → add every team member (including yourself) →
   **Books → + Add book**.

**Changing `Code.gs` later**: Deploy → **Manage deployments** → pencil → Version **New version** → Deploy
(the URL stays the same).

**Changing a password**: use the Library menu in the Sheet again. Everyone then types the new one.

## 3. Updating the website on GitHub

Repository → **Add file → Upload files** → drag in the changed files (same names replace the old ones)
→ **Commit changes**. The live site updates in about a minute (Ctrl+Shift+R to see it).
**Don't overwrite `config.js` on GitHub** once your `apiUrl` is in it, unless your local copy has it too.

## Privacy

- The GitHub repository and site are public on a free account. They contain only code and the Apps
  Script URL: **no records, no passwords**. Never type a password into any file here.
- The records live only in the Google Sheet. Use its Share button only for people who should edit it
  directly.
- Each PC remembers the member password until **Log out**. Admin mode is forgotten when the browser
  closes.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout, login screen, dialogs |
| `style.css` | Design (light/dark automatic, phone-friendly) |
| `app.js` | Website logic, plus the preview-mode backend |
| `config.js` | Settings: `apiUrl`, title, subtitle, owner line |
| `google-apps-script/Code.gs` | Google Sheet backend: passwords, roles, all saving |
