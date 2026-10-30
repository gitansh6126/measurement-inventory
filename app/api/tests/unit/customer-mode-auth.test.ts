import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/auth.js";
import { customerModeScrub } from "../../src/lib/products.js";

describe("Customer Mode staff verification", () => {
  it("verifies staff passwords correctly", async () => {
    const rawPassword = "StaffSecretPassword123!";
    const hash = await hashPassword(rawPassword);

    expect(await verifyPassword(rawPassword, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  }, 15000);
});

describe("Customer Mode data scrubbing", () => {
  it("scrubs commercial pricing, warehouse info, sales activity and exact stock", () => {
    const rawProduct = {
      id: "prod_1",
      name: "Industrial Brass Valve",
      purchaseCost: "450.00",
      salePrice: "750.00",
      minSalePrice: "650.00",
      priceMin: "650.00",
      priceMax: "850.00",
      costMin: "400.00",
      costMax: "500.00",
      stockValue: "42000.00",
      totalStockValue: "42000.00",
      activityStatus: "Active",
      lastSaleAt: "2026-10-25T10:00:00Z",
      saleCount30d: 15,
      quantity: 56,
      lowStockThreshold: 10,
      state: "ok",
      byWarehouse: [{ warehouseId: "wh_1", quantity: 56 }],
      variations: [
        {
          id: "var_1",
          shortName: "IBV-20MM",
          purchaseCost: "450.00",
          salePrice: "750.00",
          minSalePrice: "650.00",
          quantity: 26,
          lowStockThreshold: 5,
          state: "ok",
          byWarehouse: [{ warehouseId: "wh_1", quantity: 26 }],
          rolls: [{ length: 50 }],
          pieces: [{ pieceId: "p_1", length: 26 }],
        },
        {
          id: "var_2",
          shortName: "IBV-25MM",
          purchaseCost: "550.00",
          salePrice: "900.00",
          minSalePrice: "800.00",
          quantity: 0,
          lowStockThreshold: 5,
          state: "out",
          byWarehouse: [],
        },
      ],
      grouped: {
        byproducts: [
          {
            id: "child_1",
            name: "Fitting Gasket",
            variations: [
              {
                id: "child_var_1",
                salePrice: "50.00",
                purchaseCost: "20.00",
                quantity: 100,
                byWarehouse: [{ warehouseId: "wh_1", quantity: 100 }],
              },
            ],
          },
        ],
      },
    };

    const scrubbed = customerModeScrub(rawProduct);

    // 1. Commercial prices stripped
    expect(scrubbed).not.toHaveProperty("purchaseCost");
    expect(scrubbed).not.toHaveProperty("salePrice");
    expect(scrubbed).not.toHaveProperty("minSalePrice");
    expect(scrubbed).not.toHaveProperty("priceMin");
    expect(scrubbed).not.toHaveProperty("priceMax");
    expect(scrubbed).not.toHaveProperty("costMin");
    expect(scrubbed).not.toHaveProperty("costMax");
    expect(scrubbed).not.toHaveProperty("stockValue");
    expect(scrubbed).not.toHaveProperty("totalStockValue");

    // 2. Sales activity stripped
    expect(scrubbed).not.toHaveProperty("activityStatus");
    expect(scrubbed).not.toHaveProperty("lastSaleAt");
    expect(scrubbed).not.toHaveProperty("saleCount30d");

    // 3. Warehouse info stripped
    expect(scrubbed).not.toHaveProperty("byWarehouse");
    expect(scrubbed).not.toHaveProperty("warehouseId");

    // 4. Exact stock stripped and converted to safe binary presence
    expect(scrubbed.inStock).toBe(true);
    expect(scrubbed.quantity).toBe(1);
    expect(scrubbed).not.toHaveProperty("lowStockThreshold");

    // 5. Variations scrubbed
    expect(scrubbed.variations[0]).not.toHaveProperty("purchaseCost");
    expect(scrubbed.variations[0]).not.toHaveProperty("salePrice");
    expect(scrubbed.variations[0]).not.toHaveProperty("minSalePrice");
    expect(scrubbed.variations[0]).not.toHaveProperty("byWarehouse");
    expect(scrubbed.variations[0]).not.toHaveProperty("rolls");
    expect(scrubbed.variations[0]).not.toHaveProperty("pieces");
    expect(scrubbed.variations[0].inStock).toBe(true);
    expect(scrubbed.variations[0].quantity).toBe(1);

    expect(scrubbed.variations[1].inStock).toBe(false);
    expect(scrubbed.variations[1].quantity).toBe(0);
    expect(scrubbed.variations[1].state).toBe("out");

    // 6. Nested grouped byproducts scrubbed
    const childVar = scrubbed.grouped.byproducts[0].variations[0];
    expect(childVar).not.toHaveProperty("salePrice");
    expect(childVar).not.toHaveProperty("purchaseCost");
    expect(childVar).not.toHaveProperty("byWarehouse");
    expect(childVar.inStock).toBe(true);
    expect(childVar.quantity).toBe(1);
  });
});
