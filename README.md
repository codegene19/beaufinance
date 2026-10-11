# BeauFinance

Profitability, inventory and cash-flow control centre for a natural-cosmetics brand sourcing from Morocco (MAD) and selling in France (EUR) — configurable for other markets and currencies.

It follows the full product lifecycle: product & supplier → bulk purchase order → deposits and partial payments → shipment, freight, customs and import costs (before goods arrive) → **landed cost per sellable unit** → receiving into batch-level stock → pricing → sales, cancellations, returns and refunds → actual profit and cash → **when and how much to reorder, and whether you can afford it**.

Every figure is calculated on the server from database records. Nothing on the dashboard is hardcoded.

## Feature map

| Area | Highlights |
|---|---|
| Overview | 15 KPIs (each links to its underlying records), sales & profit trend, break-even progress, product/channel/expense/marketing/inventory/cash charts, actual vs forecast spend, reorder and margin alerts; daily → quarterly and custom periods |
| Products | Variants/SKUs, barcode, supplier price & currency, target margin/markup, dimensions & weight, MOQ, multiples, lead times, safety stock, shelf life, documents |
| Suppliers | Terms, deposit %, lead time, MOQ; committed vs paid vs outstanding |
| Purchase orders | Multi-product, accounting FX rate, multiple partial payments at actual rates, lifecycle statuses, inspectable landed-cost breakdown |
| Shipments & import costs | Costs recorded before arrival; allocation by quantity, value, weight, volume or manual shares; refuses to guess when data is missing; recoverable VAT kept out of product cost |
| Inventory | Batch lots with own landed cost & expiry, FIFO or FEFO, reservations, auditable movements, write-offs, opening stock, in-transit view, negative-stock policy |
| Sales | Manual entry + CSV import, separate order and payment status, COD delivered-vs-placed, cancellations (incl. refused parcels), returns to source lots, refunds; revenue recognised by configurable rule |
| Marketing | Campaigns, CPA, delivered CPA, ROAS, conversion, profit after ads; spend allocated to products exactly once; pre-launch/unlinked spend shown separately |
| Expenses | Committed vs cash spent vs forecast (planned); treatment per expense (acquisition, recoverable tax, operating, startup, per-order, marketing); partial payments |
| Pricing calculator | Break-even, minimum, recommended (charm-rounded), premium; three editable scenarios side by side; margin vs markup; VAT-inclusive/exclusive; fees on gross or net; volumes |
| Profitability | Product classification from actual completed sales, unit economics vs period performance, fixed-cost coverage, full P&L statement (print/PDF) |
| Reorder planning | Velocity, stockout date, reorder point, recommended & latest order dates, suggested quantity (MOQ/multiples), second-bulk-order planner with cash affordability and stock projection |
| Cash flow | Actual balance (requires opening balance/contribution), liabilities, receivables, 13-week forecast, owner contributions/withdrawals, investment recovery |
| Reports | 15 reports + P&L, filters by date/product/supplier/shipment/channel/campaign, CSV, Excel (.xlsx) and print-to-PDF |
| Settings | Business, currencies & dated default rates, markets, tax rates per market & transaction type, fees, channels & commissions, margins, inventory & recognition rules, planning parameters, users & roles, data export/backup, demo business |

## Technology

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 with a hand-built shadcn-style kit (Radix primitives) · React Hook Form + Zod (validated again on the server) · Recharts · PostgreSQL (Supabase in production, embedded PGlite for local development) · Supabase Auth · decimal.js for all money arithmetic · ExcelJS / PapaParse · Vitest.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions, schema and security model, and [docs/CALCULATIONS.md](docs/CALCULATIONS.md) for every formula with a worked test dataset.

## Quick start (local, no external services)

Requires Node.js 20.9+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local`: set `AUTH_PROVIDER=local`, leave `DATABASE_URL` empty and set a 32+ character `AUTH_SECRET`. Then:

```bash
npm run dev
```

Open http://localhost:3000, create an account, name your business. Tick **“Also create a separate demo business”** to explore realistic sample data (it lives in its own business, never mixed with yours). The embedded database is stored in `./.data/pglite` and migrated automatically.

## Try it online: GitHub Codespaces

Click **Code → Codespaces → Create codespace on main** in GitHub. The container installs dependencies, creates a local `.env.local` with a fresh secret, and starts the app on port 3000. Open the **Ports** tab (or the pop-up) to reach your private `https://…-3000.app.github.dev` address, then sign up and tick “create a demo business”. Data lives in the Codespace's embedded database. Stop the Codespace when finished to save your free monthly hours.

## Deploy: Supabase + Vercel

1. **Create a Supabase project** (EU region recommended, e.g. Paris `eu-west-3`).
2. **Apply the schema.** Either install the Supabase CLI and run `supabase link` then `supabase db push`, or paste each file of `supabase/migrations/` (in order) into the SQL editor. Do **not** run `db/local/*` on Supabase. Alternatively: `DATABASE_URL=… npm run db:migrate`.
3. **Auth settings** (Authentication → URL configuration): Site URL = your Vercel URL; add `https://<your-app>/auth/callback` to redirect URLs. Email confirmation can stay on.
4. **Create the Vercel project** from this repository and set environment variables:
   - `AUTH_PROVIDER=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL=https://<your-app>.vercel.app`
   - `DATABASE_URL` = Supabase **transaction pooler** connection string (port 6543). Server-only; never prefixed `NEXT_PUBLIC_`.
5. Deploy. Sign up in the app, create your business.

How data access works in production: the server connects with `DATABASE_URL`, but every request runs inside a transaction that switches to the Postgres `authenticated` role with the signed-in user's JWT claims (`set local role authenticated`), so Supabase **row-level security policies are enforced by the database** for every query. The service-role key is not used anywhere.

### Self-hosted PostgreSQL (without Supabase)

Set `DATABASE_URL`, `AUTH_PROVIDER=local`, `AUTH_SECRET`, then `npm run db:migrate -- --local-auth` (installs a minimal Supabase-compatible `auth` schema so the same RLS policies work).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Develop / production build / serve |
| `npm test` | 54 automated tests (calculation engine + database integration on real Postgres via PGlite) |
| `npm run lint` | Type-check |
| `npm run db:migrate` | Apply migrations (embedded DB or `DATABASE_URL`) |
| `npm run db:seed-demo -- <email>` | Create a separate demo business for an existing user |
| `npm run db:backup` | Backup (see [docs/BACKUP.md](docs/BACKUP.md)) |

## Project structure

```
supabase/migrations/   SQL schema, views, RLS policies, audit triggers (source of truth)
db/local/              Local-only auth shim (never applied to Supabase)
src/lib/calc/          Pure, unit-tested financial engine (money, landed cost, pricing, reorder, analytics)
src/lib/services/      Server-side business logic; every multi-record operation is one DB transaction
src/lib/validation/    Zod schemas shared by forms and server actions
src/lib/db/            Drivers (PGlite / postgres.js), migrations, tenant-scoped transactions (RLS)
src/lib/auth/          Supabase Auth or local auth (scrypt + signed session cookie)
src/app/(app)/         The 14 sections of the app
src/app/actions/       Server actions (validate → authorise → transact → revalidate)
src/app/api/export/    CSV / Excel report exports
tests/                 Vitest suites
docs/                  Architecture, calculations, backup, user guide
```

## Integrations not connected (manual workflows provided)

| Integration | Current workflow |
|---|---|
| Shopify / WooCommerce / TikTok Shop / marketplaces | CSV order import (idempotent: re-importing skips existing order numbers) and CSV/Excel export |
| Ad platforms (Meta, TikTok, Google) | Record spend as expenses linked to a campaign; attribute orders when recording sales |
| Bank feeds / live exchange rates | Payments record the rate your bank actually applied; dated default rates are entered in Settings |
| File storage for receipts, images, documents | Paste a link (e.g. Google Drive); Supabase Storage can be added later |
| Email invitations | Teammates sign up, then an owner adds them by email in Settings › Users & roles |
| Server-side PDF generation | Printable report and P&L pages (“Print / save PDF”) |

## Work in progress

Direct order sync for Shopify, WooCommerce, eBay and TikTok Shop is being built (`src/lib/integrations/`, migration `20261011000001_integrations.sql`). The platform connectors exist; the sync engine, webhook/OAuth endpoints and the Integrations page are not wired up yet, so use CSV import meanwhile.

## Important notes

- Tax rates are configurable placeholders. The app does not determine which rates apply to your products and does not make the business tax-compliant — confirm with your accountant.
- Default exchange rates are placeholders until you update them in Settings.
- Figures are management accounts, not statutory accounts.
