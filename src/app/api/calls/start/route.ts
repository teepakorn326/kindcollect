import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CallError, startCall } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Start an approved call. Business hours (7:30–21:00 Mon–Fri Sydney) and 1 call/customer/7 days are enforced in code. */
export async function POST(req: Request) {
  const parsed = z.object({ callId: z.string() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "callId required" }, { status: 400 });
  try {
    const r = await startCall(parsed.data.callId);
    revalidatePath(`/calls/${parsed.data.callId}`);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof CallError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("start call failed", e);
    return NextResponse.json({ ok: false, error: "Could not start the call." }, { status: 500 });
  }
}
