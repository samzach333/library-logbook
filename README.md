# Library Log Book

A small shared log book for the office book collection: who took which book, when, when it is due,
and when it came back.

- **Website**: plain HTML/CSS/JavaScript (no build step, no libraries) – hosted free on GitHub Pages.
- **Database**: a Google Sheet (tabs `Books`, `People`, `Loans`) – everyone's PC reads and writes the
  same sheet, and your guide can open it like a normal spreadsheet.
- **Access**: one shared office PIN. Without it the website shows nothing and saves nothing.

## What it does

| Screen | What you do there |
|---|---|
| Dashboard | Counts (books / on the shelf / with people / overdue), list of books currently out (overdue in red) with a **Returned** button, recent activity |
| Issue a book | Pick book + person + return date (default 14 days) + optional remarks |
| Books | Add / edit / delete books, search, see who has each book, per-book history |
| People | The team list (name, phone, group/role) and what each person has right now |
| History | Every issue/return record, filters (not returned / overdue / returned), **Export to Excel (CSV)** |

"You are" (top right) is the person using the PC right now – it is recorded as *given by* / *received by*.
It is remembered per PC.

---

## 1. Try it right now (demo mode, no setup)

Double-click `index.html`. With `apiUrl: ''` in `config.js` it runs in **demo mode**: sample data,
saved only in that browser. Use **Clear demo data** to start empty.

## 2. Connect the shared Google Sheet (one time, ~10 minutes)

Do this with the Google account that should **own** the records (yours or your guide's).

1. Open <https://sheets.google.com> → create a **Blank** spreadsheet → name it `Library Log Book`.
2. In the sheet: **Extensions → Apps Script**.
3. Delete everything in `Code.gs`, paste the full contents of `google-apps-script/Code.gs` from this
   folder, and press **Save** (disk icon).
4. Time zone check: click **Project Settings** (gear icon) → tick **Show "appsscript.json"** → open
   `appsscript.json` in the editor and make sure it says `"timeZone": "Asia/Kolkata"` → Save.
5. Go back to the Google Sheet tab and **reload** the page. A new menu **Library** appears.
   - **Library → 1. Set up sheets**. Google asks for permission the first time:
     choose your account → *"Google hasn't verified this app"* → **Advanced** → **Go to … (unsafe)** →
     **Allow**. (Normal for a script you wrote yourself; it only touches this one sheet.)
   - **Library → 2. Set / change PIN** → type an office PIN (at least 6 characters).
6. Back in Apps Script: **Deploy → New deployment** → gear icon → **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (needed so office PCs can reach it without each person logging in to
     Google – the PIN is what protects it)
   - **Deploy** → copy the **Web app URL** (ends in `/exec`).
7. Open `config.js` and paste it: `apiUrl: 'https://script.google.com/macros/s/…/exec',`
8. Reload `index.html` → enter the PIN → done. Add the team on the **People** tab first (including
   yourself), choose your name in "You are", then add the books.

**Changing `Code.gs` later**: Deploy → **Manage deployments** → pencil icon → Version: **New version**
→ Deploy. The URL stays the same.

## 3. Put the website online (GitHub Pages)

1. Create a repository on GitHub (for example `library-logbook`) and upload these files:
   `index.html`, `style.css`, `app.js`, `config.js`, `README.md`, `google-apps-script/Code.gs`.
2. Repository **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main**, folder
   **/ (root)** → Save.
3. After a minute the site is at `https://<your-username>.github.io/library-logbook/` – share that
   link and the PIN with the team.

## Privacy – what is public and what is not

- A GitHub Pages site and its repository are **public** on a free account. They contain only the
  website code and the Apps Script URL – **no records and no PIN**.
- The records live only in the Google Sheet. Share the sheet itself (Google "Share" button) only with
  people who should edit it directly.
- The PIN is stored in the script's properties, never in any file. Each PC remembers it until someone
  presses **Lock**.
- Anyone who knows both the link and the PIN can change the log, so give the PIN only to the team, and
  change it (Library → Set / change PIN) if someone leaves.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page layout and dialogs |
| `style.css` | Look and feel (light/dark automatic, phone-friendly) |
| `app.js` | All website logic; also contains the demo-mode backend |
| `config.js` | **Your settings**: `apiUrl`, page title, default loan days |
| `google-apps-script/Code.gs` | The Google Sheet backend (paste into Apps Script) |
