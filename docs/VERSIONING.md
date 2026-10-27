# Versions, branches and releases (how to build V3.2, V4, ...)

## The short answer

**One repository, one folder. Versions are git tags and branches, never folder copies.**

The old way (`v2\`, `v3\`, `v3.1\`, `v4\` as copied folders) caused every problem we had:
- every fix had to be copied by hand into each folder (and logged in the propagation register);
- each folder had its own package scope, ports, database names and scripts;
- the shop got a ZIP that could not tell what changed;
- nobody could be sure which folder was the "real" one.

With git, history *is* the version list. `git diff v3.1.0 v3.2.0` shows exactly what a version
changed, and a fix made once can be merged into every line that needs it.

## Folder layout (the same for every version)

```
measurement-inventory\           <- the only inventory repo (GitHub: gitansh6126/measurement-inventory, public)
                                    dev PC: D:\client works\rs new\measurement-inventory
                                    shop PC: C:\RS-Inventory
  VERSION                        <- the release (3.1.1 now); must equal the tag (CI checks it)
  README.md                      <- shop install / update guide
  SETUP-FIRST-TIME.bat  START-SHOP.bat  START-DEMO.bat  STOP.bat  UPDATE.bat  BACKUP-NOW.bat
  app\                           <- the application (pnpm workspace)
    api\                         <- Express + Prisma API
      prisma\schema.prisma       <- database schema
      prisma\migrations\0001..   <- forward-only database changes (append only)
      src\  tests\  scripts\
    web\                         <- Next.js front end
    shared\                      <- types / rules used by api and web
  local-server\                  <- Windows scripts: setup, start, stop, build, backup, update
  dev\                           <- developer launchers (hot reload, UI prototype)
  docs\                          <- plans, decisions, CI-CD.md, this file
  .github\workflows\ci.yml       <- guard + test + release

<repo folder>-Data\              <- NOT in git: env files, images, backups, logs
                                    dev PC: D:\client works\rs new\measurement-inventory-Data
                                    shop PC: C:\RS-Inventory-Data
```

A new version **changes files inside this tree**. It never adds a sibling folder. A new
module (for example GST) goes inside the structure: `app\api\src\routes\gst.ts`,
`app\web\app\(app)\gst\`, a new migration folder, and a plan in `docs\`.

## Version numbers

`MAJOR.MINOR.PATCH`, tag `vMAJOR.MINOR.PATCH`:

| Change | Example | Bump | Tag |
|---|---|---|---|
| Bug fix, small UI change, no new screen | fix a stock total | PATCH | `v3.1.1` |
| New features, still the same product (new migrations are fine) | V3.2: GST tags, Tally export | MINOR | `v3.2.0` |
| Big change in how the shop works, or a data change that needs a planned move | V4: multi-branch / online orders | MAJOR | `v4.0.0` |
| Test build for the shop or for yourself | release candidate | `-rc1` suffix | `v3.2.0-rc1` (UPDATE.bat skips these unless `-Tag` is given) |

## Branches

```
main ----*-----*------*----------*-----*------------*----->   always releasable
          \           \ v3.1.1  /       \ v3.2.0    / v3.2.1
           feature/gst  fix/stock-total  feature/tally

release/3.1 ---*-----*--->   only if the shop must stay on 3.1 while main moves to 4.0
                v3.1.4  v3.1.5
```

| Branch | Purpose | Rule |
|---|---|---|
| `main` | the next release | protected: merge only through a PR with green CI |
| `feature/<name>` | one feature (`feature/gst`, `feature/warehouse-shift-report`) | branch from `main`, PR back into `main`, delete after the merge |
| `fix/<name>` | one bug fix | same as feature |
| `release/<major.minor>` | **only when needed**: a hot fix for an older line that the shop still runs | create from its last tag; cherry-pick the fix; tag `v3.1.x` from it |

### Building V3.2

1. Work on `feature/...` branches off `main`, one per item in `docs\V3.2-BACKLOG.md`.
2. Each PR: CI green, add migrations as `0039_...`, `0040_...` (never edit an old one), update
   `seed-demo.ts` so the demo company shows the feature.
3. When V3.2 is ready: `VERSION` = `3.2.0`, tag `v3.2.0-rc1`, try it on your PC with
   `UPDATE.bat -Tag v3.2.0-rc1` against a copy of the shop's backup.
4. Then tag `v3.2.0`. The shop clicks **Update**.
5. While V3.2 is still being built, a shop bug fix is a `fix/...` branch, tagged `v3.1.1` from
   `main` if `main` has nothing unfinished in it. Otherwise branch `release/3.1` from `v3.1.0`,
   fix it there, tag `v3.1.1`, then merge the fix into `main`.

### Building V4

The same model. V4 is just `MAJOR` = 4:
- Long work goes on `feature/v4-...` branches, or several of them, merged into `main` when
  each part is ready, behind a setting / feature flag if it must not show yet.
- When `main` is going to break the shop's way of working before V4 is finished,
  create `release/3.x` from the last 3.x tag first. The shop keeps getting 3.x fixes from there,
  and `main` moves on to 4.0.
- A data change that cannot be a simple migration (for example splitting one company into
  branches) gets a migration **plus** a written move plan in `docs\` and a dry run on a copy of
  the shop's backup before `v4.0.0` is tagged.
- Database names, ports, the data folder and the desktop shortcuts **stay the same**, so the
  shop's Update button simply moves them to V4.

## Rules that keep it easy

1. **One source of truth.** Never copy the app into a new folder again.
   To look at an old version: `git worktree add ..\measurement-inventory-3.1 v3.1.0` (read-only use,
   delete after).
2. **The shop runs tags only.** Never tell the shop to "pull main".
3. **Migrations are append-only**, and each one keeps the existing data valid.
4. **Settings in templates.** A new env key goes in both `*.example.env` files with a default
   in `env.ts` (see CI-CD.md section 2).
5. **Every release is tested on real data first.** Restore a recent shop backup into the demo
   or a scratch database on the developer PC and run the update there.
6. **Changelog.** The GitHub Release notes are generated from the PR titles, so give PRs
   clear titles ("Add GST on invoices", not "fix").
7. **Cross-version log.** `references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md`
   still records decisions. Inside this repo, "propagate to the next version" now means
   "merge into `main`" (and cherry-pick into `release/x.y` when that branch exists).
