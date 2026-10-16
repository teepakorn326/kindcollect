import { NextResponse } from "next/server";
import { databaseUrl, db } from "@/lib/db";
import { appUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

/** Deployment check: DB reachable + connection settings (never secrets). */
export async function GET() {
  let host = "unset";
  let settings: Record<string, string | null> = {};
  try {
    const u = new URL(databaseUrl());
    host = `${u.hostname}:${u.port || "5432"}`;
    settings = {
      pgbouncer: u.searchParams.get("pgbouncer"),
      connection_limit: u.searchParams.get("connection_limit"),
      placeholder_in_url: /<|>|%3C|%3E/i.test(process.env.DATABASE_URL ?? "") ? "YES — replace <ref>/<password>" : "no",
    };
  } catch {
    host = "invalid DATABASE_URL";
  }
  const started = Date.now();
  let dbStatus: string;
  let cases: number | null = null;
  try {
    cases = await db.case.count();
    dbStatus = "ok";
  } catch (e) {
    dbStatus = e instanceof Error ? e.message.split("\n").filter(Boolean).slice(-1)[0].slice(0, 200) : "error";
  }
  return NextResponse.json(
    {
      db: dbStatus,
      dbMs: Date.now() - started,
      cases,
      host,
      ...settings,
      region: process.env.VERCEL_REGION ?? "local",
      demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
      anthropicKey: !!process.env.ANTHROPIC_API_KEY,
      basicAuth: !!(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS),
      appUrl: appUrl(),
    },
    { status: dbStatus === "ok" ? 200 : 503 }
  );
}
