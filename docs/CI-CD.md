# Env files, databases and the GitHub CI/CD pipeline

This is how code, settings and data are kept apart, and how a change on the developer PC
reaches the shop PC.

## 1. The rule: three things, three places

| Thing | What is in it | Where it lives | In git / GitHub? |
|---|---|---|---|
| **Code** | `app\` (API, web, shared), Prisma schema + migrations, `local-server\` scripts, docs | This repository | **Yes** (public) |
| **Settings + secrets** | `client.env`, `demo.env`: database password, session secret, ports, SMTP, backup folders | Shop PC: `C:\RS-Inventory-Data\` · developer PC: `<repo>-Data\` | **Never** |
| **Data** | PostgreSQL databases, product images, backups, logs | Shop PC: local PostgreSQL + `C:\RS-Inventory-Data\` | **Never** |

**Why:** a public repository can be read by anyone, so nothing in it may be secret. And the
update (`git checkout <tag>`) replaces the program folder. Data kept outside that folder can't
be lost or overwritten by an update.

How this is enforced:
1. **The data folder is outside the repo.** `local-server\common.ps1` sets
   `$DataRoot = $env:RS_DATA_ROOT` or `<repo folder>-Data`. Every script takes the env files, logs,
   run state, backups and images from there.
2. **`.gitignore`** blocks `.env`, `*.env`, `.env.*`, `node_modules`, `.next*`, `dist`, storage,
   backups, logs, dumps and zips, even if someone creates them inside the repo by mistake.
3. **The CI `guard` job** fails the pipeline if any of those files is tracked, or if an
   example env file has a real password in it. So a mistake can't become a release.

## 2. Env files

| File | In git? | Used by | Made by |
|---|---|---|---|
| `local-server\client.example.env` | yes (template) | `setup.ps1` | developer |
| `local-server\demo.example.env` | yes (template) | `setup.ps1` | developer |
| `<DataRoot>\client.env` | **no** | real company: API (`node --env-file`), all scripts | `setup.ps1` (random secrets) |
| `<DataRoot>\demo.env` | **no** | demo company | `setup.ps1` |
| `app\api\.env.example` | yes (template) | developer running `pnpm dev` by hand | developer |
| `app\api\.env` | **no** | developer only | developer |
| CI values | not a file | CI test database URL, written in `ci.yml` (throwaway, not secret) | `ci.yml` |

**What setup writes.** It copies the template and replaces every `CHANGE_ME...` with a value:
- `DATABASE_URL`: random 24-byte password.
- `SESSION_SECRET`: random 32-byte value.
- `STORAGE_ROOT` and `BACKUP_DIR`: absolute paths in the data folder.
- `DEPLOYED_AT`: the install time.

`common.ps1` refuses to start while any `CHANGE_ME` is left. Running setup again keeps an
existing env file and only re-syncs the database role's password to it.

**Adding a new setting in a release** (for example `NEW_FEATURE_X`):
1. Add it to both `*.example.env` templates with a comment and a safe default.
2. Give it a default in the zod schema in `app\api\src\env.ts`. Existing shops don't have the
   line, so the app must work without it.
3. If the shop must set it by hand, say so in the release notes and in `README.md`.

**Never** add a value that's needed at build time or is secret to `ci.yml` or to the
repository. If a hosted build ever needs a secret, use GitHub *Settings -> Secrets and
variables -> Actions*. It's never needed for the shop line.

**The version shown in the app** comes from the `VERSION` file: `start.ps1` exports
`RELEASE_VERSION` from it, and `node --env-file` does not override a variable that is already
set. `RELEASE_VERSION` in the env files is only a fallback.

## 3. Databases

PostgreSQL 18 on the shop PC (port 5432). Each company has its own role and database:

| Database | Role | What | Created by |
|---|---|---|---|
| `rs_v31_client` | `rs_v31_client` | **real company** (CLIENT_READY) | `setup.ps1` |
| `rs_v31_client_restore` | `rs_v31_client` | scratch DB for the weekly restore test (wiped each run) | `setup.ps1` |
| `rs_v31_demo_local` | `rs_v31_demo_local` | demo company (DEMO, can be reset) | `setup.ps1` |
| `rs_v31_demo` / `rs_v31_test` | `rs_v3` | developer PC only (`app\api\scripts\setup-v31-db.sql`) | developer |
| `rs_v31_test` (CI) | `rs_ci` | GitHub Actions service container, deleted after each run | `ci.yml` |

- The names keep `v31` for good: they are internal identifiers. **Do not rename them in a new
  version.** Updates change the database *in place* with migrations.
- Safety guards in `app\api\src\env.ts`: CLIENT_READY refuses a database whose name contains
  `demo` or `test`, and DEMO / TEST require their own word in the name.
- Roles have `NOSUPERUSER NOCREATEDB NOCREATEROLE`, and each database is `REVOKE ALL ... FROM PUBLIC`.

**Schema and migrations.** The schema is in `app\api\prisma\schema.prisma` (40 models: company,
users, products / variations, stock, warehouses, sales, purchases, orders, measured pieces,
sets ...). Every change is a numbered folder in `app\api\prisma\migrations\` (`0001_...` to `0038_...`
for 3.1.0).
- **Forward only.** Never edit or delete a migration that has been released; add a new one.
  Prisma has no down-migrations, so a rollback restores the backup (`update.ps1` does this
  by itself).
- `prisma migrate deploy` runs on every build and start (`build.ps1`, `start.ps1`), so the shop
  DB always matches the code. CI runs `migrate reset` on an empty database, which proves that
  every migration applies from zero.
- Write migrations that keep existing rows valid: add nullable columns or columns with
  defaults, and backfill in the same migration.

**Backups.**

| Kind | Made by | Contents | Restored by |
|---|---|---|---|
| Nightly (20:45) + before every update | `backup.ps1` | `pg_dump` custom format + `storage.zip` + `migration.txt` + `SHA256SUMS`, in `BACKUP_DIR` and `BACKUP_COPY_DIR` | `update.ps1` rollback, `restore-test.ps1` (weekly check into the scratch DB) |
| In-app ZIP | Backup & Restore page | one company as JSON + images (format 2.0) | Backup & Restore -> Restore |

## 4. The pipeline

```
 developer PC                      GitHub (public repo)                     shop PC
 ------------                      --------------------                     -------
 feature branch --push--> PR --> CI: guard + test ----merge--> main
                                                                   |
 VERSION=3.1.1, commit, tag v3.1.1 --push--> CI: guard + test + release
                                                   |  (GitHub Release v3.1.1)
                                                   v
                                    UPDATE.bat (desktop "Update")
                                      git fetch --tags
                                      newest tag vX.Y.Z  -> show changes -> Y
                                      stop -> backup (db + images)
                                      git checkout vX.Y.Z
                                      pnpm install --frozen-lockfile
                                      prisma migrate deploy + next build
                                      start -> health check (/api/version)
                                      failure => previous tag + restore DB + start
```

The `.github\workflows\ci.yml` jobs:

| Job | Runs on | Does | Why |
|---|---|---|---|
| `guard` | every push / PR / tag | fails if env files, secrets, dumps, node_modules or builds are tracked, or if an example env has a real password | public repo: a leak must never become a release |
| `test` | after guard | `pnpm install --frozen-lockfile`, typecheck, unit tests, integration tests on a throwaway PostgreSQL 18, `next build` | the shop gets only code that builds and passes tests |
| `release` | tag `v*` only, after test | checks that `VERSION` equals the tag, then creates the GitHub Release with notes | a release exists only for a commit that passed everything |

**Why the shop pulls instead of GitHub pushing.** The shop PC has no public address, and
opening one would be a security risk. So the PC asks GitHub for new tags only when someone
clicks Update. No token is needed because the repo is public. No self-hosted runner is
needed either, because one would let any workflow run code on the shop PC.

**Why tags, not `main`.** `main` can hold half-finished work between releases. A tag is a
fixed, tested point. `update.ps1` takes only `vX.Y.Z` tags (no `-rc` / `-beta`) unless one
is asked for with `-Tag`.

## 5. Making a release (developer)

```
git checkout main && git pull
# set VERSION to 3.1.1 (and RELEASE_VERSION in the two *.example.env)
git commit -am "Release 3.1.1"
git tag v3.1.1
git push origin main v3.1.1
```

Wait for the green **release** job on GitHub, then tell the shop to click **Update**.
Test a release candidate on your own PC first: `UPDATE.bat -Tag v3.1.1-rc1`.

## 6. GitHub settings to do once (owner)

1. Settings -> Actions -> General: allow actions. Workflow permissions: read (the release job
   asks for write itself).
2. Settings -> Branches: protect `main`, and require the **guard** and **test** checks before
   merging.
3. Settings -> Tags (rulesets): protect `v*` so that only you can create or delete release tags.
4. Settings -> Code security: turn on **Secret scanning** and **Push protection** (free for
   public repos).
