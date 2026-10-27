import { z } from "zod";
import type { Tx } from "../db.js";
import { AppError } from "./errors.js";

// Optimistic concurrency for editable masters (V2 plan §1.5, backlog C2). The client sends the
// `version` it loaded; the edit locks the row, compares, and bumps the version. Two people
// editing the same record: the second save gets 409 instead of silently overwriting the first.
// Omitting `version` keeps V1 behaviour (last write wins) for older clients and scripts.

const TABLES = { productGroup: "product_groups", productVariation: "product_variations", party: "parties" } as const;
export type VersionedKind = keyof typeof TABLES;

/** Optional on update bodies. */
export const versionField = z.number().int().min(1).optional();

/** "Nothing to update" refinement that ignores `version` itself. */
export const hasChanges = (b: Record<string, unknown>) => Object.entries(b).some(([k, v]) => k !== "version" && v !== undefined);

/**
 * Locks the row for the rest of the transaction and checks the expected version. Call it
 * before reading the "before" state so both edits are serialised. A row of another company
 * (or a missing row) is left to the caller's normal 404 handling.
 */
export async function lockVersion(tx: Tx, kind: VersionedKind, companyId: string, id: string, expected: number | undefined, label: string) {
  const rows = await tx.$queryRawUnsafe<{ version: number }[]>(
    `SELECT "version" FROM "${TABLES[kind]}" WHERE "id" = $1 AND "company_id" = $2 FOR UPDATE`,
    id,
    companyId,
  );
  const current = rows[0]?.version;
  if (expected !== undefined && current !== undefined && current !== expected) {
    throw new AppError(409, "VERSION_CONFLICT", `${label} was changed by someone else. Reload to see the latest, then try again.`, { currentVersion: current });
  }
}

/** Prisma update fragment that bumps the version. */
export const bumpVersion = { version: { increment: 1 } } as const;
