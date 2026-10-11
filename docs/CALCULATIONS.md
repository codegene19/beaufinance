# Calculation reference

All amounts in base currency (EUR) and **excluding VAT** unless stated. Implementation: `src/lib/calc/*` (pure) and `src/lib/services/*` (database). Tests: `tests/calc.test.ts`, `tests/lifecycle.test.ts`, `tests/integrity.test.ts`.

## Landed cost

- Purchase value of a PO line = quantity × unit price × **PO accounting rate**. Payments record the actual bank rate for cash; the difference can be recorded as a “currency conversion charges” expense.
- Capitalisable costs = committed expenses with treatment *product acquisition*, linked to a PO (allocated across its lines) or a shipment (across the lines on board). Optional restriction to one product.
- Allocation methods: quantity, purchase value, weight (line weight override or unit weight × qty), volume (override or L×W×H × qty), manual % shares. Exact largest-remainder rounding. Missing basis data ⇒ issue reported, cost not allocated.
- Not capitalised: recoverable taxes (e.g. import VAT when configured recoverable), planned (uncommitted) costs, cancelled costs.
- Per basis unit = (purchase + PO-level allocations) ÷ PO line qty + shipment allocations ÷ shipment line qty.
- **Landed cost per sellable unit** = per-basis-unit × (received + missing) ÷ (received − damaged − rejected). Losses are absorbed by sellable units; partial receipts keep the same unit cost.

## Revenue, COGS and contribution

- Order net revenue = (Σ qty × price − line discounts − order discount + shipping charged), ÷ (1 + VAT) when prices include VAT, × order FX rate.
- Refunds (ex VAT) = refunded amount ÷ (1 + VAT) × FX.
- COGS = Σ shipped units × their lot's landed unit cost − resellable returned units × lot cost. Damaged returns stay in COGS.
- Contribution (per order) = net revenue − refunds − COGS − shipping/fulfilment/packaging − payment & platform fees − return shipping. Order-level amounts are split to lines by line value.
- Contribution margin = contribution ÷ net revenue ex VAT. **Markup** = profit per unit ÷ landed unit cost. Displayed separately.

## Profit & loss (management, accrual)

Gross sales − discounts − refunds = net sales; − COGS = gross profit; − fulfilment, payment/platform fees, per-order expenses, failed deliveries = contribution before marketing; − marketing = contribution after marketing; − operating, startup, inventory write-offs = **net operating profit**. Acquisition costs reach the P&L only via COGS. VAT collected and recoverable import VAT are shown as information.

## Marketing

CPA = spend ÷ attributed (non-cancelled) orders; delivered CPA = spend ÷ delivered attributed orders; ROAS = attributed recognised net revenue ÷ spend; profit after ads = contribution of attributed orders − spend. Product allocation (exactly once): units in delivered orders / units in all attributed orders / revenue share / manual %. Pre-launch campaigns and spend without attributed sales or without a campaign = **unallocated marketing**, deducted once in the P&L, never added to unit costs. Invariant tested: Σ product allocations + unallocated = total spend.

## Pricing calculator

For price P (ex VAT, before discount), units u, discount d, VAT v, return rate r, resellable share k:

- Revenue R = u·P·(1−d) + shipping charged/(1+v); customer pays G = R·(1+v); expected net revenue N = R·(1−r)
- % fees on G (or R if configured) + fixed fees
- Product cost = landed × u × (1 − r·k); returns cost = r × cost per return
- Contribution C = N − product − packaging×u − fulfilment − shipping − fees − returns − ad cost per order

C(P) and N(P) are linear, so the price for target margin m is solved exactly: P = (m·e − b)/(a − m·c) with C = aP + b, N = cP + e. Break-even is m = 0. Unreachable targets (fees + margin ≥ 100%) return “not reachable”. Recommended price = target price rounded up to a .90 ending (incl. VAT).

**Worked example** (test `pricing calculator`): landed €6.00, packaging €0.80, fulfilment €1.50, shipping €5.50, card 1.5% + €0.25 on gross, ads €4.00/order, returns 3% (80% resellable, €6 each), VAT 20%, price €25 ex VAT (€30 incl.): net revenue €24.25, fees €0.70, product €5.856, contribution €5.714, **margin 23.56%**, **markup 95.23%**.

## Reorder planning

- Average daily sales = units ordered (confirmed and later, not cancelled) in the history window ÷ days observed (window capped at first activity).
- Inventory position = sellable on hand + confirmed incoming (open PO quantity not yet received) − reserved.
- Lead time = supplier lead + shipping & customs lead. Safety stock = max(fixed safety stock, buffer days × daily sales).
- Reorder point = daily sales × lead time + safety stock.
- Stockout date walks through confirmed deliveries in date order. Latest order date = stockout − lead time. Recommended order date = when position reaches the reorder point.
- Suggested qty = daily sales × (lead time + coverage target) + safety stock − position, rounded up to MOQ and order multiple.
- Status: *urgent* (no available stock, or stockout before an order placed today could arrive) · *order soon* (position ≤ reorder point) · *plan* (reorder point within 30 days) · *healthy* · *not enough data* (fewer than the configured minimum days or < 3 units).
- Affordability (separate): cash − committed liabilities − minimum reserve ≥ projected landed cost. Payback units = landed cost ÷ contribution per unit.

**Worked example** (test `reorder planning`): 120 units in 60 days ⇒ 2.00/day; 150 on hand − 10 reserved = 140 available ⇒ stockout in 70 days (19 Dec 2026 from 10 Oct); lead 30 + 21 = 51 days; safety max(20, 2 × 14) = 28; reorder point 130; latest order date 29 Oct 2026; need 2 × (51 + 120) + 28 − 140 = 230 ⇒ 250 (multiples of 50); purchase €1,250 + import €375 = €1,625 landed; deposit 30% €375; with €5,000 cash, €1,000 liabilities, €1,000 reserve ⇒ affordable; payback 204 units at €8 contribution.

## Small test dataset (tests/lifecycle.test.ts) and expected results

| Step | Data | Expected (verified) |
|---|---|---|
| PO | 100 argan @ 60 MAD + 200 clay @ 30 MAD, rate 0.092 | committed €1,104.00; argan €552, clay €552 |
| Payments | 3,600 MAD @ 0.093 + 4,000 MAD @ 0.091 | paid €698.80; outstanding 4,400 MAD (≈ €404.80); status partially paid; duplicate & over-payment rejected |
| Import costs | freight €650 by weight (15 kg / 50 kg), duty €110.40 by value, broker €60 by qty, import VAT €242.88 (recoverable), local transport €50 planned | allocations: freight 150/500, duty 55.20/55.20, broker 20/40; allocated total €820.40 (VAT and planned excluded) |
| Receipt | argan 100 recv, 4 damaged; clay 190 recv, 10 missing | argan €777.20 ÷ 96 = **€8.095833**; clay €1,147.20 ÷ 190 = **€6.037895** |
| Sales | SO-1 2 argan @ €24 incl. VAT delivered; SO-2 COD shipped then refused (restocked); SO-3 3 clay @ €15, 1 returned resellable, €15 refunded | net sales €65.00; COGS €28.27; failed delivery €5.50; stock argan 94, clay 188 |
| Marketing | €30 Meta (SO-1 attributed), €20 unlinked | CPA €30.00, ROAS 1.33×; €30 to argan, €20 unallocated; sum = €50 |
| Cash | €5,000 contribution − 334.80 − 364.00 − 400 freight + 48 + 45 − 15 | **€3,979.20** (equals ledger) |
| Late cost | €48 inspection on argan after sales | argan landed €8.5958; product COGS and contribution update |
