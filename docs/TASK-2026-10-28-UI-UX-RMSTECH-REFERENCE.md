# Task for 2026-10-28: UI/UX improvement using RMS Tech as a reference

## Owner's list for 2026-10-28 (added 2026-10-27)

Progress 2026-10-28: item 1 put on hold (owner: "leave standard app for now"). Item 2 done
(see `docs\V3.2-BACKLOG.md` A3). Item 3: diff reviewed, typecheck and unit tests (147) pass,
screens checked; integration suite 27 files / 214 tests passed (owner consented to the `rs_v31_test` reset);
nothing committed yet.

1. **Verification email message.** Write and wire the email sent to verify a user's email (signup
   OTP / verification code): subject, body text, code, expiry note, and the sender name. In the
   hosted app (`D:\client works\rs new\standardapp\`) it must use `APP_NAME`, never "RS
   Machinery". Check first whether Gmail SMTP and `SUPPORT_CONTACT` are set on the live server
   (`standardapp\HANDOFF-2026-10-20.md`: signup returned `EMAIL_NOT_CONFIGURED`). Confirm with the
   owner which app this is for (hosted `standardapp\` or `measurement-inventory\`) if unclear.
2. **Grouped product pricing, part 2.** Continue backlog A3 "Vendor pricing for grouped products"
   in `docs\V3.2-BACKLOG.md` (computed set rate from parts, per-supplier set rate override, Supplier
   Rates set rows, purchase set sheet vendor hint). Settle its open questions with the owner first:
   one rate per set type or per exact contents; whether set sale price uses it for margin; mixed
   rates on one cart line. Update D24 in `docs\GROUPED-PRODUCTS-V3-PLAN.md` when done.
3. **Verify all changes made on 2026-10-27.** Run `git status --short` and `git diff` in
   `measurement-inventory\` and check each change: `app\api\prisma\schema.prisma`,
   `app\api\src\routes\backup.ts`, `app\api\src\routes\parties.ts`, and web pages backup, inventory,
   inventory roll, `(app)\layout.tsx`, products, settings, supplier-prices (plus anything else
   listed). Also the mobile UI pass (`docs\UI-UX-RMSTECH-MOBILE-2026-10-27.md`) and the git
   cleanup (`D:\client works\rs new\docs\GIT-CLEANUP-2026-10-27.md`). Run the API and web tests and
   typecheck, check changed screens at desktop and phone width, then commit on a branch per
   `docs\VERSIONING.md` and log cross-version decisions in
   `references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md`.

Status: first mobile pass done 2026-10-27 (owner: "start now ... more focus for mobile"). Report, changes and open items: `docs\UI-UX-RMSTECH-MOBILE-2026-10-27.md`. Reference images: `D:\client works\rs new\rms.tech\`.
Working folder: `D:\client works\rs new\measurement-inventory` (web app in `app\web\`).

Before starting:
- No RMS Tech (com.rmstech.app) screenshots, recordings or notes were found in the workspace
  on 2026-10-27. Ask the owner where the reference directory is, or create
  `D:\client works\rs new\measurement-inventory-Data\rmstech-reference\` and ask them to put
  the material there.
- `git status` in `measurement-inventory\` showed uncommitted work (schema, documents,
  measure, backup, parties, products, tests, backup page). Do not overwrite it; branch from
  it per `docs\VERSIONING.md`.
- Hosted-app branding rules in the workspace `AGENTS.md` apply to anything later ported to
  `standardapp\`.

## Brief (as given by the owner)

**Objective.** Improve the existing RS Inventory web application's UI/UX using RMS Tech
(com.rmstech.app) as a design reference. This is a UI/UX improvement project, not an
application recreation project.

**Reference materials.** Inspect the screenshots, screen recordings and notes in the reference
directory. If incomplete, identify which additional screens or interactions would give the most
useful evidence. Do not assume the reference app's internal implementation is available.

**Phase 1: Audit RS Inventory.** Inspect the repository before proposing changes. Identify:
frontend framework and component structure; routes and screens; design tokens, typography,
colours, spacing; navigation and interaction patterns; product list, product details and
category interfaces; forms, tables, dialogs, drawers, bottom sheets; desktop and mobile
layouts; existing tests and business workflows. Preserve the architecture unless there is a
demonstrated reason to change it.

**Phase 2: Analyse the reference app.** For each screenshot/recording document: layout and
information hierarchy; component structure; typography, spacing, emphasis; navigation;
interaction states; transitions and animations; loading/success/error/empty states;
mobile-specific decisions. Separate what is observed from what is assumed. Do not invent
interactions the evidence does not show.

**Phase 3: Comparison report.** Table with: (1) RS Inventory current behaviour, (2) relevant
RMS Tech reference, (3) UX problem/opportunity, (4) proposed improvement, (5) user benefit,
(6) implementation effort, (7) regression risk, (8) evidence and confidence. Prioritise
changes that cut interaction time, improve clarity and prevent user errors. Do not copy
customer-facing shopping patterns unsuited to inventory management.

**Phase 4: Plan implementation.** Group into: quick visual improvements; component-level;
navigation and workflow; responsive layout; animation and interaction refinements. Before
changing code, list anything that could affect inventory calculations, stock movements, cart
behaviour, authentication or persistence.

**Phase 5: Implement** the highest-value improvements in small, reviewable steps. Preserve
business logic and data integrity; reuse existing components; avoid unnecessary dependencies;
keep desktop usability and keyboard accessibility; mobile responsive; animate only for
feedback/orientation; respect reduced motion; no backend contract changes without an explicit
requirement.

**Phase 6: Verify.** Run relevant existing tests; check modified screens at desktop and mobile
sizes; compare against the reference. Report what changed, why, tests run and results, known
limitations, regressions or unresolved issues.

Do not redesign the whole application before the comparison report and implementation plan
exist.
