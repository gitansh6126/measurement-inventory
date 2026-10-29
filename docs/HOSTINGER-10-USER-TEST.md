# Hostinger hosting + 10-user live test (plan, 2026-10-29)

Objective: put RS Inventory (Demo Company data) on Hostinger and have 10 people use it at the
same time, by hand, to see whether it stays fast and correct.

## 1. Can it run on Hostinger *web hosting* (Premium / Business)?

Not as the app is built today.

| App needs | Hostinger web hosting gives |
|---|---|
| PostgreSQL 16 (Prisma schema `provider = "postgresql"`, raw SQL in `app\api\src\lib\inventory-query.ts`, `catalog.ts`) | MySQL / MariaDB only. No PostgreSQL. |
| Two Node 22 processes: Next.js web (`app\web`, port 3000) + Express API (`app\api`, port 4000); web proxies `/api` via `API_INTERNAL_URL` (`app\web\next.config.mjs`) | Node.js web apps on **Business and higher** only (not Premium); one app per deployment, managed start command. |
| Persistent disk for product images (`STORAGE_ROOT`) and backups | Files can be lost on redeploy unless kept outside the app folder. |

Premium cannot run Node.js at all. Business could only run it with code changes plus an
outside PostgreSQL (Supabase / Neon, Mumbai or Singapore region) — more work, more moving parts,
and not how the shop build is tested.

## 2. Recommendation: Hostinger VPS (KVM 2)

- KVM 2 (2 vCPU, 8 GB RAM, Ubuntu 24.04, India / nearest region). KVM 1 (4 GB) also works for
  10 users but leaves little room for builds. Hostinger lets you upgrade the existing plan or
  buy a VPS alongside it; the domain can stay on the web-hosting plan (point a subdomain such
  as `inventory.<your-domain>` to the VPS IP with an A record).
- Same method already used for `D:\client works\rs new\standardapp\` (Docker Compose: postgres,
  api, web, reverse proxy with HTTPS). Re-use that pattern for `measurement-inventory\`:
  `Dockerfile.api`, `Dockerfile.web`, `docker-compose.yml`, Caddy for automatic HTTPS.
- Env for this test: `APP_ENV=DEMO`, `DEMO_RESET_ENABLED=true`, `PUBLIC_APP_URL=https://inventory.<domain>`,
  `ALLOW_INSECURE_HTTP=false`, `TRUST_PROXY=true`, `connection_limit=10` in `DATABASE_URL`
  (local demo uses 3, too low for 10 people), new random `SESSION_SECRET` and DB password.
- Never put real shop data on this server for the test. Demo Company only; reset after.

## 3. Deploy steps (VPS)

1. Buy/upgrade to VPS, choose Ubuntu 24.04 with Docker template, set a root SSH key.
2. DNS: A record `inventory` → VPS IP.
3. Firewall: allow 22, 80, 443 only.
4. Copy the release (git clone of the tag, no `node_modules`, no `.env`) to `/opt/rs-inventory`.
5. Create `/opt/rs-inventory/.env` from the env above.
6. `docker compose up -d --build`; the API runs `prisma migrate deploy` on start.
7. Seed: `docker compose exec api npm run demo:reset` (Demo database only).
8. Checks: `https://inventory.<domain>/api/health/ready` returns ok; sign in; open Products,
   Inventory, a Sale PDF; upload one image.

## 4. The 10-person test

**Accounts.** Make 10 separate users (do not share one login): sign-in is limited to 10 tries
per account and 50 per IP address per 15 minutes (`app\api\src\routes\auth.ts`). 10 people in
one office share one IP, which is fine for normal sign-ins.

Suggested mix: 2 admin, 3 sales_manager, 5 sales_staff.

**Before the people (developer, 10 min).** A scripted check with 10 virtual users reading
Products/Inventory for 5 minutes, to catch obvious slowness before wasting people's time.

**Session: 45 minutes, everyone at once.**

| Minutes | Everyone does |
|---|---|
| 0–5 | Sign in on own phone/PC; open Products, Inventory, search a product |
| 5–20 | Each makes 3 sales (mix of counted and measured items) and 1 purchase |
| 20–30 | Persons 1–5 sell the **same** product at the same moment (stock race); persons 6–10 open reports / PDFs / print |
| 30–40 | Backorder: sale with more than stock → arrange purchase → receive → complete |
| 40–45 | Admins: export backup; everyone signs out |

**Each person notes:** any page taking more than 3 seconds, any error message (screenshot),
any wrong stock number.

**Pass if:** no errors; pages under 3 s on mobile data; stock after the race is exactly
start − sold (no negative stock, no double sale); every sale/purchase appears for everyone;
VPS CPU stays under 80 % and RAM under 75 % (`docker stats` during the test).

**After:** collect notes + `docker compose logs api > test-logs.txt`, then reset the Demo.

## 5. Owner decision (2026-10-29): stay on Hostinger Business web hosting

Sections 2–3 (VPS) are kept for reference only. The test runs on the Business plan as below.
Section 4 (the 10-person test) is unchanged, except the "VPS CPU/RAM" check becomes the
Hostinger hPanel resource graph for the Node.js app.

## 6. Business-plan setup

### 6.1 Database: Neon PostgreSQL (outside Hostinger)

- Free Neon project, region nearest India (AWS Singapore). PostgreSQL 16.
- Create a database named **`rs_inventory_demo`**. The name must contain `demo`:
  `app\api\src\env.ts` refuses `APP_ENV=DEMO` on any other name. (Supabase is a poor fit here:
  its pooler only reaches the default `postgres` database, which this check rejects.)
- Use Neon's **direct** (non-pooled) connection string, not the `-pooler` one. Sales,
  purchases, sets and transfers lock stock rows inside transactions (`FOR UPDATE` in
  `app\api\src\lib\documents.ts`, `stock.ts`, `sets.ts`, `orders.ts`, `warehouses.ts`); a direct
  connection keeps that behaviour exactly as in the shop.
  `DATABASE_URL=postgresql://<user>:<pass>@<host>.neon.tech/rs_inventory_demo?sslmode=require&connection_limit=5&pool_timeout=10`
- Neon free compute sleeps after ~5 min idle; the first request after that waits about 1 s.
  Open the app a minute before the test starts.
- From the dev laptop (not Hostinger): `npm run db:migrate -w api` with that `DATABASE_URL`,
  then the owner runs the Demo seed against it (`npm run demo:reset -w api`). Agents do not run
  the reset themselves (AGENTS.md rule).

### 6.2 Code change: one process instead of two

Hostinger runs one Node.js app with one port (`PORT` given by Hostinger). Today the app is two
processes (Next.js web + Express API joined by a reverse proxy). Add a small hosted entry point;
nothing in the existing routes or screens changes, and the shop build is untouched.

1. `app\hosting\server.ts` (new): reads env with `getEnv()`, runs `bootstrapAdmin`, builds the
   API with `createApp(env)` (`app\api\src\app.ts`), prepares Next.js with
   `next({ dev: false, dir: "../web" })`, then one HTTP server on `process.env.PORT`:
   paths starting `/api` → the Express API, everything else → Next's request handler.
   Same-origin, so cookies, `sameOrigin()` checks and CSP work unchanged; no
   `API_INTERNAL_URL` rewrite needed. Copies the graceful shutdown from `app\api\src\server.ts`.
2. `app\hosting\start.mjs` (new): Hostinger's entry file. Registers `tsx` and imports
   `server.ts` (the API already runs through `tsx` in production: `"start": "tsx src/server.ts"`).
3. `app\package.json`: add `"hosting"` to `workspaces`, and scripts
   `"build:hosting": "npm run build -w web"` and `"start:hosting": "node hosting/start.mjs"`.
4. Env on Hostinger (hPanel → Node.js app → Environment variables, never in git):
   `APP_ENV=DEMO`, `DEMO_RESET_ENABLED=true`, `RELEASE_VERSION`, `DEPLOYED_AT`,
   `DATABASE_URL` (above), new 48-character `SESSION_SECRET`,
   `PUBLIC_APP_URL=https://inventory.<domain>`, `TRUST_PROXY=true` (Hostinger's proxy sits in
   front; needed for correct per-IP sign-in limits), `STORAGE_ROOT=/home/<hostinger-user>/rs-storage`
   (outside the app folder so images survive redeploys), `NODE_ENV=production`.
5. Unit tests for the path split (`/api/...` → API, `/`, `/_next/...` → Next) and a local run
   of `start:hosting` against a local `*_demo` database before uploading.

### 6.2a Local check (2026-10-29, worktree of `hosting/hostinger-business`)

- `pnpm install --frozen-lockfile`, `next build` (default `.next`, no `API_INTERNAL_URL`): passed.
- `node --env-file=<demo env, PORT=3610> hosting/start.mjs` against local `rs_v31_demo`:
  `/api/health`, `/api/health/ready`, `/api/version` 200; unknown `/api/nope` gets the API's JSON
  404; `/login` served by Next; Demo Admin sign-in (POST passes the same-origin check, cookie
  set), Products page loads with demo data.
- First run found a bug: under tsx, `next`'s default import is `createServer` itself, not
  `.default`. Fixed in `app\hosting\server.ts` (accepts both).
- 10 parallel clients × 20 requests (Stock In list, categories, warehouses, me, login page):
  200 requests, 0 errors, median 31 ms, p95 1.07 s, max 1.38 s with `connection_limit=3`.
  The slow ones are Stock In list queries waiting for a DB connection; use `connection_limit=5`
  on Hostinger (Neon free allows it).

### 6.3 Hostinger steps

1. hPanel → Websites → Add website → **Node.js app**; Node 22; subdomain `inventory.<domain>`.
2. Deploy from GitHub (`gitansh6126/measurement-inventory`, branch for this work) or ZIP upload of
   `app\` without `node_modules`, `.next`, `.env`. Root directory `app`.
   Install: `npm install` (runs `prisma generate` for Hostinger's Linux). Build:
   `npm run build:hosting`. Entry file: `hosting/start.mjs`.
3. If the Next.js build runs out of memory on Hostinger: build on the dev laptop and upload the
   ZIP with `web\.next` included, and set the build command to nothing.
4. Add the env variables (6.2 step 4), turn on SSL for the subdomain, start the app.
5. Checks: `https://inventory.<domain>/api/health/ready`; sign in as each of the 10 test users;
   open a Sale PDF; upload one image, redeploy, image still there.

### 6.4 Known limits on this route

- Hostinger shared plans cap CPU/RAM/processes per account; 10 people is a small load, but if
  hPanel shows the app hitting its limit, that is the answer to "is Business enough".
- The test measures Hostinger + Neon (two networks), not the shop PC setup.
- Backups/restore through the app write to `STORAGE_ROOT`'s disk; Neon keeps its own history.
- Demo data only. Real shop data needs a separate decision (privacy, backups, paid DB plan).
