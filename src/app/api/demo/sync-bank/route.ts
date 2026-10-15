import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncNextBankLine } from "@/lib/bank";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Sync bank feed": insert the next seeded bank line and re-run matchPayment + sendGuard. */
export async function POST() {
  const result = await syncNextBankLine();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...result });
}
