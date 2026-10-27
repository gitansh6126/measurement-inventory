import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import {
  SESSION_COOKIE,
  burnPasswordCheck,
  cookieOptions,
  createSession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { sendPasswordResetCode } from "../lib/password-reset-mailer.js";
import { PERMISSIONS, can, type Permission } from "../lib/permissions.js";

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const passwordRule = z.string().min(10, "Password must be at least 10 characters").max(200);

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordRule,
});

const resetRequestBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

const resetConfirmBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordRule,
  confirmPassword: passwordRule,
}).refine((body) => body.newPassword === body.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

const publicUser = { id: true, name: true, email: true, role: true, active: true, companyId: true } as const;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;

function resetCodeHash(env: Env, userId: string, code: string): Buffer {
  return createHmac("sha256", env.SESSION_SECRET).update(`${userId}:${code}`).digest();
}

function resetCodeRateKey(req: { ip?: string; body?: { email?: unknown } }): string {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return `${ipKeyGenerator(req.ip ?? "")}|${email}`;
}

export function authRoutes(env: Env) {
  const r = Router();

  // 10 attempts per 15 minutes per IP + email; a separate wider cap per IP.
  const perAccount = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // ipKeyGenerator groups IPv6 addresses by /56 so rotating addresses cannot bypass the limit.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").toLowerCase()}`,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.")),
  });
  const perIp = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.")),
  });
  const resetRequestPerIp = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many password reset requests. Try again later.")),
  });
  const resetRequestPerEmail = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: resetCodeRateKey,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many password reset requests. Try again later.")),
  });
  const resetConfirmPerEmail = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: resetCodeRateKey,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many password reset attempts. Try again later.")),
  });

  r.post("/login", perIp, perAccount, async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user ? await verifyPassword(password, user.passwordHash) : await burnPasswordCheck(password);
    if (!user || !ok || !user.active) {
      await audit(prisma, {
        companyId: user?.companyId ?? null,
        actorId: user?.id ?? null,
        action: "LOGIN_FAILED",
        entityType: "User",
        entityId: user?.id ?? null,
        after: { email },
        requestId: req.requestId,
      });
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    const { token, session } = await createSession(env, user.id, { ip: req.ip, userAgent: req.get("user-agent") });
    await audit(prisma, {
      companyId: user.companyId,
      actorId: user.id,
      action: "LOGIN",
      entityType: "Session",
      entityId: session.id,
      requestId: req.requestId,
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(env));
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  r.post("/password-reset/request", resetRequestPerIp, resetRequestPerEmail, async (req, res) => {
    const { email } = resetRequestBody.parse(req.body);
    // Checked before the user lookup so the answer never depends on whether the account exists.
    if (env.APP_ENV === "CLIENT_READY" && (!env.SMTP_USER || !env.SMTP_PASS)) {
      throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not available yet. Ask your administrator to reset your password.");
    }
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, active: true } });

    if (user?.active) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.passwordResetCode.updateMany({
          where: { userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.passwordResetCode.deleteMany({
          where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
        });
        await tx.passwordResetCode.create({
          data: {
            userId: user.id,
            codeHash: resetCodeHash(env, user.id, code).toString("hex"),
            expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS),
          },
        });
      });

      try {
        await sendPasswordResetCode(env, email, code, req.requestId);
      } catch (error) {
        log.error("password_reset_email_failed", {
          requestId: req.requestId,
          email,
          error: error instanceof Error ? error.message : String(error),
        });
        if (env.APP_ENV !== "CLIENT_READY") {
          log.warn("password_reset_code_logged", { email, code, requestId: req.requestId, reason: "smtp_delivery_failed" });
        }
      }
    } else {
      const candidate = resetCodeHash(env, "unknown-user", "000000");
      timingSafeEqual(candidate, resetCodeHash(env, "unknown-user", "000001"));
    }

    res.status(202).json({
      message: "If the address belongs to an active account, a password reset code has been sent.",
    });
  });

  r.post("/password-reset/confirm", resetConfirmPerEmail, async (req, res) => {
    const { email, code, newPassword } = resetConfirmBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, companyId: true, active: true } });
    const now = new Date();
    const reset = await prisma.passwordResetCode.findFirst({
      where: {
        userId: user?.id ?? "unknown-user",
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: RESET_CODE_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "desc" },
    });
    const candidate = resetCodeHash(env, user?.id ?? "unknown-user", code);
    const expected = reset ? Buffer.from(reset.codeHash, "hex") : resetCodeHash(env, "unknown-user", "000000");
    const matches = timingSafeEqual(candidate, expected);

    if (!user?.active || !reset || !matches) {
      if (reset) {
        await prisma.passwordResetCode.updateMany({
          where: { id: reset.id, consumedAt: null, attempts: { lt: RESET_CODE_MAX_ATTEMPTS } },
          data: { attempts: { increment: 1 } },
        });
      }
      throw new AppError(400, "INVALID_RESET_CODE", "The email or reset code is invalid or expired");
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetCode.updateMany({
        where: {
          id: reset.id,
          userId: user.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: RESET_CODE_MAX_ATTEMPTS },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AppError(400, "INVALID_RESET_CODE", "The email or reset code is invalid or expired");
      }
      const updated = await tx.user.updateMany({
        where: { id: user.id, active: true },
        data: { passwordHash, updatedById: user.id },
      });
      if (updated.count !== 1) {
        throw new AppError(400, "INVALID_RESET_CODE", "The email or reset code is invalid or expired");
      }
      await tx.passwordResetCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await audit(tx, {
        companyId: user.companyId,
        actorId: user.id,
        action: "AUDIT_PASSWORD_RESET_VIA_EMAIL",
        entityType: "User",
        entityId: user.id,
        requestId: req.requestId,
      });
    });

    res.json({ ok: true });
  });

  r.post("/logout", async (req, res) => {
    if (req.auth) {
      await prisma.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } });
      await audit(prisma, {
        companyId: req.auth.companyId,
        actorId: req.auth.userId,
        action: "LOGOUT",
        entityType: "Session",
        entityId: req.auth.sessionId,
        requestId: req.requestId,
      });
    }
    const { maxAge: _maxAge, ...clear } = cookieOptions(env);
    res.clearCookie(SESSION_COOKIE, clear);
    res.json({ ok: true });
  });

  r.get("/me", requireAuth, async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: publicUser });
    const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role, p));
    res.json({ user, permissions });
  });

  r.post("/password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
    const auth = req.auth!;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError(400, "WRONG_PASSWORD", "Current password is incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, updatedById: user.id } });
      // Sign out every other session for this user.
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: new Date() },
      });
      await audit(tx, { companyId: user.companyId, actorId: user.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: user.id, requestId: req.requestId });
    });
    res.json({ ok: true });
  });

  return r;
}
