"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, PageHeader, SearchInput, Segmented, Toolbar } from "@/components/ui";
import { BookIcon } from "@/components/icons";

// Plain-language dictionary of inventory, trade and software words staff meet in this app.
// Static content: no API, visible to every signed-in user.
type Group = "stock" | "trade" | "money" | "product" | "tech";
type Term = { term: string; aka?: string; group: Group; meaning: string; example?: string };

const GROUPS: { value: Group | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stock", label: "Stock" },
  { value: "trade", label: "Buying & Selling" },
  { value: "money", label: "Money & Tax" },
  { value: "product", label: "Products" },
  { value: "tech", label: "System & Tech" },
];

const TERMS: Term[] = [
  // Stock
  { term: "Inventory", aka: "Stock", group: "stock", meaning: "All the goods the shop has on hand to sell, plus the record of how many of each item there are.", example: "We have 40 bearings in inventory." },
  { term: "Stock In", group: "stock", meaning: "Goods coming into the shop, which increases the quantity on hand. Usually from a purchase or a correction.", example: "50 belts received from a supplier = Stock In of 50." },
  { term: "Stock Out", group: "stock", meaning: "Goods leaving the shop, which reduces the quantity on hand. Usually from a sale.", example: "Selling 3 pulleys = Stock Out of 3." },
  { term: "On Hand", aka: "Current stock", group: "stock", meaning: "How many units the system says are physically in the shop right now." },
  { term: "Stock Adjustment", group: "stock", meaning: "A manual correction to the stock count when the system number does not match what is actually on the shelf (damage, loss, counting mistake).", example: "System shows 10, shelf has 8 → adjust by −2 with a reason." },
  { term: "Stock Movement", aka: "Ledger", group: "stock", meaning: "One line in the history of an item: every in, out and adjustment, with date and who did it. Together they explain the current count." },
  { term: "Low Stock", aka: "Reorder level", group: "stock", meaning: "A warning that an item has fallen to or below a set minimum and should be bought again soon." },
  { term: "Out of Stock", group: "stock", meaning: "Quantity on hand is zero; nothing left to sell." },
  { term: "Negative Stock", aka: "Below zero", group: "stock", meaning: "The system shows less than zero because something was sold before its purchase was entered. It is fixed automatically when the purchase is recorded.", example: "Sold 5 but system had 3 → shows −2 until the purchase is entered." },
  { term: "Stock Take", aka: "Physical count / Audit", group: "stock", meaning: "Counting the actual items on the shelves and comparing with the system to find differences." },
  { term: "Opening Stock", group: "stock", meaning: "The quantity an item starts with when it is first added to the system or at the start of a period." },
  { term: "Dead Stock", group: "stock", meaning: "Items that have not sold for a long time and are tying up money and space." },
  { term: "FIFO", aka: "First In, First Out", group: "stock", meaning: "Sell or use the oldest stock first, so nothing sits too long." },
  { term: "Warehouse", aka: "Godown / Location", group: "stock", meaning: "A place where stock is kept. Larger businesses track stock separately for each location." },

  // Buying & selling
  { term: "Purchase", group: "trade", meaning: "Buying goods from a supplier. Recording it adds the goods to stock." },
  { term: "Purchase Order", aka: "PO", group: "trade", meaning: "A written request sent to a supplier for goods you plan to buy. It does not change stock until the goods arrive and the purchase is recorded." },
  { term: "Sale", group: "trade", meaning: "Selling goods to a customer. Recording it removes the goods from stock." },
  { term: "Sale Order", aka: "SO / Booking", group: "trade", meaning: "A customer's confirmed request for goods that will be delivered later. Stock is reduced only when the sale is completed." },
  { term: "Quotation", aka: "Quote / Estimate", group: "trade", meaning: "A price offer given to a customer before they agree to buy. It is not a sale." },
  { term: "Invoice", aka: "Bill", group: "trade", meaning: "The final document for a sale or purchase showing items, quantities, prices and total amount due." },
  { term: "Party", group: "trade", meaning: "Any person or business you deal with: a customer or a supplier." },
  { term: "Customer", group: "trade", meaning: "A person or business that buys from the shop." },
  { term: "Supplier", aka: "Vendor", group: "trade", meaning: "A person or business the shop buys goods from." },
  { term: "Supplier Price", aka: "Vendor price", group: "trade", meaning: "The price a particular supplier charges for an item, used to compare suppliers and choose who to buy from." },
  { term: "Draft", group: "trade", meaning: "A sale or purchase that has been started and saved but not finished. It does not affect stock or accounts until completed." },
  { term: "Cart", group: "trade", meaning: "The list of items being put together for a sale or purchase before checkout." },
  { term: "Checkout", group: "trade", meaning: "The final step where the cart is reviewed, the party chosen and the sale or purchase is saved." },
  { term: "Delivery Date", group: "trade", meaning: "The date goods are promised to reach the customer or arrive from the supplier." },
  { term: "Lead Time", group: "trade", meaning: "How long a supplier takes to deliver after you place an order." },
  { term: "Return", aka: "Credit note", group: "trade", meaning: "Goods sent back after a sale or purchase. A sales return adds stock back; a purchase return removes it." },

  // Money & tax
  { term: "Cost Price", aka: "Purchase price / CP", group: "money", meaning: "What the shop paid to buy one unit." },
  { term: "Selling Price", aka: "Sale price / SP", group: "money", meaning: "What the customer pays for one unit." },
  { term: "MRP", aka: "Maximum Retail Price", group: "money", meaning: "The highest price printed on a product that can legally be charged to a customer in India." },
  { term: "Margin", aka: "Profit", group: "money", meaning: "Selling price minus cost price: what the shop earns on each unit.", example: "Bought for ₹80, sold for ₹100 → margin ₹20 (20%)." },
  { term: "Discount", group: "money", meaning: "A reduction from the normal price, as an amount or a percentage." },
  { term: "Credit", group: "money", meaning: "Goods given now with payment due later. Customers who buy on credit owe the shop money." },
  { term: "Outstanding", aka: "Balance due / Receivable", group: "money", meaning: "Money still to be received from a customer, or still to be paid to a supplier (Payable)." },
  { term: "Credit Limit", group: "money", meaning: "The maximum amount a customer is allowed to owe at one time." },
  { term: "Credit Score", group: "money", meaning: "A quick rating of how reliably a customer pays, based on their history with the shop." },
  { term: "GST", aka: "Goods and Services Tax", group: "money", meaning: "India's tax on most goods and services, added on top of the price and shown on invoices." },
  { term: "GSTIN", group: "money", meaning: "A business's 15-character GST registration number, printed on tax invoices." },
  { term: "HSN Code", group: "money", meaning: "A standard number that classifies a product for GST and decides its tax rate." },
  { term: "Ledger", group: "money", meaning: "A running record of all transactions with one party or account, showing what was charged and paid." },
  { term: "Valuation", aka: "Stock value", group: "money", meaning: "The total money value of stock on hand, usually quantity × cost price." },

  // Products
  { term: "SKU", aka: "Stock Keeping Unit", group: "product", meaning: "A unique code for one exact item so it can be told apart from similar items.", example: "Bearing 6205 and 6206 each get their own SKU." },
  { term: "Product", group: "product", meaning: "An item the shop buys and sells, with its name, price, photos and stock." },
  { term: "Category", group: "product", meaning: "A group of similar products, used to organise and browse the catalogue.", example: "Bearings, Belts, Motors." },
  { term: "Catalogue", aka: "Catalog", group: "product", meaning: "The full list of products the shop offers, with photos and details." },
  { term: "Variation", aka: "Variant / Option", group: "product", meaning: "Different versions of the same product, such as size or colour, each with its own stock and price.", example: "A V-belt in sizes A40, A42, A44." },
  { term: "Unit", aka: "UOM / Unit of Measure", group: "product", meaning: "How an item is counted or measured: pieces, metres, kilograms, boxes, etc." },
  { term: "Measured Product", group: "product", meaning: "An item sold by length or weight rather than by piece, such as cable or hose cut from a roll." },
  { term: "Roll", aka: "Bundle / Coil", group: "product", meaning: "A full length of a measured product. Cuts are taken from it and the remaining length is tracked." },
  { term: "Barcode", group: "product", meaning: "Black-and-white lines (or a square QR code) that a scanner reads to find a product quickly." },
  { term: "Brand", group: "product", meaning: "The company or name that makes a product, such as SKF or Fenner." },
  { term: "Bundle", aka: "Kit", group: "product", meaning: "Several products sold together as one item." },

  // System & tech
  { term: "Dashboard", group: "tech", meaning: "A summary screen with the most important numbers and alerts at a glance." },
  { term: "User", group: "tech", meaning: "A person with their own login to the system." },
  { term: "Role", group: "tech", meaning: "A job type (owner, manager, staff) that decides what a user can see and do." },
  { term: "Permission", aka: "Access", group: "tech", meaning: "Permission to use a specific screen or action. A user without it sees \"Restricted\"." },
  { term: "Login / Logout", group: "tech", meaning: "Signing in with your username and password, and signing out when finished so others cannot use your account." },
  { term: "Session", group: "tech", meaning: "The period you stay signed in. It ends when you log out or after long inactivity." },
  { term: "Audit Log", aka: "Activity history", group: "tech", meaning: "An automatic record of who changed what and when. It cannot be edited." },
  { term: "Backup", group: "tech", meaning: "A saved copy of all data, kept so it can be recovered if something goes wrong." },
  { term: "Restore", group: "tech", meaning: "Loading data back from a backup. It replaces the current data, so it is done carefully." },
  { term: "Database", aka: "DB", group: "tech", meaning: "Where the system stores all its information: products, stock, parties, invoices." },
  { term: "Server", group: "tech", meaning: "The computer that runs the system and holds the database. Other devices connect to it." },
  { term: "Local Server", group: "tech", meaning: "A server running on a computer inside the shop rather than on the internet." },
  { term: "Browser", group: "tech", meaning: "The program used to open the system, such as Chrome or Edge." },
  { term: "URL", aka: "Web address / Link", group: "tech", meaning: "The address typed in the browser to open a page." },
  { term: "Cache", group: "tech", meaning: "Data the browser keeps temporarily so screens load faster. Reloading the page refreshes it." },
  { term: "Sync", aka: "Synchronise", group: "tech", meaning: "Making sure data matches across devices or copies." },
  { term: "Export", group: "tech", meaning: "Saving data out of the system as a file, such as PDF or Excel." },
  { term: "Import", group: "tech", meaning: "Bringing data into the system from a file." },
  { term: "PDF", group: "tech", meaning: "A file format that looks the same on every device; used for printing and sharing invoices and lists." },
  { term: "CSV / Excel", group: "tech", meaning: "Spreadsheet files with rows and columns, used to move lists of data in or out." },
  { term: "Filter", group: "tech", meaning: "Showing only the rows that match a condition, such as one category or low stock only." },
  { term: "Sort", group: "tech", meaning: "Arranging a list in an order, such as by name, price or newest first." },
  { term: "Pagination", aka: "Pages", group: "tech", meaning: "Splitting a long list into pages so the screen stays fast." },
  { term: "Demo Company", group: "tech", meaning: "A practice copy of the system filled with sample data, for training without touching real records." },
  { term: "Version", group: "tech", meaning: "A numbered release of the software (V1, V2). Newer versions add features." },
  { term: "Bug", group: "tech", meaning: "A mistake in the software that makes it behave wrongly." },
  { term: "Error", group: "tech", meaning: "A message saying an action could not be completed, often with the reason." },
  { term: "Offline / Online", group: "tech", meaning: "Whether the device can currently reach the server. Offline means changes cannot be saved." },
];

const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.value, g.label])) as Record<Group, string>;

export default function GlossaryPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "all">("all");

  const terms = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TERMS.filter((t) => group === "all" || t.group === group)
      .filter((t) => !needle || [t.term, t.aka, t.meaning, t.example].some((s) => s?.toLowerCase().includes(needle)))
      .sort((a, b) => a.term.localeCompare(b.term));
  }, [q, group]);

  const byLetter = useMemo(() => {
    const map = new Map<string, Term[]>();
    for (const t of terms) {
      const letter = t.term[0]!.toUpperCase();
      map.set(letter, [...(map.get(letter) ?? []), t]);
    }
    return [...map.entries()];
  }, [terms]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Glossary"
        subtitle="Simple meanings of inventory, business and computer words used in this app"
        actions={
          <Link href="/rules" className="btn-secondary text-xs">
            Business Logic &amp; Formulas &rarr;
          </Link>
        }
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search a word or meaning…" />
        <div className="max-w-full overflow-x-auto">
          <Segmented label="Topic" value={group} onChange={setGroup} options={GROUPS} />
        </div>
      </Toolbar>

      {byLetter.length > 1 && (
        <nav aria-label="Jump to letter" className="mb-3 flex flex-wrap gap-1">
          {byLetter.map(([letter]) => (
            <a key={letter} href={`#glossary-${letter}`} className="rounded px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-brand-600">
              {letter}
            </a>
          ))}
        </nav>
      )}

      {!terms.length ? (
        <EmptyState icon={<BookIcon className="h-6 w-6" />} title="No matching words">
          Try a shorter word or choose “All”.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {byLetter.map(([letter, list]) => (
            <section key={letter} id={`glossary-${letter}`} className="scroll-mt-20">
              <h2 className="mb-1.5 px-1 text-sm font-bold text-brand-600">{letter}</h2>
              <dl className="card divide-y divide-slate-100">
                {list.map((t) => (
                  <div key={t.term} className="px-4 py-3">
                    <dt className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-slate-900">{t.term}</span>
                      {t.aka && <span className="text-xs text-slate-500">also: {t.aka}</span>}
                      <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{GROUP_LABEL[t.group]}</span>
                    </dt>
                    <dd className="mt-1 text-sm text-slate-700">{t.meaning}</dd>
                    {t.example && <dd className="mt-1 text-xs italic text-slate-500">Example: {t.example}</dd>}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-center text-xs text-slate-400">{terms.length} of {TERMS.length} words</p>
    </div>
  );
}
