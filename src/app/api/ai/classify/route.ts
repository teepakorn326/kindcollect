import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applyClassification, classifyCase } from "@/lib/ai/diagnosis";
import { AiUnavailableError } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Re-diagnose a case: classify_case → apply as an unconfirmed suggestion. Body: { caseId, fresh? } */
export async function POST(req: Request) {
  const parsed = z.object({ caseId: z.string(), fresh: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "caseId required" }, { status: 400 });
  try {
    const cls = await classifyCase(parsed.data.caseId, { preferCache: !parsed.data.fresh });
    const applied = await applyClassification(cls, "re-diagnosed");
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, classification: cls.output, cached: cls.cached, ...applied });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof AiUnavailableError ? e.message : "Classification failed" }, { status: 502 });
  }
}
