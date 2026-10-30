import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../lib/auth.js";
import { productCards } from "../lib/catalog.js";
import { inventoryQuery, queryInventory, type InventorySummary } from "../lib/inventory-query.js";
import { customerModeScrub, seesCost } from "../lib/products.js";

// Product cards for the category rail screens (cart, inventory, products). A card is a summary
// only: no variation rows, so a page costs one roll-up query and two small lookups.
// Paging is on by default here (unlike GET /api/inventory, which the Stock In table and PDF use).
const catalogQuery = inventoryQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
});

export function catalogRoutes() {
  const r = Router();

  r.get("/products", requirePermission("catalog.view"), async (req, res) => {
    const q = catalogQuery.parse(req.query);
    const { companyId, role } = req.auth!;
    const { rows, total, summary } = await queryInventory(companyId, q);
    const isCust = Boolean(req.auth?.isCustomerMode);
    const cards = await productCards(companyId, role, rows);
    const products = isCust ? customerModeScrub(cards) : cards;
    const out: Partial<InventorySummary> | null = isCust ? null : { ...summary };
    if (out && !seesCost(role)) delete out.stockValue;
    res.json({ products, summary: out, total, page: q.page, pageSize: q.pageSize });
  });

  return r;
}
