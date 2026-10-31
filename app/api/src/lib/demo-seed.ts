import { randomUUID } from "node:crypto";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@rs-v31/shared";
import { prisma } from "../db.js";

export type Json = Record<string, unknown>;
export interface Variation {
  id: string;
  shortName: string;
  attributes: Record<string, string>;
  salePrice?: string;
  purchaseCost?: string;
}
export interface Product {
  id: string;
  name: string;
  variations: Variation[];
}

export function client(base: string, origin = "") {
  let cookie = "";
  return async function call<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data as T;
  };
}

export type SeedClient = ReturnType<typeof client>;
export const createSeedClient = client;

// V3.1 category heads (Product Type above is built in). Products are listed by name.
const CATEGORY_HEADS = [
  {
    name: "Industry",
    categories: [
      { name: "Construction", products: ["Electric Hoist 1 Ton", "Beam Clamp 2 Ton", "Chain Hoist", "Steel Wire Rope 6x19 (Measured)", "Chain Hoist Set"] },
      { name: "Warehousing", products: ["Electric Hoist 1 Ton", "Chain Hoist", "Girder Clamp", "Load Chain Grade 80 (Measured)"] },
      {
        name: "Marine",
        products: ["Stainless Steel Wire Rope (Imperial)", "Commercial D-Shackle 12mm (Discontinued)", "Girder Clamp"],
        // V3.1 (0038): only these variations (attribute values).
        variations: [{ product: "Steel Wire Rope 6x19 (Measured)", values: ["16"] }],
      },
      { name: "Agriculture", products: ["Chain Hoist", "Load Chain Grade 80 (Measured)"] },
      { name: "Gym & Fitness", products: ["Stainless Steel Wire Rope (Imperial)", "Steel Wire Rope 6x19 (Measured)"] },
    ],
  },
  {
    name: "Material",
    categories: [
      {
        name: "Alloy Steel",
        products: ["Chain Hoist", "Beam Clamp 2 Ton"],
        variations: [{ product: "Load Chain Grade 80 (Measured)", values: ["8"] }],
      },
      { name: "Galvanised", products: ["Steel Wire Rope 6x19 (Measured)", "Girder Clamp"] },
      { name: "Stainless Steel", products: ["Stainless Steel Wire Rope (Imperial)"] },
    ],
  },
] as const;

const CATEGORIES = [
  "Lifting Equipment",
  "Rigging Hardware",
  "Wire Rope",
  "Chains & Fittings",
] as const;

function cross(defs: { name: string; values: string[] }[]): Record<string, string>[] {
  return defs.reduce<Record<string, string>[]>((rows, d) => rows.flatMap((r) => d.values.map((v) => ({ ...r, [d.name]: v }))), [{}]);
}

interface ProductDef {
  category: (typeof CATEGORIES)[number];
  body: {
    productType: "variable" | "simple";
    name: string;
    unit: string;
    description?: string;
    baseShortName?: string;
    shortName?: string;
    officialSku?: string;
    attributes?: {
      name: string;
      unit?: string;
      values: string[];
      isQuality?: boolean;
    }[];
    // 0044: technical specifications of the whole product.
    specs?: { name: string; value: string }[];
  };
  /** 0044: a variation's own technical specifications. */
  variationSpecs?: (a: Record<string, string>) => { name: string; value: string }[];
  price: (a: Record<string, string>) => number;
  initialStock?: number | ((a: Record<string, string>) => number);
  lowStockThreshold?: number;
  isInactive?: boolean;
}

const PRODUCTS: ProductDef[] = [
  // 1. Simple Product (In Stock)
  {
    category: "Lifting Equipment",
    body: {
      productType: "simple",
      name: "Electric Hoist 1 Ton",
      shortName: "EH-1T",
      officialSku: "8901234500011",
      unit: "pcs",
      description: "Motorized electric wire rope hoist with pendant control.",
      specs: [
        { name: "Capacity", value: "1 t" },
        { name: "Lifting height", value: "6 m" },
        { name: "Lifting speed", value: "8 m/min" },
        { name: "Motor", value: "1.5 kW, 415 V, 3 phase" },
        { name: "Duty class", value: "M4 (FEM 1Bm)" },
      ],
    },
    price: () => 45000,
    initialStock: 6,
    lowStockThreshold: 2,
  },

  // 2. Simple Product (Out of Stock target: initially 5, will be fully sold in seed)
  {
    category: "Lifting Equipment",
    body: {
      productType: "simple",
      name: "Beam Clamp 2 Ton",
      shortName: "BC-2T",
      officialSku: "8901234500028",
      unit: "pcs",
      description: "Universal adjustable I-beam rigging clamp.",
    },
    price: () => 3200,
    initialStock: 5,
    lowStockThreshold: 2,
  },

  // 3. Simple Product (Archived / Inactive / Discontinued)
  {
    category: "Rigging Hardware",
    body: {
      productType: "simple",
      name: "Commercial D-Shackle 12mm (Discontinued)",
      shortName: "DS-12-OLD",
      unit: "pcs",
      description: "Commercial grade mild steel shackle — archived model.",
    },
    price: () => 75,
    initialStock: 5,
    isInactive: true,
  },

  // 4. Variable Product (2-Attribute Matrix: Size x Construction; with Low Stock variation)
  {
    category: "Rigging Hardware",
    body: {
      productType: "variable",
      name: "Girder Clamp",
      baseShortName: "GC",
      unit: "pcs",
      description: "Cast steel girder clamp — 2-attribute matrix demo.",
      attributes: [
        { name: "Size", unit: "mm", values: ["8", "10"] },
        { name: "Rope Construction", values: ["6x19", "6x24"] },
      ],
      specs: [
        { name: "Material", value: "Cast steel" },
        { name: "Finish", value: "Painted yellow" },
        { name: "Standard", value: "EN 13155" },
      ],
    },
    variationSpecs: (a) => [
      { name: "Working load limit", value: a.Size === "8" ? "1 t" : "2 t" },
      { name: "Flange width", value: a.Size === "8" ? "75–220 mm" : "80–320 mm" },
    ],
    price: (a) => (a.Size === "8" ? 850 : 1150),
    // 8mm 6x19 is seeded with 2 units vs threshold 10 -> Low Stock demo!
    initialStock: (a) => (a.Size === "8" && a["Rope Construction"] === "6x19" ? 2 : 20),
    lowStockThreshold: 10,
  },

  // 5. Variable Product (Quality Stars: Capacity x Quality Grade)
  {
    category: "Lifting Equipment",
    body: {
      productType: "variable",
      name: "Chain Hoist",
      baseShortName: "CH",
      unit: "pcs",
      description: "Manual chain pulley block with quality rating demo.",
      attributes: [
        { name: "Capacity", unit: "ton", values: ["1", "2"] },
        { name: "Quality", isQuality: true, values: ["3", "5"] },
      ],
    },
    price: (a) => (a.Capacity === "1" ? 9500 : 15000) + (a.Quality === "5" ? 2500 : 0),
    initialStock: 8,
    lowStockThreshold: 3,
  },
];

const PARTIES = [
  {
    type: "CUSTOMER",
    name: "Patel Cranes & Rigging",
    phone: "9879011122",
    email: "contact@patelcranes.in",
    address: "12 GIDC Phase II, Vatva",
    city: "Ahmedabad",
    contactPerson: "Kishan Patel (Director)",
    creditScore: 780,
  },
  {
    type: "CUSTOMER",
    name: "Apex Marine & Offshore Ltd",
    phone: "9825167890",
    email: "procurement@apexmarine.com",
    address: "Jetty No. 3, Hazira Port Road",
    city: "Surat",
    contactPerson: "Capt. R. Menon (Procurement)",
    shippingAddress: "Jetty No. 3, Hazira Port, Surat",
    creditScore: 620,
  },
  {
    type: "SUPPLIER",
    name: "Usha Martin Wire Ropes",
    phone: "9831077788",
    email: "dealer@ushamartin.com",
    address: "Shakespeare Sarani",
    city: "Kolkata",
    contactPerson: "S. K. Mukherjee",
  },
  {
    type: "SUPPLIER",
    name: "Crossbee Industries",
    phone: "9811055566",
    email: "sales@crossbee.in",
    address: "Mayapuri Industrial Area Phase 1",
    city: "Delhi",
    contactPerson: "Amit Bansal (Sales)",
    altPhone: "9811055577",
  },
  {
    type: "BOTH",
    name: "Deccan Lifting Services",
    phone: "9822033344",
    email: "info@deccanlifting.com",
    address: "Shop 7, Bhosari Industrial Area",
    city: "Pune",
    contactPerson: "Vikas Deshmukh",
  },
];

export async function seedThroughApi(call: ReturnType<typeof client>) {
  // 1. Sign in as bootstrap admin
  await call("POST", "/api/auth/login", { email: DEMO_ACCOUNTS[0].email, password: DEMO_PASSWORD });

  // 2. Users: Manager and Staff
  for (const a of DEMO_ACCOUNTS.slice(1)) {
    try {
      await call("POST", "/api/users", { name: a.name, email: a.email, role: a.role, password: DEMO_PASSWORD });
    } catch {
      // User might already exist in company
    }
  }

  // 3. Categories
  const categoryId = new Map<string, string>();
  for (const name of CATEGORIES) {
    const { category } = await call<{ category: { id: string } }>("POST", "/api/categories", { name });
    categoryId.set(name, category.id);
  }

  // 4. Counted Products & Variations
  const all: { variation: Variation; product: Product; price: number; initialStock: number; isInactive?: boolean }[] = [];
  const createdProducts: { id: string; isInactive?: boolean }[] = [];

  for (const p of PRODUCTS) {
    const body: Json = { ...p.body, categoryId: categoryId.get(p.category) };
    if (p.body.productType === "variable" && p.body.attributes) {
      body.variations = cross(p.body.attributes.map((d) => ({ name: d.name, values: [...d.values] }))).map((attributes) => ({
        attributes,
        ...(p.variationSpecs ? { specs: p.variationSpecs(attributes) } : {}),
      }));
    }
    const { product } = await call<{ product: Product }>("POST", "/api/products", body);
    createdProducts.push({ id: product.id, isInactive: p.isInactive });

    for (const v of product.variations) {
      const price = p.price(v.attributes);
      const stock = typeof p.initialStock === "function" ? p.initialStock(v.attributes) : (p.initialStock ?? 20);
      all.push({ variation: v, product, price, initialStock: stock, isInactive: p.isInactive });
    }
  }

  // Prices & Thresholds for Counted Items
  const cost = (price: number) => Math.round(price * 0.75);
  for (const item of all) {
    const pDef = PRODUCTS.find((p) => p.body.name === item.product.name);
    await call("PATCH", `/api/inventory/variations/${item.variation.id}`, {
      salePrice: String(Math.round(item.price)),
      minSalePrice: String(Math.round(item.price * 0.9)),
      purchaseCost: String(cost(item.price)),
      lowStockThreshold: pDef?.lowStockThreshold ?? 5,
    });
  }

  // Opening stock (dated 15 days ago)
  const now = new Date();
  const openingDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15, 9, 30, 0);
  for (const item of all) {
    if (item.initialStock > 0) {
      await call("POST", "/api/inventory/adjustments", {
        variationId: item.variation.id,
        type: "OPENING",
        quantity: item.initialStock,
        reason: "Initial opening stock",
        occurredAt: openingDate.toISOString(),
      });
    }
  }

  // Inactive product archive
  for (const p of createdProducts) {
    if (p.isInactive) {
      await call("PATCH", `/api/products/${p.id}`, { active: false });
    }
  }

  // 5. Parties
  const parties = new Map<string, string>();
  for (const p of PARTIES) {
    const { party } = await call<{ party: { id: string } }>("POST", "/api/parties", p);
    parties.set(p.name, party.id);
  }

  // Helper date builders
  const dToday = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  const dDaysAgo = (days: number, h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, h, m, 0);

  const getVar = (shortName: string) => all.find((x) => x.variation.shortName === shortName) ?? fail(shortName);
  const fail = (s: string): never => {
    throw new Error(`Demo item ${s} not found in catalog; available codes: ${all.map((x) => x.variation.shortName).join(", ")}`);
  };

  // 6. Measured Products (Metric Rope, Metric Chain, Imperial Rope)
  const ropeProduct = await call<{ product: Product }>("POST", "/api/products", {
    productType: "measured",
    name: "Steel Wire Rope 6x19 (Measured)",
    baseShortName: "WR-6X19-M",
    categoryId: categoryId.get("Wire Rope"),
    description: "High tensile galvanized steel wire rope for industrial hoisting. Sold cut to length by the metre.",
    attributes: [{ name: "Diameter", unit: "mm", values: ["8", "10", "16"] }],
    // 0044: the product's specs, then each diameter's own (minimum breaking load).
    specs: [
      { name: "Construction", value: "6x19 + FC" },
      { name: "Tensile grade", value: "1770 N/mm²" },
      { name: "Finish", value: "Galvanised" },
      { name: "Lay", value: "Right hand ordinary" },
    ],
    variations: [
      { attributes: { Diameter: "8" }, defaultRollLength: 500, specs: [{ name: "Min. breaking load", value: "39.9 kN" }, { name: "Weight", value: "0.23 kg/m" }] },
      { attributes: { Diameter: "10" }, defaultRollLength: 500, specs: [{ name: "Min. breaking load", value: "62.3 kN" }, { name: "Weight", value: "0.36 kg/m" }] },
      { attributes: { Diameter: "16" }, defaultRollLength: 300, specs: [{ name: "Min. breaking load", value: "160 kN" }, { name: "Weight", value: "0.92 kg/m" }, { name: "Lay", value: "Right hand Lang's" }] },
    ],
    measure: {
      lengthUnit: "m",
      rollName: "Reel",
      defaultRollLength: 500,
    },
  }).then((r) => r.product);

  const chainProduct = await call<{ product: Product }>("POST", "/api/products", {
    productType: "measured",
    name: "Load Chain Grade 80 (Measured)",
    baseShortName: "LC-G80-M",
    categoryId: categoryId.get("Chains & Fittings"),
    description: "Short link alloy steel lifting chain EN 818-2 sold by length from drums.",
    attributes: [{ name: "Size", unit: "mm", values: ["6", "8"] }],
    variations: [{ attributes: { Size: "6" }, defaultRollLength: 50 }, { attributes: { Size: "8" }, defaultRollLength: 50 }],
    measure: {
      lengthUnit: "m",
      rollName: "Drum",
      defaultRollLength: 50,
    },
  }).then((r) => r.product);

  const impProduct = await call<{ product: Product }>("POST", "/api/products", {
    productType: "measured",
    name: "Stainless Steel Wire Rope (Imperial)",
    baseShortName: "WR-SS-IMP",
    categoryId: categoryId.get("Wire Rope"),
    description: "Grade 316 stainless steel wire rope on reels, measured in feet and inches.",
    attributes: [{ name: "Diameter", unit: "in", values: ["1/2"] }],
    variations: [{ attributes: { Diameter: "1/2" }, defaultRollLength: 14400 }],
    measure: {
      lengthUnit: "ft_in",
      rollName: "Reel",
      defaultRollLength: 14400,
    },
  }).then((r) => r.product);

  const vRope8 = ropeProduct.variations.find((v) => v.attributes.Diameter === "8")!;
  const vRope10 = ropeProduct.variations.find((v) => v.attributes.Diameter === "10")!;
  const vRope16 = ropeProduct.variations.find((v) => v.attributes.Diameter === "16")!;
  const vChain8 = chainProduct.variations.find((v) => v.attributes.Size === "8")!;
  const vImp12 = impProduct.variations.find((v) => v.attributes.Diameter === "1/2")!;

  // Set prices for measured items
  await call("PATCH", `/api/inventory/variations/${vRope8.id}`, { salePrice: "52", purchaseCost: "38", lowStockThreshold: 200 });
  await call("PATCH", `/api/inventory/variations/${vRope10.id}`, { salePrice: "72", purchaseCost: "54", lowStockThreshold: 300 });
  await call("PATCH", `/api/inventory/variations/${vRope16.id}`, { salePrice: "165", purchaseCost: "128", lowStockThreshold: 350 });
  await call("PATCH", `/api/inventory/variations/${vChain8.id}`, { salePrice: "310", purchaseCost: "245", lowStockThreshold: 30 });
  // Feet + inches rates are per ft (0028): ₹48 / ft = ₹4 / in.
  await call("PATCH", `/api/inventory/variations/${vImp12.id}`, { salePrice: "48", purchaseCost: "36", lowStockThreshold: 1200 });

  // 7. Seed Physical Rolls & Pieces (CLOSED, OPEN, CUT, USED_UP)
  // Closed master reel 8mm
  await call("POST", `/api/measure/variations/${vRope8.id}/rolls`, {
    rolls: [{ length: 500, rack: "A-01", supplierRollNo: "UM-8MM-01" }],
    note: "Initial stock reel",
  });

  // Open roll 10mm (310m remaining), with 2 cut offcut pieces (22.5m, 4.2m)
  const r10 = await call<{ pieces: { id: string }[] }>("POST", `/api/measure/variations/${vRope10.id}/rolls`, {
    rolls: [{ length: 500, rack: "A-02", supplierRollNo: "UM-10MM-OPEN" }],
  });
  if (r10.pieces[0]) {
    await call("POST", `/api/measure/pieces/${r10.pieces[0].id}/cut`, {
      lengths: [22.5, 4.2],
      reason: "Pre-cut slings for stock",
    });
  }

  // 16mm reel (300m available - shortage target!)
  await call("POST", `/api/measure/variations/${vRope16.id}/rolls`, {
    rolls: [{ length: 300, rack: "A-04", supplierRollNo: "UM-16MM-01" }],
  });

  // Load Chain drums (1 closed 50m, 1 open 36.4m)
  await call("POST", `/api/measure/variations/${vChain8.id}/rolls`, {
    rolls: [
      { length: 50, rack: "C-02", supplierRollNo: "CB-G80-01" },
      { length: 36.4, rack: "C-02", supplierRollNo: "CB-G80-OPEN" },
    ],
  });

  // Imperial Reel (14,400 in)
  await call("POST", `/api/measure/variations/${vImp12.id}/rolls`, {
    rolls: [{ length: 14400, rack: "R-03", supplierRollNo: "IMP-12-REEL" }],
  });

  // Used up / scrap write-off demo piece
  const scrapRoll = await call<{ pieces: { id: string }[] }>("POST", `/api/measure/variations/${vChain8.id}/rolls`, {
    rolls: [{ length: 0.5, rack: "SCRAP-BIN", supplierRollNo: "OFFCUT-SCRAP" }],
  });
  if (scrapRoll.pieces[0]) {
    await call("POST", `/api/measure/pieces/${scrapRoll.pieces[0].id}/write-off`, {
      reason: "Twisted damaged link end — non-usable scrap",
    });
  }

  // 7b. V3.1 grouped product (set): Chain Hoist Set = Hoist Body (main, new) + Load Chain
  // (required, measured) + Safety Hook (optional, created inline) + a second Load Chain link,
  // "Hand chain" (optional, 0040: the same product twice, each with its own size/length per
  // set). Three admin opening sets; the first has both chains.
  const vChain6 = chainProduct.variations.find((v) => v.attributes.Size === "6")!;
  await call("PATCH", `/api/inventory/variations/${vChain6.id}`, { salePrice: "240", purchaseCost: "185", lowStockThreshold: 20 });
  await call("POST", `/api/measure/variations/${vChain6.id}/rolls`, {
    rolls: [{ length: 50, rack: "C-03", supplierRollNo: "CB-G80-6MM-01" }],
  });
  const hoistSet = await call<{ product: Product & { grouped: { byproducts: { id: string; name: string; variations: { id: string; attributes: Record<string, string> }[] }[] } } }>(
    "POST",
    "/api/products",
    {
      productType: "grouped",
      name: "Chain Hoist Set",
      shortName: "CHS",
      unit: "Set",
      categoryId: categoryId.get(PRODUCTS.find((p) => p.body.name === "Chain Hoist")!.category),
      description: "Manual chain hoist sold as a set: hoist body with load chain fitted to length, safety hook optional.",
      specs: [
        { name: "Capacity", value: "1 t" },
        { name: "Hand pull at full load", value: "31 kg" },
        { name: "Standard", value: "EN 13157" },
      ],
      main: { name: "Hoist Body 1 Ton", shortName: "HB-1T", unit: "Nos" },
      byproducts: [
        { productId: chainProduct.id, required: true, label: "Load chain" },
        { newProduct: { productType: "simple", name: "Safety Hook 1 Ton", unit: "Nos", shortName: "SH-1T", categoryId: categoryId.get("Chains & Fittings") }, required: false },
        { productId: chainProduct.id, required: false, label: "Hand chain" },
      ],
    },
  ).then((r) => r.product);
  const [linkChain, linkHook, linkHandChain] = hoistSet.grouped.byproducts as [
    (typeof hoistSet.grouped.byproducts)[number],
    (typeof hoistSet.grouped.byproducts)[number],
    (typeof hoistSet.grouped.byproducts)[number],
  ];
  const hookVariationId = linkHook.variations[0]!.id;
  // 0041: no price on the grouped product itself; prices and minimum stock are per set type.
  await call("PATCH", `/api/inventory/variations/${hookVariationId}`, { salePrice: "450", minSalePrice: "400", purchaseCost: "320", lowStockThreshold: 2 });
  // A few loose hooks too (free stock beside the ones fitted in sets).
  await call("POST", "/api/inventory/adjustments", { variationId: hookVariationId, type: "OPENING", quantity: 4, reason: "Initial opening stock", occurredAt: openingDate.toISOString() });
  const chain = (size: string) => linkChain.variations.find((v) => v.attributes.Size === size)!.id;
  const { sets: openingSets } = await call<{ sets: { id: string }[] }>("POST", "/api/sets/opening", {
    groupId: hoistSet.id,
    date: openingDate.toISOString(),
    sets: [
      {
        rate: "6600",
        notes: "Load chain + hand chain fitted",
        // 0041: the Add sets sheet sets this set type's prices.
        salePrice: "9800",
        minSalePrice: "9200",
        lowStockThreshold: 0,
        parts: [
          { byproductId: linkChain.id, variationId: chain("8"), length: 3 },
          { byproductId: linkHook.id, variationId: hookVariationId },
          { byproductId: linkHandChain.id, variationId: chain("6"), length: 6 },
        ],
      },
      { rate: "7400", parts: [{ byproductId: linkChain.id, variationId: chain("8"), length: 4.5 }] },
      { rate: "5800", notes: "Lighter chain for workshop use", parts: [{ byproductId: linkChain.id, variationId: chain("6"), length: 3 }, { byproductId: linkHook.id, variationId: hookVariationId }] },
    ],
  });

  // 7c. 0041 standard sets of the Chain Hoist Set (product form step 4), each with its own
  // selling price, minimum selling price and minimum stock. "Long 4.5 m" and "Workshop 6 mm"
  // match opening sets above; "Standard 3 m + hook" starts at 0 and Stock In raises it to 1
  // (the set is built from its parts as new stock).
  await call("PUT", `/api/sets/types/${hoistSet.id}/standard`, {
    sets: [
      {
        name: "Standard 3 m + hook",
        parts: [{ byproductId: linkChain.id, variationId: chain("8"), length: 3 }, { byproductId: linkHook.id, variationId: hookVariationId }],
        salePrice: "8500",
        minSalePrice: "7800",
        lowStockThreshold: 1,
        // 0044: shown after the product's rows when this set is picked on the product page.
        specs: [{ name: "Lifting height", value: "3 m" }, { name: "Load chain", value: "8 mm Grade 80" }, { name: "Safety hook", value: "Included" }],
      },
      {
        name: "Long 4.5 m",
        parts: [{ byproductId: linkChain.id, variationId: chain("8"), length: 4.5 }],
        salePrice: "9200",
        minSalePrice: "8600",
        lowStockThreshold: 1,
        specs: [{ name: "Lifting height", value: "4.5 m" }, { name: "Load chain", value: "8 mm Grade 80" }],
      },
      {
        name: "Workshop 6 mm",
        parts: [{ byproductId: linkChain.id, variationId: chain("6"), length: 3 }, { byproductId: linkHook.id, variationId: hookVariationId }],
        salePrice: "6900",
        minSalePrice: "6400",
        lowStockThreshold: 0,
        specs: [{ name: "Capacity", value: "0.5 t" }, { name: "Lifting height", value: "3 m" }, { name: "Load chain", value: "6 mm Grade 80" }],
      },
    ],
  });
  const { types: hoistTypes } = await call<{ types: { typeKey: string; name: string | null; count: number }[] }>("GET", `/api/sets/types/${hoistSet.id}`);
  const std3m = hoistTypes.find((t) => t.name === "Standard 3 m + hook")!;
  await call("POST", `/api/sets/types/${hoistSet.id}/stock-in`, { reason: "Opening Stock", rows: [{ typeKey: std3m.typeKey, expectedCount: std3m.count, count: 1 }] });
  // V3.2 A2: a saved child-row order (Workshop 6 mm first), the same on Stock In and Products.
  const workshop = hoistTypes.find((t) => t.name === "Workshop 6 mm")!;
  await call("PUT", `/api/sets/types/${hoistSet.id}/order`, { typeKeys: [workshop.typeKey, ...hoistTypes.filter((t) => t !== workshop).map((t) => t.typeKey)] });

  // 8. Purchases (2 total: 1 counted, 1 measured rolls)
  // Purchase 1: Counted items from Crossbee
  const gcVar = all.find((x) => x.variation.attributes.Size === "10" && x.variation.attributes["Rope Construction"] === "6x24")!;
  await call("POST", "/api/purchases", {
    partyId: parties.get("Crossbee Industries"),
    date: dDaysAgo(5, 10, 15).toISOString(),
    notes: "PO-2026-OCT-010 — Heavy girder clamps batch import",
    clientRef: randomUUID(),
    paymentMode: "BANK_TRANSFER",
    lines: [{ variationId: gcVar.variation.id, quantity: 20, price: "800" }],
  });

  // Purchase 2: Measured rolls from Usha Martin
  await call("POST", "/api/purchases", {
    partyId: parties.get("Usha Martin Wire Ropes"),
    date: dDaysAgo(3, 11, 0).toISOString(),
    notes: "PO-2026-OCT-048 — Two 10mm wire rope master reels",
    clientRef: randomUUID(),
    paymentMode: "BANK_TRANSFER",
    lines: [
      {
        variationId: vRope10.id,
        price: "54",
        rolls: [
          { length: 500, supplierRollNo: "UM-26-9101", rack: "A-02" },
          { length: 500, supplierRollNo: "UM-26-9102", rack: "A-02" },
        ],
      },
    ],
  });

  // Purchase 3 (owner 2026-10-30): a custom Chain Hoist Set (8 mm × 6 m + hook) bought from a
  // supplier becomes a standard set of the product, listed after the three on the product form.
  await call("POST", "/api/purchases", {
    partyId: parties.get("Crossbee Industries"),
    date: dDaysAgo(2, 12, 0).toISOString(),
    notes: "PO-2026-OCT-061 — Long-lift chain hoist set",
    clientRef: randomUUID(),
    paymentMode: "BANK_TRANSFER",
    lines: [
      {
        variationId: hoistSet.variations[0]!.id,
        price: "8200",
        sets: [{ parts: [{ byproductId: linkChain.id, variationId: chain("8"), length: 6 }, { byproductId: linkHook.id, variationId: hookVariationId }] }],
      },
    ],
  });

  // 9. Sales (all kinds)
  // Sale 1: Counted items to Customer (CREDIT)
  await call("POST", "/api/sales", {
    partyId: parties.get("Patel Cranes & Rigging"),
    date: dDaysAgo(4, 11, 30).toISOString(),
    notes: "Regular account billing — Girder clamps pickup",
    clientRef: randomUUID(),
    paymentMode: "CREDIT",
    lines: [{ variationId: gcVar.variation.id, quantity: 2, price: "1150" }],
  });

  // Sale 2: Measured cut length to Customer (BANK_TRANSFER)
  await call("POST", "/api/sales", {
    partyId: parties.get("Patel Cranes & Rigging"),
    date: dDaysAgo(2, 14, 20).toISOString(),
    notes: "Crane yard re-roping — cut to 150m continuous length",
    clientRef: randomUUID(),
    paymentMode: "BANK_TRANSFER",
    amountPaid: "10800",
    lines: [{ variationId: vRope10.id, quantity: 150.0, price: "72" }],
  });

  // Sale 3: Counter Walk-in Cash Sale (Party: null, CASH)
  const ehVar = getVar("EH-1T");
  await call("POST", "/api/sales", {
    partyId: null,
    date: dDaysAgo(1, 12, 10).toISOString(),
    notes: "Counter cash pickup — 1 electric hoist & 13.3m rope length",
    clientRef: randomUUID(),
    paymentMode: "CASH",
    lines: [
      { variationId: ehVar.variation.id, quantity: 1, price: "45000" },
      { variationId: vRope10.id, quantity: 13.3, price: "72" },
    ],
  });

  // Sale 4: Voided / Cancelled Sale (Demonstrating void audit and roll length restoration)
  const voidSale = await call<{ id: string }>("POST", "/api/sales", {
    partyId: parties.get("Apex Marine & Offshore Ltd"),
    date: dToday(10, 15).toISOString(),
    notes: "Sling fabrication for Bay 3 — customer cut order",
    clientRef: randomUUID(),
    paymentMode: "CASH",
    lines: [{ variationId: vRope10.id, quantity: 18.0, price: "72" }],
  });
  await call("POST", `/api/sales/${voidSale.id}/void`, {
    reason: "Customer changed boom length specification from 18m to 25m",
  });

  // Sale 5: Out of stock clearance for Beam Clamp (bring stock to 0)
  const bcVar = getVar("BC-2T");
  const bcBal = await prisma.stockMovement.aggregate({
    where: { variationId: bcVar.variation.id },
    _sum: { quantity: true },
  }).then((r) => Number(r._sum.quantity ?? 0));
  if (bcBal > 0) {
    await call("POST", "/api/sales", {
      partyId: parties.get("Deccan Lifting Services"),
      date: dToday(11, 0).toISOString(),
      notes: "Project bulk clearance — bought entire remaining balance of beam clamps",
      clientRef: randomUUID(),
      paymentMode: "UPI",
      lines: [{ variationId: bcVar.variation.id, quantity: bcBal, price: "3200" }],
    });
  }

  // Sale 6 (V3.2): a set sold, then edited — the customer asked for a safety hook, so the
  // revision adds one from the loose hooks and reprices the set (+ hook sale price, D12).
  const setSale = await call<{ id: string; number: string }>("POST", "/api/sales", {
    partyId: parties.get("Apex Marine & Offshore Ltd"),
    date: dToday(11, 30).toISOString(),
    notes: "Chain hoist set for the jetty crane",
    clientRef: randomUUID(),
    paymentMode: "UPI",
    lines: [{ variationId: hoistSet.variations[0]!.id, price: "8500", saleSets: [{ setId: openingSets[1]!.id }] }],
  });
  await call("POST", `/api/sales/${setSale.id}/edit`, {
    reason: "Customer asked for a safety hook on the set",
    expectedNumber: setSale.number,
    clientRef: randomUUID(),
    partyId: parties.get("Apex Marine & Offshore Ltd"),
    notes: "Chain hoist set for the jetty crane — safety hook fitted",
    paymentMode: "UPI",
    lines: [{ variationId: hoistSet.variations[0]!.id, price: "8950", saleSets: [{ setId: openingSets[1]!.id, changes: [{ byproductId: linkHook.id, action: "ADD", variationId: hookVariationId }] }] }],
  });

  // 10. Orders (5 total: covering all kinds & shortage/procurement flow)
  // SO 1: PLACED (Open Sales Order)
  const chVar = all.find((x) => x.variation.attributes.Capacity === "1" && x.variation.attributes.Quality === "5")!;
  await call("POST", "/api/orders", {
    kind: "SALE",
    status: "PLACED",
    partyId: parties.get("Patel Cranes & Rigging"),
    notes: "Yard overhaul requirement — delivery by next Tuesday",
    expectedDate: "2026-10-22",
    clientRef: randomUUID(),
    lines: [
      { variationId: ehVar.variation.id, quantity: 1, price: "45000", note: "1T electric hoist" },
      { variationId: chVar.variation.id, quantity: 2, price: "12000", note: "1T 5-star manual chain hoist" },
    ],
  });

  // SO 2: ON_DELIVERY (Out for delivery)
  const so2 = await call<{ id: string }>("POST", "/api/orders", {
    kind: "SALE",
    status: "PLACED",
    partyId: parties.get("Deccan Lifting Services"),
    notes: "Dispatched via local transport tempo (MH-12-AB-3456)",
    expectedDate: "2026-10-18",
    deliveryAddress: "Shop 7, Bhosari Industrial Area, Pune",
    clientRef: randomUUID(),
    lines: [{ variationId: gcVar.variation.id, quantity: 5, price: "1150" }],
  });
  await call("POST", `/api/orders/${so2.id}/status`, {
    to: "ON_DELIVERY",
    note: "Dispatched via local transport tempo (MH-12-AB-3456)",
    version: 1,
  });

  // SO 3: SHORTAGE DEMO (650m requirement vs 300m roll in stock)
  const soShortage = await call<{ id: string }>("POST", "/api/orders", {
    kind: "SALE",
    status: "PLACED",
    partyId: parties.get("Apex Marine & Offshore Ltd"),
    notes: "Offshore mooring line — single continuous 650m length for winch drum",
    expectedDate: "2026-10-25",
    deliveryAddress: "Jetty No. 3, Hazira Port Road, Surat",
    deliveryNote: "Mill test certificate required with Lloyd's inspection stamp",
    clientRef: randomUUID(),
    lines: [
      {
        variationId: vRope16.id,
        quantity: 650.0,
        price: "165",
        note: "Single continuous 650m length (must NOT be spliced)",
      },
    ],
  });

  const soDetail = await call<any>("GET", `/api/orders/${soShortage.id}`);
  const shortageLineId = soDetail?.order?.lines?.[0]?.id ?? soDetail?.lines?.[0]?.id ?? null;

  // PO 1: Procurement PO linked to SO 3 shortage
  await call("POST", "/api/orders", {
    kind: "PURCHASE",
    status: "PLACED",
    partyId: parties.get("Usha Martin Wire Ropes"),
    notes: `Procurement for offshore mooring order (linked to SO #${soShortage.id.slice(-6)})`,
    expectedDate: "2026-10-24",
    clientRef: randomUUID(),
    lines: [
      {
        variationId: vRope16.id,
        quantity: 700.0,
        price: "128",
        note: "Special factory reel: 700m continuous length for Apex Marine order",
        rolls: [{ length: 700, rack: "A-04", supplierRollNo: "UM-PO-650-REQ" }],
        linkedOrderId: soShortage.id,
        linkedOrderLineId: shortageLineId,
      },
    ],
  });

  // PO 2: DRAFT PO
  await call("POST", "/api/orders", {
    kind: "PURCHASE",
    status: "DRAFT",
    partyId: parties.get("Crossbee Industries"),
    notes: "Next Crossbee batch order — 8mm load chains restock",
    expectedDate: "2026-10-28",
    clientRef: randomUUID(),
    lines: [
      {
        variationId: vChain8.id,
        quantity: 100.0,
        price: "245",
        rolls: [{ length: 50, rack: "C-02" }, { length: 50, rack: "C-02" }],
      },
    ],
  });

  // 11. Supplier Rates (Vendor Prices with revision history)
  const gcVar8 = all.find((x) => x.variation.attributes.Size === "8" && x.variation.attributes["Rope Construction"] === "6x19")!;
  const rateCards: [Variation, string, number[]][] = [
    [gcVar8.variation, "Crossbee Industries", [610, 595]], // Rate revision history!
    [vRope10, "Usha Martin Wire Ropes", [56, 54]], // Rate revision history!
    [vRope10, "Crossbee Industries", [52]],
    [ehVar.variation, "Crossbee Industries", [36000]],
    // Second and third quotes for Vendor Pricing > By product (best rate and spread).
    [gcVar8.variation, "Usha Martin Wire Ropes", [620]],
    [ehVar.variation, "Deccan Lifting Services", [37500]],
    [vChain8, "Crossbee Industries", [245]],
    [vChain8, "Deccan Lifting Services", [262]],
  ];
  for (const [v, supplierName, rates] of rateCards) {
    const sId = parties.get(supplierName);
    if (!sId) continue;
    for (const [k, rate] of rates.entries()) {
      await call("PUT", "/api/vendor-prices", {
        variationId: v.id,
        supplierId: sId,
        rate: String(rate),
        notes: k === 0 ? "Annual contract rate" : "Revised quarterly rate",
      });
    }
  }
  // A paused quote: shown on the product rate sheet, never counted as the best rate.
  const deccanId = parties.get("Deccan Lifting Services");
  if (deccanId) {
    await call("PUT", "/api/vendor-prices", { variationId: vRope10.id, supplierId: deccanId, rate: "50", active: false, notes: "Quote on hold" });
  }

  // 12. Drafts (Held Carts)
  await call("POST", "/api/drafts", {
    mode: "SALE",
    title: "Patel Cranes — Waiting for site boom confirmation",
    partyId: parties.get("Patel Cranes & Rigging"),
    notes: "Site engineer inspecting boom height on site today afternoon",
    lines: [{ variationId: vRope10.id, quantity: 85.0, price: "72", note: "85m cut length requested" }],
  });

  await call("POST", "/api/drafts", {
    mode: "PURCHASE",
    title: "Next Crossbee order — confirm on Monday",
    partyId: parties.get("Crossbee Industries"),
    notes: "Checking volume discount for girder clamps and load chain",
    lines: [
      { variationId: gcVar.variation.id, quantity: 20, price: "800" },
      { variationId: vChain8.id, quantity: 50, price: "245" },
    ],
  });

  // 12. Category heads (V3.1, 0033): extra ways to group products; one product in many categories.
  const { products: listed } = await call<{ products: { id: string; name: string }[] }>("GET", "/api/products?status=all&pageSize=200");
  const productIdOf = (name: string) => listed.find((p) => p.name === name)?.id ?? fail(name);
  let headCategories = 0;
  let variationCategories = 0;
  for (const head of CATEGORY_HEADS) {
    const { head: h } = await call<{ head: { id: string } }>("POST", "/api/category-heads", { name: head.name });
    for (const c of head.categories) {
      const { category } = await call<{ category: { id: string } }>("POST", "/api/categories", { name: c.name, headId: h.id });
      headCategories++;
      if (c.products.length) await call("POST", `/api/categories/${category.id}/products`, { productIds: c.products.map(productIdOf) });
      // 0038: a category on chosen variations only (by attribute value).
      for (const v of "variations" in c ? c.variations : []) {
        const { product } = await call<{ product: { variations: { id: string; attributes: Record<string, string> }[] } }>("GET", `/api/products/${productIdOf(v.product)}`);
        const variationIds = product.variations.filter((x) => Object.values(x.attributes).some((a) => (v.values as readonly string[]).includes(a))).map((x) => x.id);
        await call("POST", `/api/categories/${category.id}/products`, { productId: productIdOf(v.product), variationIds });
        variationCategories += variationIds.length;
      }
    }
  }

  // 13. Warehouses (V3.1, 0035; docs\WAREHOUSE-V3-PLAN.md owner decision 9). The first warehouse
  // takes all stock above; the Shop starts empty and is stocked by a split purchase and shifts.
  const { warehouse: w1 } = await call<{ warehouse: { id: string } }>("POST", "/api/warehouses", { code: "W1", name: "Main Godown", address: "Plot 14, MIDC Bhosari, Pune" });
  const { warehouse: w2 } = await call<{ warehouse: { id: string } }>("POST", "/api/warehouses", { code: "W2", name: "Shop", address: "Counter, Nashik Phata, Pune" });
  await call("POST", "/api/purchases", {
    partyId: parties.get("Crossbee Industries"),
    clientRef: randomUUID(),
    paymentMode: "CREDIT",
    notes: "Split delivery: half to the shop counter",
    lines: [{ variationId: ehVar.variation.id, quantity: 4, price: "34000", splits: [{ warehouseId: w1.id, quantity: 2 }, { warehouseId: w2.id, quantity: 2 }] }],
  });
  const chainPieces = await call<{ variations: { id: string; pieces: { id: string; kind: string; status: string }[] }[] }>("GET", `/api/measure/products/${chainProduct.id}/pieces`);
  const shopRoll = chainPieces.variations.find((v) => v.id === vChain8.id)!.pieces.find((p) => p.kind === "CLOSED" && p.status === "ACTIVE");
  const { sets: hoistSets } = await call<{ sets: { id: string }[] }>("GET", `/api/sets?groupId=${hoistSet.id}`);
  await call("POST", "/api/transfers", {
    fromWarehouseId: w1.id,
    toWarehouseId: w2.id,
    clientRef: randomUUID(),
    notes: "Shop display stock",
    lines: [
      { variationId: gcVar.variation.id, quantity: 2 },
      ...(shopRoll ? [{ pieceId: shopRoll.id }] : []),
      ...(hoistSets[0] ? [{ setId: hoistSets[0].id }] : []),
    ],
  });
  const wrongShift = await call<{ transfer: { id: string } }>("POST", "/api/transfers", {
    fromWarehouseId: w1.id,
    toWarehouseId: w2.id,
    clientRef: randomUUID(),
    lines: [{ variationId: ehVar.variation.id, quantity: 1 }],
  });
  await call("POST", `/api/transfers/${wrongShift.transfer.id}/cancel`, { reason: "Shifted the wrong hoist model" });
  await call("POST", "/api/sales", {
    partyId: parties.get("Patel Cranes & Rigging"),
    clientRef: randomUUID(),
    paymentMode: "UPI",
    notes: "One hoist from the godown, one from the shop counter",
    lines: [{ variationId: ehVar.variation.id, quantity: 2, price: "45000", splits: [{ warehouseId: w1.id, quantity: 1 }, { warehouseId: w2.id, quantity: 1 }] }],
  });
  await call("POST", "/api/orders", {
    kind: "SALE",
    status: "PLACED",
    partyId: parties.get("Patel Cranes & Rigging"),
    notes: "Take-from chosen for the hoist; the clamp is decided at delivery",
    lines: [
      { variationId: ehVar.variation.id, quantity: 1, price: "45000", splits: [{ warehouseId: w2.id, quantity: 1 }] },
      { variationId: gcVar.variation.id, quantity: 1, price: "1200" },
    ],
  });

  await call("POST", "/api/auth/logout");

  return {
    categories: CATEGORIES.length,
    categoryHeads: CATEGORY_HEADS.length,
    headCategories,
    variationCategories,
    products: PRODUCTS.length + 5,
    variations: all.length + 9,
    groupedSets: 4,
    standardSets: 3,
    warehouses: 2,
    shifts: 2,
    parties: parties.size,
    purchases: 3,
    sales: 6,
    orders: 6,
    drafts: 2,
    rateCards: rateCards.length,
  };
}
