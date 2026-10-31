# RS Inventory

Inventory, sales and purchase app for one shop. It runs on one Windows PC in the shop (local
PostgreSQL database), and phones / PCs on the shop Wi-Fi open it in a browser. It is never exposed
to the internet.

Current release: see [`VERSION`](VERSION) and the git tags (`v3.1.0`, ...).
For developers:
- [DEVELOPER-SETUP.md](DEVELOPER-SETUP.md): clone, run with demo data, and test (start here)
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
| **RS Inventory - Shop** | Starts the real company: `http://<this PC's IP>:3210` (the window prints the address) |
| **RS Inventory - Demo** | Starts the demo company (sample data, *Admin* button on the login page): port 3310 |
| **RS Inventory - Stop** | Stops both |
| **RS Inventory - Update** | Installs the newest release (see below) |
| **RS Inventory - Backup now** | Backup of the real company now (also automatic every night at 20:45) |

Closing the black window does not stop the app; use **Stop**.

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

## Keep the shop PC running

The **watchdog** (scheduled task "RS Inventory - Watchdog", every 5 minutes, set up by
`SETUP-FIRST-TIME.bat` / `local-server\install-autostart.ps1`) brings the app back by itself when
it crashed or the PC restarted (Windows Update, power cut), also when nobody signed in to
Windows. It only restarts what was running: after **Stop** the app stays stopped. During an
update it waits. Its notes: `C:\RS-Inventory-Data\logs\watchdog-<month>.log`. If setup did not
run as Administrator, the watchdog only works while someone is signed in: run
`local-server\install-autostart.ps1` once in an **Administrator** PowerShell.

One-time settings on the shop PC (`local-server\check.ps1` reports each one):

| Setting | Why |
|---|---|
| Settings > System > Power: **Sleep = Never** (on mains power) | A sleeping PC cannot serve the phones. |
| Control Panel > Power Options > power buttons: **untick "Turn on fast startup"** | Shut down then really restarts Windows and PostgreSQL. |
| Router: **reserve this PC's IP address** (DHCP reservation) | Phone bookmarks keep working. Or use `http://<pc-name>:3210`. |
| A small **UPS** for the PC and the router | A power cut during a save can damage the database. |
| Windows Update **active hours** = shop hours | No restart in the middle of a sale. |
| Shop Wi-Fi with a password; customers on a separate **guest** Wi-Fi | The app uses plain http inside the shop; guests must not be on that network. |
| `BACKUP_COPY_DIR` on a USB drive or another disk | The backup survives a dead disk. |

The Backup & Restore page shows the last nightly backup and weekly restore test. The admin
dashboard shows a red box when the backup failed or is more than a day old.

## Monitoring (alerts on your phone, free)

1. Make a free account at https://healthchecks.io and create three checks:
   - **Shop app**: period 5 minutes, grace 15 minutes.
   - **Nightly backup**: period 1 day, grace 2 hours.
   - **Restore test**: period 7 days, grace 1 day.
   Add your e-mail, Telegram or WhatsApp under *Integrations*.
2. Copy each check's ping URL into `C:\RS-Inventory-Data\client.env`:
   ```
   MONITOR_PING_URL=https://hc-ping.com/<uuid of Shop app>
   MONITOR_BACKUP_PING_URL=https://hc-ping.com/<uuid of Nightly backup>
   MONITOR_RESTORE_TEST_PING_URL=https://hc-ping.com/<uuid of Restore test>
   ```
3. Nothing to restart: the watchdog and the backup read the file each time.

You get a message when the app or the PC is down, a restart failed, the data drive has less
than 5 GB free, or a backup / restore test failed or did not run. Only a short status line is
sent (app version, PC name, free disk), never shop data. Blank URLs = no monitoring.

## Problems

| Problem | Fix |
|---|---|
| Phone cannot open `:3210` | Same Wi-Fi? Start **Shop** again and click **Yes** (adds the firewall rule). |
| App "did not start" | The window shows the last log lines; all logs are in `C:\RS-Inventory-Data\logs\`. |
| Update says it cannot reach GitHub | Check the internet and try again; nothing was changed. |
| Backup FAILED | Set `BACKUP_COPY_DIR` (install step 4). The reason is on the Backup & Restore page. |
| Something else | Run `local-server\check.ps1` (right-click -> Run with PowerShell) and send the result. |

Never forward ports 3210 / 4210 / 3310 / 4310 on the router.

## Other tools

- `local-server\UPGRADE-FROM-V2.bat`: copies the real company from an old V2 install
  (`C:\RS-Inventory-V2`, read only).
- `local-server\TEST-APP.bat`: read-only smoke test of the running app.
- `local-server\install-autostart.ps1 -StartAtLogon`: starts the shop app at Windows sign-in.
- `local-server\watchdog.ps1`: one watchdog round by hand (what the 5-minute task runs).
- `dev\`: developer launchers (hot reload, UI prototype); not for the shop.
