// RS Machinery V3 - Realistic Prototype Sample Domain Data
// Domain: Industrial Machinery, Hardware, Wire Ropes, Bearings, Transmission Belts, Measured Rolls

window.PROTOTYPE_DATA = {
  company: {
    id: "comp_rs_01",
    name: "RS Machinery Store",
    negativeStockPolicy: "WARN_AND_ALLOW",
    currency: "₹",
    phone: "+91 98765 43210",
    email: "contact@rsmachinery.example",
    address: "Plot 42, Industrial Area Phase II, Mayapuri, New Delhi - 110064",
    gstin: "07AAAAA0000A1Z5"
  },

  currentUser: {
    id: "usr_admin",
    name: "Rajesh Sharma",
    email: "admin@rsmachinery.demo",
    role: "admin", // admin | sales_manager | sales_staff
    permissions: [
      "catalog.view", "product.write", "inventory.configure", "stock.adjust",
      "sale.view", "sale.create", "sale.edit", "sale.void",
      "purchase.view", "purchase.create", "purchase.edit", "purchase.void",
      "party.view", "party.create", "party.edit",
      "vendor_pricing.view", "vendor_pricing.manage",
      "user.manage", "company.settings"
    ]
  },

  users: [
    { id: "usr_admin", name: "Rajesh Sharma", email: "admin@rsmachinery.demo", role: "admin", active: true },
    { id: "usr_mgr", name: "Sunil Verma", email: "manager@rsmachinery.demo", role: "sales_manager", active: true },
    { id: "usr_staff", name: "Amit Kumar", email: "staff@rsmachinery.demo", role: "sales_staff", active: true },
    { id: "usr_inactive", name: "Pooja Singh", email: "pooja@rsmachinery.demo", role: "sales_staff", active: false }
  ],

  categories: [
    { id: "cat_ropes", name: "Wire Ropes & Cables", sortOrder: 1, active: true, count: 12 },
    { id: "cat_bearings", name: "Ball & Roller Bearings", sortOrder: 2, active: true, count: 18 },
    { id: "cat_belts", name: "V-Belts & Pulleys", sortOrder: 3, active: true, count: 15 },
    { id: "cat_rigging", name: "Hardware & Rigging", sortOrder: 4, active: true, count: 9 },
    { id: "cat_rolls", name: "Industrial Canvas & Webbing", sortOrder: 5, active: true, count: 6 }
  ],

  products: [
    {
      id: "prod_01",
      name: "Steel Wire Rope 6x19 (Galvanized)",
      productType: "variable",
      baseShortName: "ROPE",
      categoryId: "cat_ropes",
      categoryName: "Wire Ropes & Cables",
      unit: "Meter",
      description: "High-grade galvanized steel wire rope, fiber core (FC) 6x19 construction for hoists, cranes and winches.",
      activityStatus: "Active",
      attributes: [
        { name: "Size", unit: "mm", values: ["6mm", "8mm", "10mm", "12mm"], abbrMap: { "6mm": "6", "8mm": "8", "10mm": "10", "12mm": "12" } },
        { name: "Brand", unit: "", values: ["Crossbee", "Halfen", "Usha Martin"], abbrMap: { "Crossbee": "CB", "Halfen": "HF", "Usha Martin": "UM" } },
        { name: "Quality", unit: "", isQuality: true, values: ["3", "4", "5"], abbrMap: { "3": "3S", "4": "4S", "5": "5S" }, stars: [3, 4, 5] }
      ],
      variations: [
        {
          id: "var_rope_8_cb_4",
          shortName: "8-CB-4S-ROPE",
          officialSku: "ROPE-8-CB-4S",
          attributes: { "Size": "8mm", "Brand": "Crossbee", "Quality": "4" },
          stock: 450,
          lowStockThreshold: 100,
          salePrice: 95,
          minSalePrice: 85,
          purchaseCost: 65,
          active: true,
          sortOrder: 1
        },
        {
          id: "var_rope_10_cb_4",
          shortName: "10-CB-4S-ROPE",
          officialSku: "ROPE-10-CB-4S",
          attributes: { "Size": "10mm", "Brand": "Crossbee", "Quality": "4" },
          stock: 120,
          lowStockThreshold: 150,
          salePrice: 140,
          minSalePrice: 125,
          purchaseCost: 98,
          active: true,
          sortOrder: 2
        },
        {
          id: "var_rope_12_um_5",
          shortName: "12-UM-5S-ROPE",
          officialSku: "ROPE-12-UM-5S",
          attributes: { "Size": "12mm", "Brand": "Usha Martin", "Quality": "5" },
          stock: 0,
          lowStockThreshold: 80,
          salePrice: 220,
          minSalePrice: 200,
          purchaseCost: 160,
          active: true,
          sortOrder: 3
        },
        {
          id: "var_rope_6_hf_3",
          shortName: "6-HF-3S-ROPE",
          officialSku: "ROPE-6-HF-3S",
          attributes: { "Size": "6mm", "Brand": "Halfen", "Quality": "3" },
          stock: 800,
          lowStockThreshold: 200,
          salePrice: 65,
          minSalePrice: 58,
          purchaseCost: 42,
          active: true,
          sortOrder: 4
        }
      ]
    },
    {
      id: "prod_02",
      name: "Deep Groove Ball Bearing 6200 Series",
      productType: "variable",
      baseShortName: "BRG",
      categoryId: "cat_bearings",
      categoryName: "Ball & Roller Bearings",
      unit: "Piece",
      description: "Precision deep groove ball bearing with dual rubber seals (2RS) or metal shields (ZZ).",
      activityStatus: "Active",
      attributes: [
        { name: "Model", unit: "", values: ["6204", "6205", "6306"], abbrMap: { "6204": "6204", "6205": "6205", "6306": "6306" } },
        { name: "Seal", unit: "", values: ["2RS (Rubber)", "ZZ (Metal)"], abbrMap: { "2RS (Rubber)": "2RS", "ZZ (Metal)": "ZZ" } },
        { name: "Brand", unit: "", values: ["SKF", "FAG", "NBC"], abbrMap: { "SKF": "SKF", "FAG": "FAG", "NBC": "NBC" } }
      ],
      variations: [
        {
          id: "var_brg_6204_2rs_skf",
          shortName: "6204-2RS-SKF-BRG",
          officialSku: "BRG-6204-2RS-SKF",
          attributes: { "Model": "6204", "Seal": "2RS (Rubber)", "Brand": "SKF" },
          stock: 65,
          lowStockThreshold: 25,
          salePrice: 185,
          minSalePrice: 165,
          purchaseCost: 120,
          active: true,
          sortOrder: 1
        },
        {
          id: "var_brg_6205_zz_fag",
          shortName: "6205-ZZ-FAG-BRG",
          officialSku: "BRG-6205-ZZ-FAG",
          attributes: { "Model": "6205", "Seal": "ZZ (Metal)", "Brand": "FAG" },
          stock: 14,
          lowStockThreshold: 20,
          salePrice: 240,
          minSalePrice: 215,
          purchaseCost: 155,
          active: true,
          sortOrder: 2
        },
        {
          id: "var_brg_6306_2rs_nbc",
          shortName: "6306-2RS-NBC-BRG",
          officialSku: "BRG-6306-2RS-NBC",
          attributes: { "Model": "6306", "Seal": "2RS (Rubber)", "Brand": "NBC" },
          stock: -3, // Negative stock test scenario
          lowStockThreshold: 15,
          salePrice: 380,
          minSalePrice: 340,
          purchaseCost: 260,
          active: true,
          sortOrder: 3
        }
      ]
    },
    {
      id: "prod_03",
      name: "Classical Wrapped V-Belt (Section B)",
      productType: "variable",
      baseShortName: "VBELT",
      categoryId: "cat_belts",
      categoryName: "V-Belts & Pulleys",
      unit: "Piece",
      description: "Heavy duty anti-static, heat and oil resistant wrapped V-belt.",
      activityStatus: "Active",
      attributes: [
        { name: "Size Code", unit: "", values: ["B-52", "B-56", "B-64"], abbrMap: { "B-52": "B52", "B-56": "B56", "B-64": "B64" } },
        { name: "Brand", unit: "", values: ["Fenner", "Pix"], abbrMap: { "Fenner": "FEN", "Pix": "PIX" } }
      ],
      variations: [
        {
          id: "var_vbelt_b52_fen",
          shortName: "B52-FEN-VBELT",
          officialSku: "BELT-B52-FEN",
          attributes: { "Size Code": "B-52", "Brand": "Fenner" },
          stock: 42,
          lowStockThreshold: 15,
          salePrice: 320,
          minSalePrice: 290,
          purchaseCost: 210,
          active: true,
          sortOrder: 1
        },
        {
          id: "var_vbelt_b56_pix",
          shortName: "B56-PIX-VBELT",
          officialSku: "BELT-B56-PIX",
          attributes: { "Size Code": "B-56", "Brand": "Pix" },
          stock: 88,
          lowStockThreshold: 20,
          salePrice: 260,
          minSalePrice: 235,
          purchaseCost: 170,
          active: true,
          sortOrder: 2
        }
      ]
    },
    {
      id: "prod_04",
      name: "Cast Iron 2-Groove B-Section Pulley 6\"",
      productType: "simple",
      baseShortName: "PULLEY-6B2",
      categoryId: "cat_belts",
      categoryName: "V-Belts & Pulleys",
      unit: "Piece",
      description: "Standard dynamically balanced cast iron V-pulley with pilot bore.",
      activityStatus: "Active",
      attributes: [],
      variations: [
        {
          id: "var_pulley_6b2",
          shortName: "PULLEY-6B2",
          officialSku: "PLY-6B-2G",
          attributes: {},
          stock: 28,
          lowStockThreshold: 10,
          salePrice: 750,
          minSalePrice: 680,
          purchaseCost: 490,
          active: true,
          sortOrder: 1
        }
      ]
    },
    {
      id: "prod_05",
      name: "Heavy Duty Industrial Canvas Roll",
      productType: "measured",
      baseShortName: "CANVAS",
      categoryId: "cat_rolls",
      categoryName: "Industrial Canvas & Webbing",
      unit: "Meter",
      lengthUnit: "m",
      rollName: "Roll",
      defaultRollLength: 100,
      scrapBelow: 3,
      description: "Waterproof ripstop 18oz cotton canvas sold by cut lengths or full rolls.",
      activityStatus: "Active",
      attributes: [
        { name: "Width", unit: "inch", values: ["36\"", "48\"", "60\""], abbrMap: { "36\"": "36IN", "48\"": "48IN", "60\"": "60IN" } },
        { name: "Color", unit: "", values: ["Olive Green", "Khaki"], abbrMap: { "Olive Green": "OG", "Khaki": "KH" } }
      ],
      variations: [
        {
          id: "var_canvas_48_og",
          shortName: "48IN-OG-CANVAS",
          officialSku: "CAN-48-OG",
          attributes: { "Width": "48\"", "Color": "Olive Green" },
          stock: 285.5, // total meters across rolls
          lowStockThreshold: 50,
          salePrice: 280,
          minSalePrice: 250,
          purchaseCost: 175,
          active: true,
          sortOrder: 1,
          pieces: [
            { id: "pc_can_01", rollNumber: "R-101", kind: "OPEN", status: "ACTIVE", length: 85.5, originalLength: 100 },
            { id: "pc_can_02", rollNumber: "R-102", kind: "CLOSED", status: "ACTIVE", length: 100.0, originalLength: 100 },
            { id: "pc_can_03", rollNumber: "R-103", kind: "CLOSED", status: "ACTIVE", length: 100.0, originalLength: 100 }
          ]
        },
        {
          id: "var_canvas_60_kh",
          shortName: "60IN-KH-CANVAS",
          officialSku: "CAN-60-KH",
          attributes: { "Width": "60\"", "Color": "Khaki" },
          stock: 48.0,
          lowStockThreshold: 60,
          salePrice: 350,
          minSalePrice: 310,
          purchaseCost: 220,
          active: true,
          sortOrder: 2,
          pieces: [
            { id: "pc_can_04", rollNumber: "R-201", kind: "OPEN", status: "ACTIVE", length: 48.0, originalLength: 100 }
          ]
        }
      ]
    }
  ],

  parties: [
    {
      id: "pty_cust_01",
      name: "Sharma Engineering Works",
      type: "CUSTOMER",
      phone: "+91 98111 22334",
      email: "accounts@sharmaeng.co.in",
      contactPerson: "Mahesh Sharma",
      city: "Faridabad",
      address: "14/5 Mathura Road, Faridabad, Haryana",
      shippingAddress: "Gate 2, Plant B, Sector 24, Faridabad",
      creditScore: 88,
      active: true
    },
    {
      id: "pty_cust_02",
      name: "Metro Infrastructure Pvt Ltd",
      type: "CUSTOMER",
      phone: "+91 99222 33445",
      email: "procurement@metroinfra.in",
      contactPerson: "Vikram Chauhan",
      city: "Noida",
      address: "B-102 Sector 63, Noida, UP",
      creditScore: 92,
      active: true
    },
    {
      id: "pty_cust_03",
      name: "Star Hardware & Tools",
      type: "CUSTOMER",
      phone: "+91 97333 44556",
      email: "starhardware.delhi@gmail.com",
      contactPerson: "Ramesh Gupta",
      city: "Delhi",
      address: "Shop 18, Chawri Bazar, Delhi 110006",
      creditScore: 65,
      active: true
    },
    {
      id: "pty_supp_01",
      name: "Bharat Wire Mills Ltd",
      type: "SUPPLIER",
      phone: "+91 98444 55667",
      email: "sales@bharatwiremills.com",
      contactPerson: "S. K. Bansal",
      city: "Ghaziabad",
      address: "Plot 88, Site IV Sahibabad Industrial Area, Ghaziabad",
      creditScore: 95,
      active: true
    },
    {
      id: "pty_supp_02",
      name: "National Bearings Trading Co",
      type: "SUPPLIER",
      phone: "+91 98555 66778",
      email: "order@nationalbearings.in",
      contactPerson: "Praveen Jain",
      city: "Delhi",
      address: "2443 GB Road, Delhi 110006",
      creditScore: 90,
      active: true
    },
    {
      id: "pty_supp_03",
      name: "Apex Industrial Supplies",
      type: "BOTH",
      phone: "+91 98666 77889",
      email: "contact@apexind.co.in",
      contactPerson: "Anil Goel",
      city: "Gurugram",
      address: "Sector 37 Pace City, Gurugram, Haryana",
      creditScore: 78,
      active: true
    }
  ],

  vendorPrices: [
    {
      id: "vp_01",
      variationId: "var_rope_8_cb_4",
      shortName: "8-CB-4S-ROPE",
      supplierId: "pty_supp_01",
      supplierName: "Bharat Wire Mills Ltd",
      rate: 65,
      active: true,
      notes: "MOQ 200m spool, 15 days credit"
    },
    {
      id: "vp_02",
      variationId: "var_rope_10_cb_4",
      shortName: "10-CB-4S-ROPE",
      supplierId: "pty_supp_01",
      supplierName: "Bharat Wire Mills Ltd",
      rate: 98,
      active: true,
      notes: "Direct factory pricing"
    },
    {
      id: "vp_03",
      variationId: "var_brg_6204_2rs_skf",
      shortName: "6204-2RS-SKF-BRG",
      supplierId: "pty_supp_02",
      supplierName: "National Bearings Trading Co",
      rate: 120,
      active: true,
      notes: "Original SKF lot with test certificate"
    },
    {
      id: "vp_04",
      variationId: "var_vbelt_b52_fen",
      shortName: "B52-FEN-VBELT",
      supplierId: "pty_supp_03",
      supplierName: "Apex Industrial Supplies",
      rate: 210,
      active: true,
      notes: "Box of 10 units"
    }
  ],

  sales: [
    {
      id: "sal_01",
      number: "SAL/2026-27/0001",
      date: "2026-10-18T10:30:00Z",
      partyId: "pty_cust_01",
      partyName: "Sharma Engineering Works",
      subtotal: 18500,
      discount: 500,
      total: 18000,
      paymentMode: "BANK_TRANSFER",
      paymentStatus: "PAID",
      amountPaid: 18000,
      status: "COMPLETED",
      notes: "Delivery via private tempo",
      createdBy: "Rajesh Sharma",
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_8_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "8-CB-4S-ROPE",
          attributes: { "Size": "8mm", "Brand": "Crossbee", "Quality": "4" },
          unit: "Meter",
          quantity: 150,
          unitPrice: 95,
          discount: 250,
          lineTotal: 14000
        },
        {
          lineNo: 2,
          variationId: "var_brg_6204_2rs_skf",
          productName: "Deep Groove Ball Bearing 6200 Series",
          shortName: "6204-2RS-SKF-BRG",
          attributes: { "Model": "6204", "Seal": "2RS (Rubber)", "Brand": "SKF" },
          unit: "Piece",
          quantity: 25,
          unitPrice: 180,
          discount: 250,
          lineTotal: 4250
        }
      ]
    },
    {
      id: "sal_02",
      number: "SAL/2026-27/0002",
      date: "2026-10-17T15:45:00Z",
      partyId: "pty_cust_02",
      partyName: "Metro Infrastructure Pvt Ltd",
      subtotal: 28000,
      discount: 0,
      total: 28000,
      paymentMode: "CREDIT",
      paymentStatus: "PARTIAL",
      amountPaid: 15000,
      status: "COMPLETED",
      notes: "PO ref: MI-PO-889. Balance payable in 14 days",
      createdBy: "Sunil Verma",
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_10_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "10-CB-4S-ROPE",
          attributes: { "Size": "10mm", "Brand": "Crossbee", "Quality": "4" },
          unit: "Meter",
          quantity: 200,
          unitPrice: 140,
          discount: 0,
          lineTotal: 28000
        }
      ]
    },
    {
      id: "sal_03",
      number: "SAL/2026-27/0003",
      date: "2026-10-16T11:15:00Z",
      partyId: null,
      partyName: "Walk-in Customer",
      subtotal: 3200,
      discount: 200,
      total: 3000,
      paymentMode: "UPI",
      paymentStatus: "PAID",
      amountPaid: 3000,
      status: "COMPLETED",
      notes: "Counter sale",
      createdBy: "Amit Kumar",
      lines: [
        {
          lineNo: 1,
          variationId: "var_vbelt_b52_fen",
          productName: "Classical Wrapped V-Belt (Section B)",
          shortName: "B52-FEN-VBELT",
          attributes: { "Size Code": "B-52", "Brand": "Fenner" },
          unit: "Piece",
          quantity: 10,
          unitPrice: 320,
          discount: 200,
          lineTotal: 3000
        }
      ]
    },
    {
      id: "sal_04",
      number: "SAL/2026-27/0004",
      date: "2026-10-15T09:20:00Z",
      partyId: "pty_cust_03",
      partyName: "Star Hardware & Tools",
      subtotal: 5700,
      discount: 0,
      total: 5700,
      paymentMode: "CASH",
      paymentStatus: "PENDING",
      status: "CANCELLED",
      notes: "Cancelled by manager - wrong size ordered by customer",
      voidReason: "Customer requested 8mm instead of 6mm rope before dispatch",
      createdBy: "Rajesh Sharma",
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_6_hf_3",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "6-HF-3S-ROPE",
          attributes: { "Size": "6mm", "Brand": "Halfen", "Quality": "3" },
          unit: "Meter",
          quantity: 100,
          unitPrice: 57,
          discount: 0,
          lineTotal: 5700
        }
      ]
    }
  ],

  purchases: [
    {
      id: "pur_01",
      number: "PUR/2026-27/0001",
      date: "2026-10-14T14:10:00Z",
      partyId: "pty_supp_01",
      partyName: "Bharat Wire Mills Ltd",
      subtotal: 65000,
      discount: 1000,
      total: 64000,
      paymentMode: "BANK_TRANSFER",
      paymentStatus: "PAID",
      amountPaid: 64000,
      status: "COMPLETED",
      notes: "Bill No. BWM-1049 received with lorry receipt",
      createdBy: "Rajesh Sharma",
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_8_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "8-CB-4S-ROPE",
          unit: "Meter",
          quantity: 1000,
          unitCost: 65,
          discount: 1000,
          lineTotal: 64000
        }
      ]
    },
    {
      id: "pur_02",
      number: "PUR/2026-27/0002",
      date: "2026-10-12T16:00:00Z",
      partyId: "pty_supp_02",
      partyName: "National Bearings Trading Co",
      subtotal: 24000,
      discount: 0,
      total: 24000,
      paymentMode: "CHEQUE",
      paymentStatus: "PAID",
      amountPaid: 24000,
      status: "COMPLETED",
      notes: "Cheque #044192 HDFC Bank",
      createdBy: "Sunil Verma",
      lines: [
        {
          lineNo: 1,
          variationId: "var_brg_6204_2rs_skf",
          productName: "Deep Groove Ball Bearing 6200 Series",
          shortName: "6204-2RS-SKF-BRG",
          unit: "Piece",
          quantity: 200,
          unitCost: 120,
          discount: 0,
          lineTotal: 24000
        }
      ]
    }
  ],

  saleOrders: [
    {
      id: "so_01",
      number: "SO/2026-27/0001",
      kind: "SALE",
      orderDate: "2026-10-19T09:00:00Z",
      expectedDate: "2026-10-21",
      status: "PLACED", // DRAFT, PLACED, ON_DELIVERY, COMPLETED, CANCELLED
      partyId: "pty_cust_01",
      partyName: "Sharma Engineering Works",
      deliveryAddress: "Gate 2, Plant B, Sector 24, Faridabad",
      deliveryNote: "Driver contact: 98765-11111",
      notes: "Urgent project dispatch",
      total: 28500,
      lineCount: 2,
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_8_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "8-CB-4S-ROPE",
          unit: "Meter",
          quantity: 200,
          fulfilledQuantity: 0,
          outstandingQuantity: 200,
          price: 95,
          discount: 500,
          lineTotal: 18500,
          availableStock: 450,
          shortage: 0
        },
        {
          lineNo: 2,
          variationId: "var_canvas_48_og",
          productName: "Heavy Duty Industrial Canvas Roll",
          shortName: "48IN-OG-CANVAS",
          unit: "Meter",
          quantity: 40,
          fulfilledQuantity: 0,
          outstandingQuantity: 40,
          price: 250,
          discount: 0,
          lineTotal: 10000,
          availableStock: 285.5,
          shortage: 0
        }
      ],
      events: [
        { status: "DRAFT", note: "Order initiated by customer call", at: "2026-10-19 09:00", by: "Amit Kumar" },
        { status: "PLACED", note: "Advance received 20% confirmed", at: "2026-10-19 10:15", by: "Sunil Verma" }
      ]
    },
    {
      id: "so_02",
      number: "SO/2026-27/0002",
      kind: "SALE",
      orderDate: "2026-10-18T14:30:00Z",
      expectedDate: "2026-10-20",
      status: "ON_DELIVERY",
      partyId: "pty_cust_02",
      partyName: "Metro Infrastructure Pvt Ltd",
      deliveryAddress: "Metro Pier 14, Ring Road Project, Delhi",
      deliveryNote: "Tata 407 Vehicle No. DL-1L-8821",
      notes: "Site supervisor Vikram (+91 99222 33445)",
      total: 42000,
      lineCount: 1,
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_10_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "10-CB-4S-ROPE",
          unit: "Meter",
          quantity: 300,
          fulfilledQuantity: 0,
          outstandingQuantity: 300,
          price: 140,
          discount: 0,
          lineTotal: 42000,
          availableStock: 120,
          shortage: 180
        }
      ],
      events: [
        { status: "DRAFT", note: "Quote converted to order", at: "2026-10-18 14:30", by: "Rajesh Sharma" },
        { status: "PLACED", note: "Material prepared for loading", at: "2026-10-18 16:00", by: "Rajesh Sharma" },
        { status: "ON_DELIVERY", note: "Dispatched with driver Satish", at: "2026-10-19 08:30", by: "Amit Kumar" }
      ]
    }
  ],

  purchaseOrders: [
    {
      id: "po_01",
      number: "PO/2026-27/0001",
      kind: "PURCHASE",
      orderDate: "2026-10-17T11:00:00Z",
      expectedDate: "2026-10-22",
      status: "PLACED",
      partyId: "pty_supp_01",
      partyName: "Bharat Wire Mills Ltd",
      deliveryAddress: "RS Machinery Godown, Mayapuri Phase II",
      notes: "To cover shortage on 10mm wire rope",
      total: 49000,
      lineCount: 1,
      lines: [
        {
          lineNo: 1,
          variationId: "var_rope_10_cb_4",
          productName: "Steel Wire Rope 6x19 (Galvanized)",
          shortName: "10-CB-4S-ROPE",
          unit: "Meter",
          quantity: 500,
          fulfilledQuantity: 0,
          outstandingQuantity: 500,
          price: 98,
          discount: 0,
          lineTotal: 49000
        }
      ],
      events: [
        { status: "PLACED", note: "PO emailed to supplier", at: "2026-10-17 11:30", by: "Rajesh Sharma" }
      ]
    }
  ],

  drafts: [
    {
      id: "draft_01",
      title: "Sharma Eng - Quotation draft",
      mode: "sale",
      partyId: "pty_cust_01",
      partyName: "Sharma Engineering Works",
      lineCount: 2,
      estimatedTotal: 15400,
      updatedAt: "2026-10-19 11:20"
    }
  ],

  glossary: [
    { term: "Inventory", aka: "Stock", group: "stock", meaning: "All the goods the shop has on hand to sell, plus the record of how many of each item there are." },
    { term: "Stock In", group: "stock", meaning: "Goods coming into the shop, which increases the quantity on hand. Usually from a purchase, opening balance, or correction." },
    { term: "On Hand", aka: "Current stock", group: "stock", meaning: "How many units the system says are physically in the shop right now." },
    { term: "Negative Stock", aka: "Below zero", group: "stock", meaning: "The system shows less than zero because an item was sold before its purchase was entered into the system. It is reconciled automatically upon purchase recording under the Warn & Allow policy." },
    { term: "Warn & Allow", group: "stock", meaning: "RS Inventory V2/V3 fixed company policy allowing sellers to confirm a sale even when physical stock is zero or negative after a warning, while recording the action in the audit log." },
    { term: "Measured Product", group: "stock", meaning: "Goods sold by length (meters or feet) in discrete rolls, drums, or reels (e.g. Wire Ropes, Canvas, Webbing) where individual cut lengths and scraps are tracked." },
    { term: "Sale Order (SO)", aka: "Booking", group: "trade", meaning: "A customer's confirmed request for goods to be delivered later. Stock is deducted only upon completion / fulfillment." },
    { term: "Purchase Order (PO)", group: "trade", meaning: "A written order sent to a supplier. Does not increment stock until goods are formally received." },
    { term: "Supplier Rate Card", aka: "Vendor Price", group: "money", meaning: "Agreed purchase rates negotiated with specific suppliers for particular SKUs, pre-filling purchase carts." }
  ]
};
