import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { log } from "./logger.js";

/** An expected failure whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Not found"));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    res.status(400).json({ error: { code: "VALIDATION", message: "Invalid input", details, requestId } });
    return;
  }
  // Audit L1: a unique index lost a race the route did not catch itself (e.g. two "create user"
  // requests with one email). That is a conflict the user can act on, not a server fault.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: { code: "CONFLICT", message: "This record already exists. Refresh and try again.", requestId } });
    return;
  }
  // express.json() parse failures and oversized bodies.
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500 && err.type) {
    res.status(err.status).json({ error: { code: "BAD_REQUEST", message: "Malformed request", requestId } });
    return;
  }
  // Unknown error: log everything server-side, return nothing internal.
  log.error("unhandled_error", { requestId, path: req.path, error: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", requestId } });
};
