# Developer setup: run and test RS Inventory on demo data

For a developer who gets this repository from GitHub and wants to run the app, test it, and show
it working with the Demo company. Works on Windows, macOS and Linux. (The shop-PC install is a
different thing, see [README.md](README.md).)

## What you need

| Tool | Version | Check |
|---|---|---|
| Git | any | `git --version` |
| Node.js | 22 or newer | `node -v` |
| pnpm | 9.15.4 | `pnpm -v` (install: `npm install -g pnpm@9.15.4`) |
| Docker Desktop | running | `docker info` |

No Docker? Use your own PostgreSQL 16+ instead, see [Without Docker](#without-docker).

## 1. Get the code

```bash
git clone -b changes-2026-10-29 https://github.com/gitansh6126/measurement-inventory.git
```

```bash
cd measurement-inventory/app
```

## 2. One-time setup (about 3-5 minutes)

```bash
npm run dev:setup
```

It does, in order (safe to run again):

1. creates `app/api/.env` from `app/api/.env.example` with a random session secret
   (git-ignored, never commit it);
2. starts PostgreSQL 18 in Docker on port **5433** (`docker-compose.dev.yml`) with two databases:
   `rs_v31_demo` (the Demo company) and `rs_v31_test` (integration tests);
3. installs packages (`pnpm install --frozen-lockfile`);
4. applies all database migrations;
5. fills the **Demo company** with sample data.

## 3. Start the app

```bash
npm run dev
```

Open **http://localhost:3000**. API runs on port 4000 (the web app forwards `/api` to it).
Code changes reload by themselves. `Ctrl+C` stops both.

### Demo sign-in

The login page has quick buttons for the demo users. Or type them (password for all:
`demo-rs-2026`, from `app/shared/src/index.ts`):

| Role | Email | Can |
|---|---|---|
| Admin | `admin@demo.rs.test` | everything (settings, users, backup, demo data) |
| Sales Manager | `manager@demo.rs.test` | sales, purchases, orders, prices |
| Sales Staff | `staff@demo.rs.test` | sales screens only |

### What the demo data covers (good walk-through order)

1. **Products**: simple, variable (2-attribute matrix with quality stars), measured (reel / drum in
   metres, reel in feet-inches), categories and category heads (Industry, Material).
2. **Inventory**: In Stock / Low / Out / Inactive, rolls and pieces (closed, open, cut offcut,
   used-up scrap) with history, two warehouses (Main Godown, Shop) and a stock shift.
3. **Sales / Purchases**: counted sale, measured cut sale, walk-in cash sale, cancelled sale,
   split purchase across warehouses, held carts (drafts).
4. **Orders**: placed / on-delivery sale orders, a measured shortage with its linked purchase
   order, a draft PO.
5. **Parties**: customers (credit score), suppliers, both; **Supplier rates** with price history.
6. **Sets**: standard and custom sets in a sale.

Full list: the header of `app/api/scripts/seed-demo.ts`.

### Start the demo again from zero

```bash
npm run demo:reset
```

Wipes the demo database and seeds it again. (Admins can also do this in the app: **Demo data**.)

## 4. Tests

Run from `app/`:

| Command | What |
|---|---|
| `npm run typecheck` | TypeScript check, API + web |
| `npm test` | unit tests (no database) |
| `npm run test:integration` | API tests on `rs_v31_test` (that database is wiped each run; the demo is not touched) |
| `cd web && npx next build` | production build of the web app |

GitHub runs the same steps on every pull request (`.github/workflows/ci.yml`).

## 5. Production-like run (optional)

To see it as the shop runs it (built, not hot reload):

```bash
cd web && npx next build && npx next start -p 3000
```

and in a second terminal `cd api && pnpm start`.

## Without Docker

1. Create a role and two databases (as the `postgres` superuser):
   ```bash
   psql -U postgres -h 127.0.0.1 -f api/scripts/setup-local-db.sql
   ```
   It asks for a new password for the `rs_v3` role.
2. Run `npm run dev:setup -- --no-docker` once: it creates `api/.env` and stops.
3. In `api/.env` replace `CHANGE_ME` in `DATABASE_URL` and `TEST_DATABASE_URL` with that password
   (port 5432).
4. Run `npm run dev:setup -- --no-docker` again, then `npm run dev`.

## Problems

| Problem | Fix |
|---|---|
| `Docker is not running` | Start Docker Desktop, wait until it says running, run setup again. |
| Port 5433 / 3000 / 4000 in use | Stop the other program, or change the port in `docker-compose.dev.yml` and `api/.env`. |
| `The demo database already has users` | Normal on a second run; use `npm run demo:reset` to start fresh. |
| `prisma migrate reset` refuses to run | Prisma blocks it when an AI coding agent starts it; run `npm run demo:reset` yourself in a terminal. |
| Login says wrong password | Run `npm run demo:reset`. |
| Remove everything | `docker compose -f docker-compose.dev.yml down -v` (deletes the dev database). |

## Where things are

| Path | What |
|---|---|
| `app/api` | Express 5 + Prisma 6 API, migrations in `prisma/migrations` |
| `app/web` | Next.js 15 / React 19 / Tailwind web app |
| `app/shared` | code shared by both (variation codes, sets, demo accounts) |
| `app/api/scripts/seed-demo.ts` | the Demo company data |
| `docs/` | plans, handoffs, audit; `docs/CI-CD.md` and `docs/VERSIONING.md` for releases |
| `local-server/`, `*.bat` | shop-PC install and update scripts (Windows only, not needed for development) |
