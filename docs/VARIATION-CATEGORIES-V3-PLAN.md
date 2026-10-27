# V3.1 — Categories on variations (and set types) plan

Date: 2026-10-23 · Status: **built 2026-10-23** (owner approved the defaults: Product Type per product, G-A for sets; see §10) · Folder: `D:\client works\rs new\v3.1\app\`

Owner request (2026-10-23): "currently we can connect categories to multiple products, but
cannot assign a category on a specific variation in variation, measurement product, grouped set —
first plan the architecture and design, then we will work."

Inputs read: `v3.1\HANDOFF.md` (Category heads, Grouped products phases 1–3, set types),
`app\api\prisma\schema.prisma` (`CategoryHead`, `Category`, `ProductCategory`, `ProductGroup`,
`ProductVariation`, `GroupByproduct`, `GroupSet`), `app\api\src\lib\category-heads.ts`,
`app\api\src\routes\categories.ts`, `app\api\src\lib\inventory-query.ts`,
`app\api\src\routes\products.ts`, web `ProductForm.tsx`, `HeadCategoryPicker.tsx`,
`ProductDetailView.tsx`, `ProductBrowser.tsx`, `catalog\CategoryRail.tsx`,
`products\categories\[id]\page.tsx`.

---

## 1. Today (after 0033)

| Level | How a category is attached | Count per product |
|---|---|---|
| Product Type head (built-in, no row) | `product_groups.category_id` | 0 or 1 |
| Any other head (Industry, Material, …) | `product_categories (product_id, category_id)` | any number |
| Variation | — not possible — | — |
| Set type (grouped) | — not possible (set types are not rows; they are sets with the same parts) — | — |

Example of the gap: *Wire Rope* has 6 mm, 8 mm, 12 mm, 16 mm. Only 12 mm and 16 mm belong in
**Industry → Marine**. Today the whole product goes into Marine, so browsing Marine shows 6 mm too.

## 2. Proposed rule (one sentence)

A category of a head **other than Product Type** can be put on the **whole product** (as today)
**or on chosen variations** of it; a variation is in the category when its product is, or when it
is ticked itself.

| # | Proposed decision (owner to confirm — see §8) |
|---|---|
| VC1 | **Product Type stays product-level** (one per product). The catalog rail, uncategorized counts, vendor-price sheet and documents keep working unchanged. Variation categories are for the other heads only. |
| VC2 | Two scopes per (product, category): **All variations** (existing `product_categories` row) or **Only these variations** (new `variation_categories` rows). Never both: choosing "All" removes the variation rows of that category; unticking one variation of an "All" product converts it to "Only these" with the rest ticked. |
| VC3 | A **new variation** added later joins "All" categories automatically, and is **not** added to "Only these" categories — the product form shows a hint on the new row ("Marine applies to 12 mm, 16 mm — add this one?"). |
| VC4 | **Simple** products have one variation: the scope choice is hidden (product-level only). |
| VC5 | **Measured** products: same as Variable (their variations are the same rows); rolls / cut pieces follow their variation — no category per piece. |
| VC6 | **Grouped** products: see §5 (set-type categories are a separate, second phase). |
| VC7 | Archived variations keep their links (history, restore) but are never shown or counted. |
| VC8 | A product appears under a category if it is in it at either level; when browsing / filtering by that category, **only the matching variations** are shown in its child rows and drawer, with a "3 of 8 variations" badge. |

## 3. Data model

New migration `0038_variation_categories` (0037 is the latest in `prisma\migrations\`).

```prisma
// V3.1 (0038): a variation in a category of a head other than Product Type, when the category
// does not apply to the whole product (that is a product_categories row; never both).
model VariationCategory {
  variationId String           @map("variation_id")
  variation   ProductVariation @relation(fields: [variationId], references: [id], onDelete: Restrict)
  categoryId  String           @map("category_id")
  category    Category         @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  // Denormalised so "products in category" and the composite tenant FK stay cheap.
  productId   String           @map("product_id")
  companyId   String           @map("company_id")
  createdAt   DateTime         @default(now()) @map("created_at")
  createdById String?          @map("created_by")

  @@id([variationId, categoryId])
  @@index([categoryId, productId])
  @@index([companyId])
  @@map("variation_categories")
}
```

SQL in the migration (Prisma cannot model them, same as 0024 / 0033):

- composite tenant FKs `(variation_id, company_id)` and `(category_id, company_id)`;
- `product_id` must equal the variation's `group_id` (FK on `(variation_id, product_id)` →
  `product_variations (id, group_id)`, needs a unique index there);
- trigger: reject a row whose category has `head_id IS NULL` (Product Type, VC1);
- trigger: reject a row when `product_categories` already has `(product_id, category_id)` (VC2),
  and the reverse on `product_categories` insert — the API also cleans up, the trigger is the net.

Why a link table and not an `attribute rule` ("Diameter ≥ 12 mm → Marine"): rules need a rule
engine, break when attribute values are renamed, and are hard to read on a product page. The UI
gives the rule's convenience instead — "tick all variations where Diameter = 12 mm, 16 mm" —
and stores plain links (§6.2).

## 4. API

| Area | Change |
|---|---|
| `lib\category-heads.ts` | `inCategory(categoryId)` adds `OR variations: { some: { categoryLinks: { some: { categoryId } } } }`; new `variationInCategory(categoryId)` for child rows; `setProductCategories` takes `{ categoryId, scope: "all" \| variationIds[] }[]` (old `string[]` still accepted = all). Keeps VC2 normalised inside the transaction. |
| `routes\products.ts` | product create / edit body: `categoryIds` (unchanged) + `variationCategories: { categoryId, variationIds }[]`; variation rows in the response carry `categoryIds`; `?categoryId=` list filter returns `matchingVariationIds` per product. New variations in the same save may be referenced by their client key (like attribute rows today). |
| `lib\product-create.ts` | same inputs on create. |
| `routes\categories.ts` | `productCount` = distinct products at either level; new `variationCount`; `POST /:id/products` takes `{ productId, variationIds? }` (absent = all); new `DELETE /:id/products/:productId/variations/:variationId`; detail returns per product `scope: "all" \| { variations: [...] }`. |
| `lib\inventory-query.ts` | `rollup` category condition adds the variation-link `EXISTS`; variation rows filtered to matching ones when a category of another head is selected (VC8); KPIs (low / out / value) count only matching variations in that case. |
| `routes\backup.ts` | export / restore `variation_categories` (ids remapped like `product_categories`). |
| Audit | `CATEGORY_ATTACH` / `CATEGORY_DETACH` gain `variationIds` in `after` / `before`; product edit audit includes the variation-category diff. |
| Import (`lib\import.ts`) | out of this phase; later a `Categories` column per variation row (`Industry: Marine; Material: Galvanised`). |

Permission: unchanged — `category.write` for the category page, `product.write` for the form.

## 5. Grouped products (set types) — phase 2, needs owner choice

A grouped product has **one** variation row (the set SKU), so the variation mechanism alone does
nothing for it. What the owner calls a "variation" of a set is a **set type** = sets with the same
parts (e.g. *Chain Hoist · 8 mm 3 m · Safety Hook*). Set types are computed, not stored, and a set
can change type in a sale (part change, D10). Three ways:

| Option | Meaning | Storage | Effort |
|---|---|---|---|
| **G-A Inherit from parts** (recommended start) | A set is in category C when the grouped product is, **or** any of its fitted parts' variations is (e.g. Load Chain 8 mm is in *Heavy duty* → every set with an 8 mm chain shows under Heavy duty). | none — computed from `group_set_parts` + `variation_categories` | small |
| **G-B Set-type rules** | On the grouped product: "Category X → only sets where *Load Chain* is 8 mm or 10 mm (and *Safety Hook* fitted)". | new `set_category_rules (group_id, category_id, conditions jsonb)`; matched at read time | medium |
| **G-C Per set** | Tick categories on each physical set. | `group_set_categories` | small, but sets come and go — owner would re-tick on every purchase |

Recommendation: **G-A now** (no new data entry, always right after a part change); add **G-B**
only if the owner needs a set category that no part carries. G-C is not recommended.

Browsing a grouped product under a category then shows only the matching set types in its ⊕
child rows (`components\sets\SetTypes.tsx`), with the same "2 of 5 set types" badge.

## 6. UI design

### 6.1 Product form (`ProductForm.tsx`, `HeadCategoryPicker.tsx`)

- Each head's multi-select stays. A ticked category of a **Variable / Measured** product shows a
  small scope switch under its tag: **All variations ▾ / Only some**.
- "Only some" opens a popover listing the variations (attribute chips, same as the variation
  table) with checkboxes, plus **quick picks per attribute value** ("Diameter: 12 mm ☐ 16 mm ☐")
  that tick / untick every variation with that value.
- The variations table gets a narrow **Categories** column: chips of variation-only categories
  (product-wide ones are not repeated; a header note says "Also: Industry → Construction (all)").
- New variation row with "Only some" categories on the product: amber hint with one-click add (VC3).

### 6.2 Category page (`products\categories\[id]\page.tsx`)

- Product list rows show **All variations** or chips "12 mm · 16 mm" + "Edit variations".
- "Add products" dialog: picking a Variable / Measured product asks **Whole product** (default) or
  **Choose variations** (same popover as 6.1).
- Counts: "14 products · 9 variations only".

### 6.3 Browse / Stock In / Products list (`ProductBrowser.tsx`, `inventory\page.tsx`, `products\page.tsx`)

- Category filter / rail (other heads) shows the product once; its child rows and the cart drawer
  list only matching variations, badge "3 of 8 variations" with a "Show all" link.
- The Product Type rail is unchanged (VC1).

### 6.4 Product page (`ProductDetailView.tsx`)

- Details: one row per head as today; variation-scoped ones read
  `Industry: Marine (12 mm, 16 mm), Construction`.
- Variations tab: Categories column (read-only chips).

## 7. Build order (when the owner says go)

1. Migration `0038_variation_categories` + `schema.prisma` + `npx prisma generate` (V3.1 servers
   stopped first — the DLL lock noted in HANDOFF).
2. `category-heads.ts` helpers + product create / edit / list + unit tests.
3. `categories.ts` attach / detach / counts + `inventory-query.ts` filtering.
4. Backup export / restore + round-trip test.
5. Web: form scope switch + popover, variations column, category page, browse filtering, product page.
6. Demo data (`scripts\seed-demo.ts`): Wire Rope 12 / 16 mm → Industry: Marine only; Load Chain
   8 mm → Material: Alloy Steel only.
7. Grouped G-A (computed set-type categories) in `lib\sets.ts` / `SetTypes.tsx`.
8. Integration tests (`tests\integration\variation-categories.test.ts`), typecheck, browser check;
   cross-version log entry for V4.

Estimated size: steps 1–6 ≈ one build session; step 7 ≈ half a session.

## 8. Open questions for the owner

1. **Product Type per variation?** Plan keeps Product Type product-level (VC1). Do you ever need
   one product's variations under different Product Types (different rail tiles)?
2. **New variations** — auto-join "Only some" categories never (VC3), or ask every time?
3. **Grouped sets** — G-A (inherit from part categories) enough to start, or do you need G-B rules?
4. **Filtered KPIs** — when Stock In is filtered by a variation-scoped category, should totals
   count only those variations (plan: yes)?

## 9. Cross-version

When built, log in `references for final inven\AI_CONTEXT\15-cross-version-change-propagation.md`
and check `D:\client works\rs new\v4\` (port the table + API, or defer). Not applicable to `v1\`
(no heads) and `main v2\` (Apps Script, product-level categories only).

## 10. Build status (2026-10-23)

Built as planned (§3–§7). Deviations / details:

- Grouped G-A: a set product is *listed* under a category when one of its by-products is in it
  at either level (catalog-stable); its *sets* are counted / shown only when a fitted part is
  (or the set product itself is). Product Type never propagates from parts (VC1).
- Category page "Remove" is hidden for sets that are in a category only through parts (404
  from the API).
- The product form shows "Applies to" only for Variable / Measured products with 2+ active
  variations; a category left on "Only some" with nothing ticked blocks the save.
- Stock In: the category filter now lists the other heads' categories (optgroups); under such
  a category the badge reads "2 of 3 variations" and rows / rolls / set types show only matches.
  The Product Type rail and the catalog browse are unchanged.
- Import (`lib\import.ts`) has no per-variation category column yet (out of this phase).
