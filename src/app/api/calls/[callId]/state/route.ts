import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Polled every 2 s by the Voice Call page while the call is live. */
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const call = await db.call.findUnique({
    where: { id: (await params).callId },
    select: { status: true, transcript: true, outcome: true, startedAt: true, endedAt: true, recordingUrl: true, source: true, outcomeConfirmedAt: true },
  });
  if (!call) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(call);
}
