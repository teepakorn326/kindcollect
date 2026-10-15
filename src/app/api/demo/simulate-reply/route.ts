import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { PENDING_REPLIES } from "@/lib/demo/seed";
import { sydney } from "@/lib/clock";
import { applyClassification, classifyCase } from "@/lib/ai/diagnosis";
import { AiUnavailableError } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mock inbound email: insert a seeded customer reply, then re-run classify_case on the case (real AI,
 * cached fallback) and apply the suggestion. Body: { customer?: "noodle" | "bella" } (default noodle).
 */
export async function POST(req: Request) {
  const { customer = "noodle" } = (await req.json().catch(() => ({}))) as { customer?: keyof typeof PENDING_REPLIES };
  const reply = PENDING_REPLIES[customer];
  if (!reply) return NextResponse.json({ ok: false, error: "unknown customer" }, { status: 400 });
  if (await db.message.findUnique({ where: { id: reply.id } })) {
    return NextResponse.json({ ok: false, error: "This reply was already simulated. Reset demo data to run it again." }, { status: 409 });
  }

  const [date, time] = reply.occurredAt.split("T");
  const at = sydney(date, time);
  const c = await db.case.findUniqueOrThrow({ where: { id: reply.caseId } });
  await db.$transaction([
    db.message.create({
      data: {
        id: reply.id,
        customerId: reply.customerId,
        caseId: reply.caseId,
        invoiceId: reply.invoiceId,
        direction: "inbound",
        status: "received",
        fromName: reply.fromName,
        fromEmail: reply.fromEmail,
        toEmail: "tony@freshharvest.example",
        subject: reply.subject,
        body: reply.body,
        occurredAt: at,
      },
    }),
    db.auditEvent.create({
      data: {
        businessId: c.businessId, caseId: c.id, customerId: c.customerId, invoiceId: c.invoiceId, at,
        actor: "Customer", type: "reply_received", summary: "Customer replied", detail: `“${reply.body.slice(0, 60)}…”`,
      },
    }),
  ]);

  try {
    const cls = await classifyCase(reply.caseId);
    const applied = await applyClassification(cls, "after new reply");
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, messageId: reply.id, classification: cls.output, cached: cls.cached, ...applied });
  } catch (e) {
    revalidatePath("/", "layout");
    const msg = e instanceof AiUnavailableError ? e.message : "Classification failed";
    return NextResponse.json({ ok: false, messageId: reply.id, error: `Reply inserted, but ${msg}` }, { status: 502 });
  }
}
