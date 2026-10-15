import { NextResponse } from "next/server";
import { getPaymentState } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Polled by the Payment Matching page (TanStack Query) to show the stale-data banner. */
export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const state = await getPaymentState((await params).paymentId);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
