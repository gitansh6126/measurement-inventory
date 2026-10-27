import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "./errors.js";
import { log } from "./logger.js";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a well-formed upstream X-Request-Id (reverse proxy) or mints one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

/**
 * Audit M5: one JSON line per finished API request (no bodies, no query strings, which may hold
 * search text), so a failed browser action can be traced by the requestId its error shows.
 * Health probes are skipped to keep the log readable.
 */
export const accessLog: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0] ?? "";
    if (path === "/api/health" || path === "/api/health/ready") return;
    const fields = {
      requestId: req.requestId,
      method: req.method,
      path,
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      userId: req.auth?.userId ?? null,
      companyId: req.auth?.companyId ?? null,
    };
    if (res.statusCode >= 500) log.error("request", fields);
    else log.info("request", fields);
  });
  next();
};

/**
 * CSRF guard for state-changing requests. Session cookies are SameSite=Strict; in
 * addition a browser-sent Origin must match the public app origin (or an ALLOWED_ORIGINS entry).
 */
export function sameOrigin(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) return next(new AppError(403, "BAD_ORIGIN", "Cross-origin request refused"));
    next();
  };
}

/** No caching of API responses (they carry per-user data). */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
