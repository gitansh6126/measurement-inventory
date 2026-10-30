import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { CookieOptions, RequestHandler } from "express";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { AppError } from "./errors.js";
import { can, type Permission } from "./permissions.js";

export const SESSION_COOKIE = "rs_session";
export const CUSTOMER_MODE_COOKIE = "rs_customer_mode";
const BCRYPT_COST = 12;
// Refresh lastSeenAt (and slide the expiry) at most this often to avoid a write on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

// Compared against when the email is unknown so response time does not reveal accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);
export const burnPasswordCheck = (password: string) => bcrypt.compare(password, DUMMY_HASH);

export function tokenHash(env: Env, token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
}

export function cookieOptions(env: Env, maxAgeMs = env.SESSION_IDLE_DAYS * DAY_MS): CookieOptions {
  return {
    httpOnly: true,
    secure: env.PUBLIC_APP_URL.startsWith("https://"),
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * Sliding expiry: each use pushes the session out to SESSION_IDLE_DAYS from now, never past
 * SESSION_MAX_DAYS after sign-in. A device left unused for the idle period must sign in again.
 */
export function slidingExpiry(env: Env, createdAt: Date, now = Date.now()): Date {
  return new Date(Math.min(now + env.SESSION_IDLE_DAYS * DAY_MS, createdAt.getTime() + env.SESSION_MAX_DAYS * DAY_MS));
}

export async function createSession(env: Env, userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: tokenHash(env, token),
      expiresAt: new Date(Date.now() + env.SESSION_IDLE_DAYS * DAY_MS),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  return { token, session };
}

/**
 * Resolves the session cookie into req.auth. Inactive users and revoked/expired sessions are rejected.
 * A live session is slid forward (database expiry and cookie lifetime) so a device in regular use
 * stays signed in; see slidingExpiry.
 */
export function authenticate(env: Env): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || token.length < 20) return next();
    const session = await prisma.session.findUnique({
      where: { tokenHash: tokenHash(env, token) },
      include: { user: { select: { id: true, companyId: true, role: true, active: true } } },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.active) return next();
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const expiresAt = slidingExpiry(env, session.createdAt, now);
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt } });
      res.cookie(SESSION_COOKIE, token, cookieOptions(env, expiresAt.getTime() - now));
    }
    const isCustomerMode = req.cookies?.[CUSTOMER_MODE_COOKIE] === "1" || req.headers["x-customer-mode"] === "1";
    req.auth = { userId: session.user.id, companyId: session.user.companyId, role: session.user.role, sessionId: session.id, isCustomerMode };
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new AppError(401, "UNAUTHENTICATED", "Please sign in"));
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError(401, "UNAUTHENTICATED", "Please sign in"));
    if (!can(req.auth.role, permission)) return next(new AppError(403, "FORBIDDEN", "You do not have permission for this action"));
    next();
  };
}

export const blockInCustomerMode: RequestHandler = (req, _res, next) => {
  if (req.auth?.isCustomerMode) {
    return next(new AppError(403, "CUSTOMER_MODE_RESTRICTED", "This resource or action is not available in customer mode"));
  }
  next();
};
