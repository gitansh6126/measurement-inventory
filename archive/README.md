# archive\ - launchers taken off the shop's desktop (since 3.1.2, 2026-10-27)

The shop now uses only three desktop shortcuts (**Start Shop**, **Stop Server**, **Update**) plus
an automatic start at Windows sign-in. Everything below was moved here so the program folder
stays simple. **Nothing was deleted and every file still works**: the paths inside were changed so
they still find `local-server\` from this folder. Double-click them here when needed.

The PowerShell engines they call (`backup.ps1`, `smoke.ps1`, `upgrade-from-v2.ps1`,
`START-NETWORK-DEV.ps1`, ...) stay in `local-server\`, because other scripts use them too.

| File | Was at | What it does | Why archived / replaced by |
|---|---|---|---|
| `START-DEMO.bat` | root | Starts only the demo company (port 3310) | **Start Shop** now starts the real company and the demo together; the app's *Switch to Demo company* button opens it |
| `BACKUP-NOW.bat` | root | Backup of the real company right now | The nightly backup (20:45 scheduled task) and the backup before every update still run. Use this file for an extra manual backup |
| `local-server\TEST-APP.bat` | `local-server\` | Read-only smoke test of the running app (`smoke.ps1`) | Developer / support check, not a daily shortcut |
| `local-server\UPGRADE-FROM-V2.bat` | `local-server\` | One-time copy of the real company from the old V2 install | The shop already moved off V2 |
| `dev\*.bat`, `dev\*.ps1` | `dev\` | Developer launchers: dev mode (hot reload), built demo, LAN + internet tunnel, standalone UI prototype | Developer PC only; never needed on the shop PC |

To bring one back for good: `git mv archive\<file> <old place>` and change its
`%~dp0..\` paths back (see `git log --follow` on the file).
