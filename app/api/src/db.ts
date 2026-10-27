import { PrismaClient, Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/**
 * Options for write transactions (audit B02). Prisma's default interactive-transaction timeout
 * is 5 s, which large Stock In batches or lock waits under concurrent sales can exceed; the
 * request then fails with a 500 and rolls back. maxWait bounds the wait for a pooled connection.
 */
export const WRITE_TX = { timeout: 20_000, maxWait: 5_000 } as const;
