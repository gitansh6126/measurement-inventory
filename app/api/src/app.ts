import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import type { Env } from "./env.js";
import { authenticate } from "./lib/auth.js";
import { errorHandler, notFound } from "./lib/errors.js";
import { accessLog, noStore, requestId, sameOrigin } from "./lib/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { backupRoutes } from "./routes/backup.js";
import { catalogRoutes } from "./routes/catalog.js";
import { categoryRoutes } from "./routes/categories.js";
import { categoryHeadRoutes } from "./routes/category-heads.js";
import { companyRoutes } from "./routes/company.js";
import { draftRoutes } from "./routes/drafts.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { vendorPriceRoutes } from "./routes/vendor-prices.js";
import { purchaseRoutes, saleRoutes } from "./routes/documents.js";
import { imageRoutes } from "./routes/images.js";
import { importRoutes } from "./routes/import.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { measureRoutes } from "./routes/measure.js";
import { setRoutes } from "./routes/sets.js";
import { transferRoutes, warehouseRoutes } from "./routes/warehouses.js";
import { orderRoutes } from "./routes/orders.js";
import { partyRoutes } from "./routes/parties.js";
import { productRoutes } from "./routes/products.js";
import { systemRoutes } from "./routes/system.js";
import { userRoutes } from "./routes/users.js";

export function createApp(env: Env) {
  const app = express();
  app.disable("x-powered-by");
  // Behind the reverse proxy, trust exactly one hop for req.ip / secure cookies.
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);

  app.use(requestId);
  app.use(accessLog);
  app.use(helmet());
  // Imports send up to 5,000 matched rows; every other route keeps the 100 kB limit.
  app.use("/api/import", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", noStore, sameOrigin(env.allowedOrigins), authenticate(env));

  app.use("/api", systemRoutes(env));
  app.use("/api/auth", authRoutes(env));
  app.use("/api/users", userRoutes());
  app.use("/api/company", companyRoutes());
  app.use("/api/categories", categoryRoutes());
  app.use("/api/category-heads", categoryHeadRoutes());
  app.use("/api/catalog", catalogRoutes());
  app.use("/api/products", productRoutes());
  app.use("/api/inventory", inventoryRoutes());
  app.use("/api/measure", measureRoutes());
  app.use("/api/sets", setRoutes());
  app.use("/api/warehouses", warehouseRoutes());
  app.use("/api/transfers", transferRoutes());
  app.use("/api/parties", partyRoutes());
  app.use("/api/images", imageRoutes(env));
  app.use("/api/sales", saleRoutes());
  app.use("/api/purchases", purchaseRoutes());
  app.use("/api/backup", backupRoutes(env));
  app.use("/api/import", importRoutes());
  app.use("/api/drafts", draftRoutes());
  app.use("/api/orders", orderRoutes());
  app.use("/api/vendor-prices", vendorPriceRoutes());
  app.use("/api/me/preferences", preferenceRoutes());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
