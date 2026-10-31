import { describe, expect, it } from "vitest";
import { isApiPath } from "../../../hosting/route.js";

describe("hosted single-process routing", () => {
  it("sends /api and /api/* to the API", () => {
    for (const url of ["/api", "/api/", "/api/health/ready", "/api/auth/login", "/api/products?q=chain"]) {
      expect(isApiPath(url)).toBe(true);
    }
  });

  it("sends pages and Next assets to the web app", () => {
    for (const url of [undefined, "/", "/login", "/products", "/_next/static/x.js", "/apis", "/api-docs", "/favicon.ico", "/products?api=1"]) {
      expect(isApiPath(url)).toBe(false);
    }
  });
});
