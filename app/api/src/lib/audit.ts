import { Prisma } from "@prisma/client";
import type { Db } from "../db.js";
import { getEnv } from "../env.js";

export interface AuditInput {
  companyId: string | null;
  actorId: string | null;
  action: string; // e.g. USER_CREATE, LOGIN, SALE_CREATE
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/**
 * Records an audit event. Pass the transaction client so the event commits or rolls
 * back together with the change it describes.
 */
function row(input: AuditInput) {
  return {
    environment: getEnv().APP_ENV,
    companyId: input.companyId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: json(input.before),
    after: json(input.after),
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
  };
}

export function audit(db: Db, input: AuditInput) {
  return db.auditEvent.create({ data: row(input) });
}

/** Many audit events in one statement (bulk writes such as Stock In). */
export function auditMany(db: Db, inputs: readonly AuditInput[]) {
  if (!inputs.length) return Promise.resolve({ count: 0 });
  return db.auditEvent.createMany({ data: inputs.map(row) });
}
