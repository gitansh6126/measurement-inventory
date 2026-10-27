# V3.1 production readiness audit

**Date:** 2026-10-23 · **Scope:** `D:\client works\rs new\v3.1\` (target chosen by the owner) ·
**Mode:** read-only inspection plus baseline tests. No source code changed. The only file added
is the test config `app\api\vitest.integration.noreset.config.ts`.

No secrets appear in this report. Values from `.env` / `demo.env` were redacted when they were read.

---

## 1. System as found

| Area | Finding (evidence) |
|---|---|
| Layout | pnpm workspace `app\` = `shared` + `api` + `web` (`app\pnpm-workspace.yaml`, `.npmrc` `node-linker=hoisted`). Lockfile `app\pnpm-lock.yaml`. Node 24.12 installed; `engines.node >=22`. |
| API | Express 5.3 + Prisma 6.19 + zod, run directly from TypeScript with `tsx` (`api\package.json` `start: tsx src/server.ts`). 21 routers mounted in `api\src\app.ts`. |
| Web | Next.js 15.5 (App Router, all screens `"use client"`), React 19, TanStack Query, Tailwind 3. Same-origin `/api` rewrite to the API (`web\next.config.mjs`). |
| DB | PostgreSQL (local, port 5432), 37 checked-in migrations, `schema.prisma` 1,283 lines. The database enforces stock balances, document totals and line/movement agreement with triggers and checks. Tenant FKs are composite (`*_same_company_fkey`, migration 0024). |
| Hosting | **Local Windows PC**, `local-server\start.ps1` (API on 127.0.0.1, web on LAN). Optional Cloudflare quick tunnel in dev mode (`START-NETWORK-DEV.ps1`). Only `demo.env` exists: v3.1 has **no Client Ready config**. |
| Coolify / Docker | **Not applicable to v3.1.** There is no Dockerfile or Compose file. The hosted line is `standardapp\` (live) and `standardapp-v2\` (next release, built from v3.1). Coolify/VPS checks belong to those folders. |
| CI/CD | None. There is no `.github\`, lint config, Playwright or browser test in the repo. |
| Git | **All of `v3.1\` is untracked** (`git status`: `?? v3.1/...`). Branch `chore/pnpm-shared-store`. |

## 2. Baseline (actually run, 2026-10-23)

| Command (cwd) | Result |
|---|---|
| `npx tsc --noEmit` (`v3.1\app\api`) | exit 0 |
| `npx tsc --noEmit` (`v3.1\app\web`) | exit 0 |
| `npx vitest run tests/unit` (`v3.1\app\api`) | **133/133 passed**, 13 files |
| `npx prisma migrate status` against `rs_v31_test` | 37 migrations, "Database schema is up to date" |
| `npx vitest run --config vitest.integration.noreset.config.ts` (`v3.1\app\api`, `rs_v31_test`, no `migrate reset`) | **193/195 passed**, 2 failed, 22 files, 493 s |

The standard integration config runs `prisma migrate reset` on `rs_v31_test`, and the earlier
handoff records that this needs owner consent. The no-reset config skips only that step.

The two failures share one cause (H2 below):

- `backup.test.ts`: `GET /api/backup` returned 500 because Prisma reported "Can't reach database server" inside the export's `Promise.all` (`routes\backup.ts:217-224`).
- `grouped.test.ts` › backs up and restores…: the export failed the same way. The test then **restored the 500 error JSON, the server answered 200** and the company ended up with no products (evidence for H1).

The real API logs (`local-server\logs\demo-api-2026102*.err.log`) are empty, so no unhandled errors have occurred in actual use.

## 3. Strong controls already in place (verified in code)

- Passwords use bcrypt cost 12. Session tokens are 32 random bytes and stored HMAC-hashed. Cookies are HttpOnly with SameSite=Strict and get `Secure` on https. Sessions have a sliding idle expiry and a hard cap (`lib\auth.ts`).
- Login is rate limited per IP and per account, and an unknown email costs the same time as a wrong password. Reset codes are HMAC-hashed with a 15-minute TTL, at most 5 attempts and single use, and a reset revokes all sessions (`routes\auth.ts`).
- Every non-GET request is checked for same origin (`lib\middleware.ts`). Helmet protects the API; CSP, frame-deny and nosniff protect the web app.
- Environment isolation: DEMO and TEST refuse a database whose name lacks their tag. CLIENT_READY refuses demo/test names, plain http and an unsized pool (`env.ts`).
- Stock integrity: variations are locked `FOR UPDATE` in id order, so concurrent writers cannot deadlock (`lib\stock.ts:107`). Database triggers recheck balances. Writes run in transactions with a 20 s timeout (`db.ts WRITE_TX`).
- Idempotent retries: sales, purchases, orders and transfers take a `clientRef`, protected by a unique index, and a lost race returns the winner (`lib\documents.ts:163`). The cart creates `clientRef` once per cart (`CartContext.tsx:202`).
- Optimistic versions on orders, drafts and warehouses (`lib\versions.ts`). The last admin cannot be demoted, enforced with row locks (`routes\users.ts:66`).
- Errors use one shape `{error:{code,message,details,requestId}}`, and zod failures return 400 `VALIDATION` (`lib\errors.ts`). An `X-Request-Id` header is set on every response.
- Lists are paged with `pageSize` capped at 200 (documents, orders); parties are capped at 500.
- Graceful shutdown with a 10 s forced exit. `requestTimeout` is 30 s. `/api/health` and `/api/health/ready` exist (`server.ts`, `routes\system.ts`).

## 4. Findings

Severity: **Critical** = data loss or compromise likely now · **High** = data loss, outage or no recovery path ·
**Medium** = security weakness or automation blocker · **Low** = hygiene.

### H1 — High · Restore accepts any JSON and wipes the company's data

- **Files:** `app\api\src\routes\backup.ts:552-565` (restore JSON branch), compare with `:466-471` (inspect validates).
- **Defect:** for a non-ZIP body, restore does `inventoryData = json.data || json`. Any JSON object passes, for example `{"error":{...}}`. The transaction then deletes every company table and inserts nothing, and the response is 200. The ZIP branch also parses `inventory.json` without checking its shape.
- **Reproduction:** the baseline `grouped.test.ts` did exactly this, posting a 500 error body to `/api/backup/restore?confirm=true` and getting 200. By hand as an admin: `POST /api/backup/restore?confirm=true` with `Content-Type: application/json` and body `{}` or `{"x":1}`.
- **Mitigation today:** the Backup page calls `/inspect` first, and inspect rejects a wrong format. So the risk comes from API clients, scripts and automation agents, which are exactly what this work enables.
- **Also present in:** `v1`, `v2`, `v2.1`, `v3`, `standardapp` (**live SaaS**), `standardapp-v2` (same line in each `app\api\src\routes\backup.ts`).
- **Fix:** one `validateBackupPayload()` shared by inspect and restore. Require `format === "RS_INVENTORY_BACKUP"`, require `data` to be an object, and require each known table key to be an array when present. Reject with 400 `INVALID_FORMAT` before any delete.
- **Validation:** new regression tests show that restore of `{}`, an error JSON, and a ZIP with a malformed `inventory.json` each return 400 and leave the row counts unchanged.

### H2 — High · Backup export is not a consistent snapshot and fails intermittently

- **Files:** `routes\backup.ts:186-271`.
- **Defect:** the export runs about 30 `findMany` calls through two `Promise.all` batches on separate pooled connections, outside any transaction. (1) A sale saved during the export can land in some tables and not others, which gives an archive whose movements do not match the documents. Restore then fails with `BALANCE_DRIFT` or restores inconsistent data. (2) The burst of parallel connects failed twice in the baseline run with P1001, and the earlier handoff recorded the same "transient" failure.
- **Fix:** read everything inside one `prisma.$transaction(fn, { isolationLevel: RepeatableRead })` with sequential queries. That uses one connection and one snapshot.
- **Validation:** `backup.test.ts` and `grouped.test.ts` pass on repeated runs. A new test exports while a sale commits and checks that the archive restores without drift.

### H3 — High · v3.1 is not under version control

- **Evidence:** `git status --short -- v3.1` lists only `??` entries.
- **Impact:** no history, no diff review, no rollback. One wrong delete loses the whole line, including migrations 0030–0037 that `standardapp-v2` depends on.
- **Fix (needs owner approval):** commit `v3.1\` on a feature branch. `.gitignore` already excludes `node_modules`, `.next*`, `.env`, `logs`.

### H4 — High · No backups, restore drill or supervision for the v3.1 local server

- **Evidence:** `local-server\demo.env` defines `BACKUP_DIR`, `BACKUP_COPY_DIR`, `BACKUP_KEEP_DAYS`, but v3.1 has no `backup.ps1`, `restore-test.ps1`, `install-autostart.ps1` or `client.example.env`. All of these exist in `v2\local-server\`. `start.ps1:58-66` runs `prisma migrate deploy` on every start with no backup taken first. The processes are started with `Start-Process -WindowStyle Hidden` and nothing restarts them after a crash.
- **Fix:** port the v2 `backup.ps1` (pg_dump plus a storage copy with retention), `restore-test.ps1` and autostart scripts. Take a backup before `migrate deploy`. Add a client env example.
- **Validation:** run a backup, then restore it into a scratch database whose name includes `test`, and compare row counts.

### M1 — Medium · Password-reset codes are written to logs in every environment

- **Files:** `lib\password-reset-mailer.ts:7`, `routes\auth.ts:132-135`.
- **Defect:** when SMTP is missing or delivery fails, the 6-digit code and the email are logged at warn level. In a Client Ready deployment, anyone with access to the log can reset any account. `standardapp\` already fails closed with `EMAIL_NOT_CONFIGURED`.
- **Fix:** log the code only when `APP_ENV` is DEMO or TEST. In CLIENT_READY, return 503 `EMAIL_NOT_CONFIGURED` and log no code.
- **Validation:** a unit or integration test asserts that no `code` field is logged in CLIENT_READY.

### M2 — Medium · Submitting the login form before hydration puts the password in the URL

- **File:** `app\web\app\login\page.tsx`. `<form onSubmit>` has no `method`, so the default is GET.
- **Reproduction:** a slow load or automation that types and submits before React hydrates causes a native `GET /login?email=…&password=…`. The password then sits in browser history, dev-server logs and the tunnel logs.
- **Fix:** add `method="post"` and disable the submit button until the page is mounted.

### M3 — Medium · Shared Modal and Alert are not exposed to assistive tech or automation

- **Files:** `components\ui.tsx:105` (`Alert`), `:111` (`Modal`).
- **Defect:** Modal has no `role="dialog"`, no `aria-modal`, and no `aria-labelledby` pointing at its title. It does not move focus in, trap focus or restore focus. Alert has no `role="alert"` or `role="status"`. The drawers (`ProductDrawer`, `StockEditDrawer`, `CartSidebar`…) already do this correctly, so the screens are inconsistent.
- **Impact:** Playwright `getByRole('dialog', { name })` and AI agents cannot target modals or detect error and success messages reliably. Keyboard users lose focus.
- **Fix:** add the roles, `useId` for the title, initial focus and focus restore, and `type="button"` on the close button. Give Alert `role="alert"` for errors and `role="status"` for success.

### M4 — Medium · Expired sessions are not handled after the first page load

- **Files:** `app\web\lib\api.ts`; only `app\(app)\layout.tsx:83` redirects on 401.
- **Defect:** when a session expires mid-use (5 idle days, or revoked by an admin), every later screen shows "Please sign in" inline and never redirects. The cart and screens stay visible.
- **Fix:** handle 401 centrally in `api()`: clear the query cache and go to `/login?next=<path>`. Exclude `/auth/login` and `/auth/me`.

### M5 — Medium · Failed browser actions cannot be traced

- **Evidence:** `lib\logger.ts` is used only for startup and unhandled errors. There is no per-request log. `requestId` is returned in error bodies but `ApiError` (`web\lib\api.ts`) drops it, so no screen shows it.
- **Fix:** log one line per request when it finishes (`method`, route, `status`, `ms`, `requestId`, `userId`, `companyId`, no bodies). Keep `requestId` on `ApiError` and show it on error alerts as `data-request-id` plus small text such as "Ref: …".

### M6 — Medium · `/api` rewrite fails open, contradicting its own comment

- **File:** `app\web\next.config.mjs:7-13`. The comment says production builds get no rewrite unless `API_INTERNAL_URL` is set (audit B03). The code defaults to `http://127.0.0.1:4000`, so the rewrite is always present.
- **Impact:** a build made without `API_INTERNAL_URL` silently talks to whatever API listens on 4000. That is the v1 dev port, and another copy's API could be on it.
- **Fix:** in production, add the rewrite only when `API_INTERNAL_URL` is set, as the comment states. `start.ps1` already sets it.

### M7 — Medium · No CI, lint or browser tests

- **Evidence:** there is no `.github\`, no ESLint config and no Playwright install (`%LOCALAPPDATA%\ms-playwright` is absent). The integration suite needs a local Postgres and takes about 8 minutes.
- **Fix:** add a Playwright project under `v3.1\app\e2e\` that runs against a dedicated `rs_v31_e2e` database (the name must contain "test" or "demo"; the database must be created by the PostgreSQL admin), seeded with the demo seed. Add CI later, once the repo is tracked (H3).

### L1 — Low · Unique-constraint races return 500

- `lib\errors.ts` has no generic mapping from Prisma `P2002` to 409. Example: `routes\users.ts:39-42` checks the email and then inserts, so two simultaneous creates give one 201 and one 500. Fix: map `P2002` to 409 `CONFLICT` in `errorHandler`.

### L2 — Low · Rate limits and request body sizes

- Only auth routes are rate limited, using an in-memory store. That is acceptable for one process on a LAN, but not once the app is exposed by the tunnel.
- Restore buffers up to 100 MB in memory, and import up to 5 MB. Document these limits. Add a general per-session write limit if the app is ever exposed beyond the LAN.

### L3 — Low · Backup archives contain password hashes

- The export includes `users.passwordHash` (`routes\backup.ts:233`). Treat archives as secrets: keep them in a restricted folder and never share them. Document this on the Backup page and in the ops README.

### L4 — Low · Product create has no idempotency key

- Double submit is prevented only by React `disabled={saving}` (`ProductForm.tsx:547`). Duplicate names are rejected by the unique index, which returns 409, so the impact is a confusing error rather than duplicate data.

### L5 — Low · Mixed package managers

- The root `package.json` scripts use npm workspaces (`npm run … -w api`) on a pnpm-hoisted install. npm warns `Unknown project config "node-linker"` on every run. Use `pnpm install --frozen-lockfile` (pnpm 9.15.4 present) and `pnpm -r run typecheck`.

### L6 — Low · Dev-mode internet tunnel

- `START-NETWORK-DEV.ps1` exposes **dev mode** (`next dev`, `tsx watch`, CSP with `unsafe-eval`) on a public `trycloudflare.com` URL. In DEMO the login page offers one-click demo admin sign-in, so anyone with the link is an admin of the demo data. This is acceptable only for demos. Never run it with `-Env client`; the script allows that.

## 5. Browser-automation readiness summary

| Check | Status |
|---|---|
| Labelled inputs (login, `Field` wraps with `<label>`) | Good |
| Buttons have visible text or `aria-label` (170 `aria-label`s) | Good |
| Nav uses `<nav aria-label="Main">` and `aria-current="page"` | Good |
| Drawers have `role="dialog"`, `aria-modal`, `aria-label` | Good |
| Shared `Modal` dialog semantics, focus management | **Missing** (M3) |
| Error and success messages announced (`role=alert/status`) | Login only; shared `Alert` **missing** (M3) |
| Loading states | Text "Loading…" / skeletons, no `aria-busy` |
| Duplicate-submit protection | Server-side idempotency for documents; UI `disabled` elsewhere |
| Session expiry visible and recoverable | **Partial** (M4) |
| Request correlation visible to the agent | **Missing** (M5) |
| `data-testid` | None. Role- and label-based selectors are preferred; add test ids only where roles are ambiguous (table rows, cart lines). |

## 6. Prioritized implementation plan (awaiting approval)

Small, separate changes. Each one gets regression tests and a propagation-register entry.

| # | Change | Risk | Needs approval for |
|---|---|---|---|
| 1 | H1 restore validation, with regression tests | Low (rejects bad input only) | none beyond go-ahead; propagation to `standardapp` (live) is a separate deploy decision |
| 2 | H2 snapshot export in a REPEATABLE READ transaction | Low–medium (export path only) | — |
| 3 | M1 no reset codes in CLIENT_READY logs | Low | — |
| 4 | M2 login `method="post"`, M3 Modal/Alert roles and focus, M4 central 401, M5 `requestId` on errors and access log | Low (additive, no visual change) | — |
| 5 | M6 rewrite fails closed in production | Low | — |
| 6 | L1 map P2002 → 409 | Low | — |
| 7 | Playwright suite (`app\e2e\`): login/logout/session, invalid login and 401, product create/edit/refresh, categories and variations, Stock In, sale cart and checkout, validation and double submit, network/500 recovery (`page.route`), RBAC and cross-company isolation | None to data (own database) | **Creating `rs_v31_e2e`** (PostgreSQL admin) and installing Playwright + Chromium (~150 MB download) |
| 8 | H4 port backup, restore-test, autostart and pre-migration backup scripts from v2 | Medium (ops scripts) | running a restore drill |
| 9 | H3 commit `v3.1\` | — | **owner decision** |
| 10 | `BROWSER_AUTOMATION_GUIDE.md`, `DEPLOYMENT_AND_ROLLBACK.md` (local-server run, update, backup, rollback = restore the pre-migration dump; Prisma has no down migrations) | None | — |

Out of scope for v3.1 (record in the propagation register): Coolify, Docker, HTTPS and firewall
verification belong to `standardapp\` / `standardapp-v2\`. H1, H2 and M1 should be ported there.
For the live `standardapp`, H1 is the most urgent item.

## 7. Implementation status (2026-10-23, plan items 1–6)

The owner approved items 1–6. Playwright and the E2E database (item 7), backups and supervision
(item 8, H4) and the git commit (item 9, H3) are **on hold**.

| Finding | Status | Change (all under `D:\client works\rs new\v3.1\app\`) |
|---|---|---|
| H1 | **Fixed** | `api\src\routes\backup.ts`: `validateInventoryData()`, `readZipBackup()`, `readJsonBackup()`. Inspect and restore share them and run them before any image file is written or row deleted. A JSON body must be `{format:"RS_INVENTORY_BACKUP", data}`; ZIPs need manifest format `RS_INVENTORY_ZIP_BACKUP`; every required table must be a list. Errors: 400 `INVALID_FORMAT` / `INVALID_METADATA` / `INVALID_JSON`. |
| H2 | **Fixed** | `routes\backup.ts` `GET /`: all reads in one `$transaction` with `RepeatableRead` (timeout 120 s), so one connection and one snapshot. |
| M1 | **Fixed** | `lib\password-reset-mailer.ts` logs the code only in DEMO/TEST and throws otherwise. `routes\auth.ts`: CLIENT_READY without SMTP → 503 `EMAIL_NOT_CONFIGURED` before the user lookup; on SMTP failure the code is not logged in CLIENT_READY. |
| M2 | **Fixed** | `web\app\login\page.tsx`: `method="post"`, submit disabled until hydrated, `aria-busy`, `?next=` return path (same-origin only), "session has ended" notice. |
| M3 | **Fixed** | `web\components\ui.tsx`: `Modal` has `role="dialog"`, `aria-modal`, `aria-labelledby` (title), focus goes to the first form field (never a button), Tab is trapped, focus returns to the opener, close button is `type="button"`. `Alert` has `role="alert"` (error) / `role="status"` (success). |
| M4 | **Fixed** | `web\lib\api.ts` `setUnauthorizedListener` + `web\lib\useApi.ts`: any 401 from a signed-in screen clears the query cache and goes to `/login?expired=1&next=<path>`. Not covered: screens that call `fetch` directly (Backup upload, Import file read). |
| M5 | **Fixed** | `api\src\lib\middleware.ts` `accessLog` (mounted in `app.ts`) writes one JSON line per request: `requestId, method, path` (no query), `status, ms, userId, companyId`. Health probes are skipped. `ApiError.requestId`; `errorText()` adds `(ref xxxxxxxx)` to 5xx messages only. |
| M6 | **Fixed** | `web\next.config.mjs`: the `127.0.0.1:4000` default applies in dev only. `local-server\build.ps1` / `start.ps1` already set `API_INTERNAL_URL`. A bare `next build` now has no `/api` route, so it fails closed. |
| L1 | **Fixed** | `api\src\lib\errors.ts`: Prisma `P2002` → 409 `CONFLICT`. |

### Tests added

- `api\tests\integration\hardening.test.ts` (6 tests):
  - H1: bad JSON, error body, unwrapped data, wrong tag, non-list table, bad ZIP JSON, foreign manifest and missing tables all return 400 on restore and inspect, and the company's row counts stay unchanged. A genuine JSON backup still restores.
  - H2: two exports run alongside 6 concurrent sales; both archives restore and balance = opening − sales.
  - L1: concurrent user creates return 201 and 409.
  - M1: CLIENT_READY returns 503 for known and unknown emails, and no code is logged or stored.
  - M5: an access-log line carries the client's `X-Request-Id`, with no query text.
- `api\tests\unit\password-reset-mailer.test.ts` (2 tests, M1).

### Checks run

| Command (cwd) | Result |
|---|---|
| `npx tsc --noEmit` (`app\api`), (`app\web`) | both exit 0 |
| `npx vitest run tests/unit` (`app\api`) | 135/135 (15 files) |
| `npx vitest run --config vitest.integration.noreset.config.ts tests/integration/hardening.test.ts` | 6/6 |
| `npx vitest run --config vitest.integration.noreset.config.ts` (`app\api`, `rs_v31_test`) | **205/205 passed**, 24 files. This includes `backup.test.ts` and `grouped.test.ts`, which failed in the baseline (H2), and the peer session's new `variation-categories.test.ts`. |
| Browser, `http://localhost:3515` (peer session's v3.1 dev pair, demo DB) | Login form `method=post`, hydrated. Users › Add User: `role=dialog`, `aria-modal=true`, labelled "Add User", focus on Name, Shift+Tab stays inside, Escape closes and focus returns to "Add User". Session revoked with a raw `POST /api/auth/logout`, then Customers link → `/login?expired=1&next=%2Fcustomers` with the notice; Admin sign-in → `/customers`. The only console error is that expected 401. |

### Handoff: next steps

1. **Port H1, H2, M1, L1 to `standardapp-v2\` and `standardapp\`.** `standardapp` is live and needs a separate deploy approval. Use the same `backup.ts` / `errors.ts` hunks and the `hardening.test.ts` cases. `standardapp` already has M1.
2. Item 7: Playwright suite. Needs `rs_v31_e2e` created by the PostgreSQL admin, plus a Playwright + Chromium install.
3. Item 8 (H4): port `v2\local-server\backup.ps1`, `restore-test.ps1`, `install-autostart.ps1`; take a backup before `migrate deploy`.
4. Item 9 (H3): the owner decides on committing `v3.1\`.
5. Write `BROWSER_AUTOMATION_GUIDE.md` and `DEPLOYMENT_AND_ROLLBACK.md` (item 10).
6. Optional: route the direct `fetch` calls (Backup, Import) through `api()` so they get M4/M5 too.
