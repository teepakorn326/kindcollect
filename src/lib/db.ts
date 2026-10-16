import { PrismaClient } from "@prisma/client";

/**
 * Normalise DATABASE_URL so a pasted value can't break production:
 * - Supabase transaction pooler (:6543) can't run prepared statements → force `pgbouncer=true`.
 * - On Vercel every function instance opens its own pool → force `connection_limit=1`.
 */
export function databaseUrl(raw = process.env.DATABASE_URL ?? ""): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw.trim());
    if (u.port === "6543") u.searchParams.set("pgbouncer", "true");
    if (process.env.VERCEL) u.searchParams.set("connection_limit", "1");
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "20");
    return u.toString();
  } catch {
    return raw;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: databaseUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
