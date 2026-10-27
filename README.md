# RS Inventory

Inventory, sales and purchase app for one shop. It runs on one Windows PC in the shop (local
PostgreSQL database), and phones / PCs on the shop Wi-Fi open it in a browser. It is never exposed
to the internet.

Current release: see [`VERSION`](VERSION) and the git tags (`v3.1.0`, ...).
For developers:
- [docs/VERSIONING.md](docs/VERSIONING.md): branches, releases, and how V3.2 / V4 are built
- [docs/CI-CD.md](docs/CI-CD.md): env files, databases, the GitHub pipeline, and how an update reaches the shop

## The two folders on the shop PC

| Folder | What | Who changes it |
|---|---|---|
| `C:\RS-Inventory\` | This repository (program only) | Only `UPDATE.bat` (git) |
| `C:\RS-Inventory-Data\` | `client.env` / `demo.env` (passwords, settings), product images, backups, logs, `version-history.txt` | The app and the scripts. **Never in git, never sent to anyone.** |

The data folder is the program folder's name + `-Data`. To put it elsewhere, set the Windows
user environment variable `RS_DATA_ROOT` before the first setup.

## Install on the shop PC (one time, 20-40 minutes, needs internet)

1. Install Git: open **PowerShell** and run
   ```
   winget install -e --id Git.Git
   ```
   (or download it from https://git-scm.com/download/win). Close and reopen PowerShell.
2. Download the program:
   ```
   git clone https://github.com/gitansh6126/measurement-inventory.git C:\RS-Inventory
   ```
3. Open `C:\RS-Inventory` and double-click **`SETUP-FIRST-TIME.bat`**.
   It installs Node.js and PostgreSQL when they are missing, creates the databases and the
   settings files (random passwords), builds the app, fills the demo company, and puts the
   shortcuts on the desktop.

   | It asks | Answer |
   |---|---|
   | New PostgreSQL password (only if PostgreSQL is not installed yet) | Choose one and **write it down** |
   | PostgreSQL 'postgres' password (PostgreSQL already installed) | The password chosen when it was installed |
   | Company name, admin name / email / password | The first admin (restore a backup afterwards, see below) |
   | Windows "Do you want to allow...?" | **Yes** |
   | Network is Public... set to Private? | **Y** if it is the shop Wi-Fi |

4. Set a second backup place: open `C:\RS-Inventory-Data\client.env` with Notepad, set
   `BACKUP_COPY_DIR=` to a USB drive or Google Drive / OneDrive folder (for example
   `E:\RS-Backups`), save. Change nothing else in that file.

### Desktop shortcuts

| Shortcut | What it does |
|---|---|
| **RS Inventory - Start Shop** | Starts the real company (`http://<this PC's IP>:3210`) **and** the demo company (port 3310) for every phone / PC on the shop Wi-Fi. The window prints the addresses. Inside the app, **Switch to Demo company** (top strip) opens the demo |
| **RS Inventory - Stop Server** | Stops both |
| **RS Inventory - Update** | Installs the newest release (see below) |

**Auto start:** the same start runs by itself at every Windows sign-in (shortcut
"RS Inventory - Auto start" in the Windows Startup folder; it opens minimized in the taskbar).
To switch it off: `powershell -ExecutionPolicy Bypass -File C:\RS-Inventory\local-server\create-shortcuts.ps1 -NoAutoStart`.

Closing the black window does not stop the app; use **Stop Server**. The backup still runs by
itself every night at 20:45 and before every update. Other launchers (demo only, backup now,
smoke test, V2 copy, developer tools) are in [`archive\`](archive/README.md).

## Bring back the shop's data from an in-app backup

Use the backup ZIP downloaded from the app (**Backup & Restore -> Download**):

1. Start **RS Inventory - Shop** and sign in with the admin created during setup.
2. **Backup & Restore -> Restore** -> choose the ZIP -> confirm.
3. Everything comes back: products, stock, rolls, sets, warehouses, sales, purchases, orders,
   parties, vendor prices, images, document numbers, and the users with their old passwords.
   Exceptions: the company keeps the name typed at setup; a user whose email already exists
   here (the setup admin) keeps the new password; the "who changed what" history is not restored.
4. Check a few products, stock figures and the last invoices, and sign in as a normal user.

Upload limit: 100 MB. Keep the ZIP and the old install until everything is checked.

## Update to a new version

Double-click **RS Inventory - Update** (or `UPDATE.bat`). It:

1. checks GitHub for the newest release and shows what changed (answer **Y**),
2. stops the app and backs up both companies (database + images),
3. installs the release, updates the database, builds, starts,
4. writes the result in `C:\RS-Inventory-Data\version-history.txt`.

If any step fails it **rolls back by itself**: it puts the previous version back (plus the
databases from the backup it took a minute earlier, when the new version had database
changes) and starts it again. Then send `C:\RS-Inventory-Data\logs\update-<date>.log` to the
developer. Nothing typed in the app is lost: the app is stopped during the whole update.

`UPDATE.bat -CheckOnly` only shows whether a new release exists.

## Moving from the old ZIP install (`C:\RS-Inventory-V3.1`)

1. In the old app: **Backup & Restore -> Download** (keep the ZIP safe), then stop the old app.
2. Do the install above, then restore the ZIP.
3. Setup replaces the old scheduled tasks and firewall rule. Delete the old
   "RS Inventory V3.1 ..." desktop shortcuts. Keep `C:\RS-Inventory-V3.1` for 30 days, then
   delete it.

Setup reuses the existing databases (`rs_v31_client`, `rs_v31_demo_local`) if they are still
there; the restore then replaces the company with the ZIP's data.

## Problems

| Problem | Fix |
|---|---|
| Phone cannot open `:3210` | Same Wi-Fi? Double-click **Start Shop** again and click **Yes** (adds the firewall rule). |
| App "did not start" | The window shows the last log lines; all logs are in `C:\RS-Inventory-Data\logs\`. |
| Update says it cannot reach GitHub | Check the internet and try again; nothing was changed. |
| Backup FAILED | Set `BACKUP_COPY_DIR` (install step 4). |
| Something else | Run `local-server\check.ps1` (right-click -> Run with PowerShell) and send the result. |

Never forward ports 3210 / 4210 / 3310 / 4310 on the router.

## Other tools

All in [`archive\`](archive/README.md) (still working, just off the desktop):
- `archive\local-server\UPGRADE-FROM-V2.bat`: copies the real company from an old V2 install
  (`C:\RS-Inventory-V2`, read only).
- `archive\local-server\TEST-APP.bat`: read-only smoke test of the running app.
- `archive\START-DEMO.bat` / `archive\BACKUP-NOW.bat`: demo only / manual backup now.
- `archive\dev\`: developer launchers (hot reload, UI prototype); not for the shop.
