# RS Machinery V3 - Standalone UI Prototype

This directory contains an independent, editable HTML/CSS/JavaScript UI prototype of the **RS Machinery V3** inventory application.

It is designed for rapid design iteration and client review before implementing changes in the production Next.js application.

---

## 1. Quick Start (Running the Prototype)

The prototype runs in any modern browser without requiring a Node.js build step, compilation, or database connection.

### Option A: Using Python (Recommended)
From the repository root or the prototype directory, run:
```bash
# From workspace root:
python -m http.server 8080 --directory "v3/docs/ui-prototype"
```
Then open:
👉 **[http://localhost:8080](http://localhost:8080)**

---

### Option B: Using Node / npx
```bash
# Using npx serve:
npx -y serve "v3/docs/ui-prototype" -p 8080
```
Then open:
👉 **[http://localhost:8080](http://localhost:8080)**

---

### Option C: Direct File Opening
You can also open the file directly in your browser:
👉 `d:\client works\rs new\v3\docs\ui-prototype\index.html` (or `d:\client works\rs new\docs\ui-prototype\index.html`)

---

## 2. Directory Structure

```
docs/ui-prototype/ (and v3/docs/ui-prototype/)
├── index.html            # Standalone HTML application shell and modal/drawer roots
├── styles.css            # Complete design system CSS (Marble 2110 & Tailwind tokens)
├── app.js                # Vanilla JS routing, view renderers, and interactive state engine
├── ANALYSIS.md           # Architecture, source inspection, and screen inventory report
├── SCREEN-MAP.md         # Exact mapping of prototype screens to production files & APIs
├── INTERACTIONS.md       # Interactive behaviors, validation, and implementation workflow
├── README.md             # This guide
├── assets/               # Local static images and icons
└── fixtures/
    └── sample-data.js    # Realistic machinery domain fixtures (ropes, bearings, belts, sales)
```

---

## 3. How to Edit the Prototype

1. **HTML Layout & Shell:** Edit [index.html](index.html) to modify the top header, sidebar navigation, or container roots.
2. **Visual Styling & Themes:** Edit [styles.css](styles.css) to tweak brand colors (variables at top), typography, padding, tables, badges, or dialog aesthetics.
3. **Sample Data & Fixtures:** Edit [fixtures/sample-data.js](fixtures/sample-data.js) to add realistic products, categories, customers, suppliers, or sample orders.
4. **Behavior & Views:** Edit [app.js](app.js) to adjust rendering logic, calculations, or new modal dialogs.

---

## 4. Key Interactive Screens in the Prototype

- **Products (`#products`):** Grid & Table toggle, grouped expandable variations, drag-and-drop variation reordering, KPI strip, search, sales activity stages, 4-step Product Creation Builder modal, stock adjustment modal, export CSV.
- **Categories (`#categories`):** Active category list, product count badges, sort orders, Add Category modal.
- **Stock In (`#inventory`):** Bulk stock updater, inline new stock inputs with dynamic delta change badges, price/threshold fields, reasons selector, atomic save.
- **New Sale (`#sales-new`):** Customer selection drawer (Walk-in vs Regular), product browser with category rail, interactive bottom ProductDrawer with attribute selector pills, floating live CartPill, slide-out CartSidebar.
- **Checkout (`#sales-checkout`):** Customer profile with credit score, line items table, shortage warning under the fixed Warn & Allow policy, payment mode & amount paid calculator, "Complete Sale", "Save as Order", and "Hold Cart".
- **Sale Orders (`#sales-orders`):** Status tabs (`Open`, `Placed`, `On Delivery`, `Completed`, `Cancelled`), order detail timeline view, dispatch and complete progress buttons, cancel order.
- **Invoices / History (`#sales-history`):** Document list, printable A4 Tax Invoice layout, void/cancellation with stock restoration.
- **Purchases Suite (`#purchases-new`, `#purchases-orders`, `#purchases-history`):** Mirrored purchase operations with supplier rate suggestions.
- **Supplier Rates (`#supplier-prices`):** SKU-by-supplier pricing matrix.
- **Customers & Suppliers (`#customers`, `#suppliers`):** Contact directories with credit scores, active toggles, and transaction history.
- **Admin & Tools (`#users`, `#backup`, `#settings`, `#glossary`, `#login`):** Role switcher in top banner, database JSON snapshot exporter, settings, and glossary dictionary.

---

## 5. Handoff to Production

When your design edits are complete and approved:
1. Refer to [SCREEN-MAP.md](SCREEN-MAP.md) to locate the corresponding React components in `v3/app/web/`.
2. Follow the 5-step workflow in [INTERACTIONS.md](INTERACTIONS.md) to apply the approved visual changes into Next.js/Tailwind while preserving existing business logic, validation rules, and database integrity.
