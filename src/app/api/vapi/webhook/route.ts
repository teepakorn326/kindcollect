import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { handleVapiMessage, verifyVapiSecret } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vapi server URL. Bypasses Basic Auth; authenticated by VAPI_WEBHOOK_SECRET (x-vapi-secret or Bearer). */
export async function POST(req: Request) {
  if (!verifyVapiSecret(req.headers)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { message?: Parameters<typeof handleVapiMessage>[0] } | null;
  if (!body?.message) return NextResponse.json({ error: "no message" }, { status: 400 });
  const result = await handleVapiMessage(body.message);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, result });
}
