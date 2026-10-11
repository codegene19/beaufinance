# Architecture

## Principles

1. **Financial logic runs on the server, on database records.** Pages are React Server Components that call services; mutations are Server Actions. The pricing calculator and purchase planner also run the *same* tested engine in the browser for instant feedback, but their inputs come from the database and nothing they show is stored as “actual”.
2. **Exact decimals.** Money is `numeric` in Postgres and `decimal.js` in TypeScript (never JS floats). Original amounts: `numeric(18,2)`; FX rates: `numeric(18,8)`; base-currency amounts are *generated columns* (`amount × fx_rate`, 4 dp) so they can never drift from the recorded value and rate; unit costs keep 6 dp. Display rounds half-up to 2 dp. Allocations use the largest-remainder method so split amounts always add back to the source exactly.
3. **One source of truth per fact.** Every non-inventory cost is a row in `expenses` with exactly one *pool* (shipment, PO, campaign or general) and one *treatment*. Cash is a ledger (`cash_transactions`) written in the same transaction as the payment that caused it. Stock is a ledger (`inventory_movements`).
4. **Atomic, idempotent writes.** Each user action is one database transaction (all-or-nothing). Payments, receipts, returns and stock movements carry unique idempotency keys; order status transitions lock the row and are validated against a state machine — repeating an action cannot duplicate stock, revenue or cash.
5. **Never guess.** Missing exchange rate, weight or volume ⇒ the cost is reported as an issue and excluded, not split equally. Too little sales history ⇒ “not enough data”, no invented quantity. Unknown cash balance ⇒ “incomplete”, affordability disabled.

## Multi-tenancy & security

- Tables carry `business_id`. Child tables use composite foreign keys `(id, business_id)` so a row can never point at another tenant's parent.
- `business_members(business_id, user_id, role)` with roles owner / manager / viewer.
- **Row-level security** on every table: read = member; write = owner/manager; settings & members = owner. Ledgers (`inventory_movements`, `audit_logs`) are append-only for app users.
- Requests run as Postgres role `authenticated` with the user's id in `request.jwt.claims` — on Supabase exactly as PostgREST would — so RLS is enforced by the database, not only by application code. Server actions additionally re-check membership and role.
- Secrets (`DATABASE_URL`, `AUTH_SECRET`) are server-only. No service-role key is used. CSV exports neutralise spreadsheet formula injection.
- A trigger writes every insert/update/delete on financial and inventory tables to `audit_logs` (user, time, before/after).

## Schema (main entities)

```
businesses ─┬─ business_members (user ↔ role)
            ├─ business_settings (rules: costing FIFO/FEFO, recognition, negative stock, fees, margins, planning)
            ├─ currencies · exchange_rates (dated defaults) · markets · tax_rates (market × transaction type) · sales_channels
            ├─ suppliers ── products ── product_variants (SKU)
            ├─ purchase_orders ── purchase_order_items ── supplier_payments
            ├─ shipments ── shipment_items (→ PO items, weight/volume overrides)
            ├─ expenses (treatment + one pool) ── expense_payments · expense_manual_allocations
            │                                └─ cost_allocations (computed, per PO/shipment line)
            ├─ goods_receipts ── inventory_lots (landed cost snapshot + breakdown) ── inventory_movements (ledger)
            ├─ campaigns ── campaign_products
            ├─ customers · sales_orders ── sales_order_items ── order_lot_allocations (reserved/shipped/released/reversed)
            │                         ├─ order_payments (payments & refunds) · returns ── return_items
            ├─ cash_transactions (ledger; unique per source payment)
            ├─ price_simulations · purchase_scenarios · reorder_snapshots
            └─ audit_logs
```

Views (`security_invoker`, so RLS applies): `v_lot_stock` (on hand / reserved / available per lot), `v_po_item_progress`, `v_po_summary` (committed / paid / outstanding), `v_expense_summary` (payment state), `v_order_financials` (per-order revenue, VAT, refunds, COGS, costs, recognition date).

Traceability: sale line → `order_lot_allocations` → lot → PO line + shipment line → `cost_allocations` → expenses.

## Key flows

- **Landed cost** (`services/landed.ts`): rebuilds allocations for the affected POs and shipments whenever a PO line, shipment content, acquisition expense or receipt changes, then refreshes each lot's landed total, unit cost and per-category breakdown. COGS is read from lots, so a late invoice correctly updates the cost of units already sold (management view).
- **Order lifecycle** (`services/sales.ts`): pending → confirmed (reserve lots FIFO/FEFO) → processing → shipped (stock out) → delivered (revenue recognised by default) · cancel before shipping releases reservations · “undelivered/refused” after shipping reverses stock by policy and books shipping as failed-delivery loss · returns put resellable units back into their source lots.
- **Revenue recognition** is configurable: on delivery (default; right for COD), on shipment, or on payment.

## Local vs production

| | Local | Production |
|---|---|---|
| Database | PGlite (Postgres 17 in WASM, `./.data/pglite`, auto-migrated) | Supabase Postgres via `DATABASE_URL` (transaction pooler) |
| Auth | `auth.users` shim + scrypt + signed HTTP-only cookie | Supabase Auth (`@supabase/ssr`, session refreshed in `proxy.ts`) |
| RLS | Same policies (shim provides `auth.uid()` and roles) | Native |

The same migrations and services run in both, and the automated tests exercise them on a real Postgres engine.
