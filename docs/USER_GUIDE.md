# User guide

A short path from your first product to your second bulk order. Every page has search, filters and an empty state that tells you what to do next.

## 0. First setup (10 minutes)
1. **Settings › Currencies & rates** — enter today's MAD → EUR rate from your bank (the default is a placeholder). Old transactions keep their own rates.
2. **Settings › Tax & markets** — review the France VAT placeholders with your accountant.
3. **Settings › Business & pricing** — payment fees, default packaging/fulfilment/shipping costs, target & minimum margin.
4. **Cash flow › Record opening balance** — your starting bank balance and/or owner contribution. Without it, cash is shown as *incomplete*.

## 1. Register the first product
Products › **Add product**: name, category, supplier (add it in Suppliers first, or later), status *active*. In the variant: SKU, supplier unit price **in MAD**, selling price (tick “includes VAT” for consumer prices), weight (needed to split freight by weight), MOQ, lead times, safety stock, shelf life.

## 2. Enter initial costs
- Purchase orders › **Create purchase order**: supplier, accounting rate, products and quantities, deposit due. The order value is a *commitment*, not cash.
- On the PO: **Record payment** for the deposit (enter the rate your bank actually used), later for the balance — as many partial payments as needed.
- Launch costs (samples, branding, website, photos): Expenses › **Record expense**, treatment *One-time startup*. They count in business profit but not in unit costs.
- Pre-launch advertising: create a campaign marked *pre-launch*, then record spend linked to it.
- Planned but not committed costs: record with status *Planned* — they appear only in forecasts.

## 3. Ship, pay import costs, receive stock
1. Shipments › **New shipment** (or *Create shipment* on the PO) and choose the PO lines on board.
2. As invoices arrive — even before the goods — **Add import cost**: freight (by weight), insurance (by value), customs duties (by value), import VAT (recoverable: not a product cost), broker, handling, labels… Each can use its own allocation method.
3. When goods arrive: **Receive goods** — count received, damaged, rejected, missing, and enter the batch expiry date. Only sellable units enter stock.
4. Check the PO's **Landed cost breakdown**: purchase + every allocated cost per product, and the **landed cost per sellable unit**.

## 4. Calculate selling prices
Pricing calculator: pick the product — landed cost, fees, VAT, return rate and ad cost per order are pre-filled from your records. Read break-even, minimum, target and premium prices, compare three scenarios side by side (margin **and** markup, profit at 100/500/1,000 orders), then **Use recommended as default price**. Toggle incl./excl. VAT display at any time. All results are labelled estimates.

## 5. Record sales
Sales › **Record sale** (or **Import CSV**): channel, campaign (for CPA/ROAS), items, discounts, shipping charged, payment method, and your costs (shipping, fulfilment, fees — pre-filled). *Confirmed* reserves stock from the oldest (FIFO) or earliest-expiring (FEFO) batch.
- **Mark shipped** → stock leaves. **Mark delivered** → revenue counts (default rule); for COD tick “record the balance as collected”.
- Refused / undelivered parcel → **Undelivered / refused** (stock returns by default; shipping becomes a failed-delivery cost).
- Customer return → **Record return** (resellable units go back to their batch) with refund.

## 6. Monitor
- **Overview**: sales, gross profit, contribution, profit after ads, net operating profit, cash, inventory value, liabilities, break-even progress. Click any metric to see its records.
- **Profitability**: each product is *profitable*, *below target*, *break-even*, *unprofitable* or *insufficient data* — from actual completed sales after allocated advertising — plus the full P&L.
- **Cash flow**: actual balance, what you owe, what customers owe, free cash after obligations, 13-week forecast, investment recovery.

## 7. Plan the second bulk order
Reorder planning shows each product as *Urgent*, *Order soon*, *Plan next order*, *Healthy* or *Not enough data*, with the reason. Open a product to use the **purchase planner**:
- current sellable units, expected sales until arrival, stock left at delivery, recommended quantity;
- stockout date, recommended and latest order dates, expected arrival;
- change quantity, supplier price, exchange rate, freight & customs per unit, deposit %, lead times — see total landed cost, deposit now / balance later, cash left after liabilities and your minimum reserve, units needed to recover the investment, and the projected stock chart;
- **Save scenario** to compare options, then **Create purchase order** pre-filled from the scenario.

The inventory recommendation (do I need stock?) and the financial check (can I afford it?) are shown separately on purpose.

## Good habits
- Enter every supplier invoice and payment as it happens; reconcile the cash balance with your bank monthly.
- Use **Inventory › Adjust stock** after physical counts (every adjustment is logged with a reason).
- Export reports (CSV/Excel/PDF) monthly for your accountant.
