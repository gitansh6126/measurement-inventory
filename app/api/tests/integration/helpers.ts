import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { hashPassword } from "../../src/lib/auth.js";

export const PASSWORD = "correct-horse-battery";
export const ORIGIN = getEnv().allowedOrigins[0] ?? "http://localhost:3510";

export const app = () => createApp(getEnv());

let passwordHash: string | undefined;

/** A fresh company per test keeps tests independent (audit rows cannot be deleted). */
export async function makeCompany() {
  return prisma.company.create({ data: { name: `Co ${randomUUID().slice(0, 8)}` } });
}

export async function makeUser(companyId: string, role: Role, overrides: { active?: boolean } = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({
    data: { companyId, role, name: `${role} user`, email: `${role}-${randomUUID()}@test.local`, passwordHash, active: overrides.active ?? true },
  });
}

/** Signs in and returns a supertest agent that carries the session cookie. */
export async function signIn(email: string) {
  const agent = request.agent(app());
  const res = await agent.post("/api/auth/login").set("Origin", ORIGIN).send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
