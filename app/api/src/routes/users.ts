import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { hashPassword, requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { passwordRule } from "./auth.js";

const select = { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true } as const;

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.nativeEnum(Role),
  password: passwordRule,
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.nativeEnum(Role).optional(),
    active: z.boolean().optional(),
    password: passwordRule.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

/** Admin-only user management. There is no public signup (see scripts/create-admin.ts). */
export function userRoutes() {
  const r = Router();
  r.use(requirePermission("user.manage"));

  r.get("/", async (req, res) => {
    const users = await prisma.user.findMany({ where: { companyId: req.auth!.companyId }, select, orderBy: { name: "asc" } });
    res.json({ users });
  });

  r.post("/", async (req, res) => {
    const body = createBody.parse(req.body);
    const auth = req.auth!;
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw new AppError(409, "EMAIL_TAKEN", "A user with this email already exists");
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { companyId: auth.companyId, name: body.name, email: body.email, role: body.role, passwordHash, createdById: auth.userId, updatedById: auth.userId },
        select,
      });
      await audit(tx, { companyId: auth.companyId, actorId: auth.userId, action: "USER_CREATE", entityType: "User", entityId: created.id, after: created, requestId: req.requestId });
      return created;
    });
    res.status(201).json({ user });
  });

  r.patch("/:id", async (req, res) => {
    const body = updateBody.parse(req.body);
    const auth = req.auth!;
    const id = String(req.params.id);
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, companyId: auth.companyId }, select });
      if (!before) throw new AppError(404, "NOT_FOUND", "User not found");

      // Never leave the company without an active admin.
      const losesAdmin = before.role === "admin" && before.active && (body.active === false || (body.role && body.role !== "admin"));
      if (losesAdmin) {
        // Row locks serialise concurrent demotions so two admins cannot remove each other.
        const admins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE company_id = ${auth.companyId} AND role = 'admin' AND active FOR UPDATE`;
        if (admins.length <= 1) throw new AppError(409, "LAST_ADMIN", "At least one active admin is required");
      }

      const after = await tx.user.update({
        where: { id },
        data: {
          name: body.name,
          role: body.role,
          active: body.active,
          passwordHash: body.password ? await hashPassword(body.password) : undefined,
          updatedById: auth.userId,
        },
        select,
      });
      // Deactivation or password reset ends existing sessions.
      if (body.active === false || body.password) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(tx, {
        companyId: auth.companyId,
        actorId: auth.userId,
        action: body.password ? "USER_UPDATE_PASSWORD_RESET" : "USER_UPDATE",
        entityType: "User",
        entityId: id,
        before,
        after,
        requestId: req.requestId,
      });
      return after;
    });
    res.json({ user });
  });

  return r;
}
