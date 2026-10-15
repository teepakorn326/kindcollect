"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { z } from "zod";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { draftAmountIssues, sendGuard } from "@/lib/rules";
import { generateDraft, getDraftContext } from "@/lib/communications";
import { AiUnavailableError } from "@/lib/ai/client";

const tone = z.enum(["warm", "neutral", "firm"]);
const isDemoMode = () => (process.env.DEMO_MODE ?? "true") !== "false";

export type DraftResult =
  | { ok: true; subject: string; body: string; factsUsed: string[]; cached: boolean; amountIssues: string[] }
  | { ok: false; error: string };

/** Tone toggle: re-run draft_message. Nothing is written except the AI cache. */
export async function redraft(input: { draftId: string; tone: z.infer<typeof tone>; fresh?: boolean }): Promise<DraftResult> {
  const parsed = z.object({ draftId: z.string(), tone, fresh: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const ctx = await getDraftContext(parsed.data.draftId);
  if (!ctx) return { ok: false, error: "Draft not found" };
  try {
    const r = await generateDraft(ctx, parsed.data.tone, parsed.data.fresh);
    return {
      ok: true,
      subject: r.output.subject,
      body: r.output.body,
      factsUsed: r.output.facts_used,
      cached: r.cached,
      amountIssues: draftAmountIssues(`${r.output.subject}\n${r.output.body}`, ctx.allowedCents),
    };
  } catch (e) {
    return { ok: false, error: e instanceof AiUnavailableError ? e.message : "Could not draft the message." };
  }
}

const writeSchema = z.object({
  draftId: z.string(),
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  tone,
  expectedUpdatedAt: z.string(),
});

type WriteResult = { ok: true; demoOnly?: boolean } | { ok: false; error: string; stale?: boolean; blocked?: boolean };

/** Save draft — explicit click by Sarah; audit-logged. */
export async function saveDraft(input: z.infer<typeof writeSchema>): Promise<WriteResult> {
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the To address, subject and message." };
  const d = parsed.data;
  const m = await db.message.findUnique({ where: { id: d.draftId } });
  if (!m || (m.status !== "draft" && m.status !== "held")) return { ok: false, error: "This draft can no longer be edited.", stale: true };
  if (m.updatedAt.toISOString() !== d.expectedUpdatedAt) return { ok: false, error: "The draft changed since you opened it. Reload first.", stale: true };
  await db.$transaction([
    db.message.update({ where: { id: m.id }, data: { toEmail: d.to, subject: d.subject, body: d.body, tone: d.tone } }),
    db.auditEvent.create({
      data: {
        businessId: (await db.customer.findUniqueOrThrow({ where: { id: m.customerId } })).businessId,
        caseId: m.caseId, customerId: m.customerId, invoiceId: m.invoiceId, at: now(), actor: currentUser.name,
        type: "draft_saved", summary: "Draft saved", detail: `${d.tone} tone · by ${currentUser.name}`,
      },
    }),
  ]);
  revalidatePath(`/communications/${m.id}`);
  return { ok: true };
}

/**
 * Approve & send. Re-checks sendGuard and the amounts rule at send time. DEMO_MODE: the message is
 * logged (demoOnly) and nothing leaves the building. Otherwise sends through Resend when configured.
 */
export async function approveAndSend(input: z.infer<typeof writeSchema>): Promise<WriteResult> {
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the To address, subject and message." };
  const d = parsed.data;

  const ctx = await getDraftContext(d.draftId);
  if (!ctx) return { ok: false, error: "Draft not found" };
  const { m } = ctx;
  if (m.status !== "draft" && m.status !== "held") return { ok: false, error: "This message is no longer a draft.", stale: true };
  if (m.updatedAt.toISOString() !== d.expectedUpdatedAt) return { ok: false, error: "The draft changed since you opened it. Reload first.", stale: true };

  // Status is re-checked at send time — fresh query, not the page's copy
  const [payments, cases] = await Promise.all([
    db.payment.findMany({ where: { customerId: m.customerId, status: "unallocated", amountCents: { gt: 0 } }, select: { id: true, customerId: true, status: true, amountCents: true } }),
    db.case.findMany({ where: { customerId: m.customerId }, select: { id: true, customerId: true, cause: true, status: true } }),
  ]);
  const guard = sendGuard(m.customerId, { payments, cases });
  if (guard.blocked) {
    return {
      ok: false,
      blocked: true,
      error: guard.reason === "unmatched_payment" ? "Sending paused: this customer has a receipt waiting to be matched." : "Sending paused: this customer has an open dispute.",
    };
  }
  const issues = draftAmountIssues(`${d.subject}\n${d.body}`, ctx.allowedCents);
  if (issues.length) return { ok: false, error: `Amounts that don't match the invoice: ${issues.join(", ")}. Edit the message first.` };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const finalBody = d.body.replaceAll("[PAY LINK]", `${appUrl}/pay/${m.id}`);
  const demoOnly = isDemoMode() || !process.env.RESEND_API_KEY;

  if (!demoOnly) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "Fresh Harvest Produce <onboarding@resend.dev>",
      to: d.to,
      subject: d.subject,
      text: finalBody,
    });
    if (error) return { ok: false, error: `Email provider error: ${error.message}. Nothing was sent.` };
  } else {
    console.info(`[demo] would send email to ${d.to}: ${d.subject}`);
  }

  const at = now();
  await db.$transaction([
    db.message.update({
      where: { id: m.id },
      data: { toEmail: d.to, subject: d.subject, body: finalBody, tone: d.tone, status: "sent", occurredAt: at, approvedBy: currentUser.name, demoOnly },
    }),
    ...(m.caseId
      ? [db.case.update({ where: { id: m.caseId }, data: { status: "waiting_on_customer", diagnosisConfirmed: true } })]
      : []),
    db.auditEvent.create({
      data: {
        businessId: m.customer.businessId, caseId: m.caseId, customerId: m.customerId, invoiceId: m.invoiceId, at,
        actor: currentUser.name, type: "message_sent",
        summary: `${d.tone[0].toUpperCase()}${d.tone.slice(1)} ${d.tone === "warm" ? "nudge" : "reminder"} ${demoOnly ? "logged — not sent (demo mode)" : "sent"}`,
        detail: `approved by ${currentUser.name}`,
        data: { messageId: m.id, to: d.to, subject: d.subject, demoOnly },
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true, demoOnly };
}

/** "Ask Tony to review": a Task for Tony with the current draft. Nothing is sent. */
export async function askTonyToReview(input: { draftId: string }): Promise<WriteResult> {
  const m = await db.message.findUnique({ where: { id: input.draftId }, include: { customer: true } });
  if (!m || (m.status !== "draft" && m.status !== "held")) return { ok: false, error: "This draft can no longer be reviewed." };
  const open = await db.task.findFirst({ where: { status: "open", data: { path: ["messageId"], equals: m.id } } });
  if (open) return { ok: false, error: "Already waiting for Tony's review." };
  await db.$transaction([
    db.task.create({
      data: {
        businessId: m.customer.businessId, customerId: m.customerId, caseId: m.caseId, assignee: "Tony",
        title: `Review the email to ${m.customer.name}`, detail: m.subject, createdBy: currentUser.name, data: { messageId: m.id },
      },
    }),
    db.auditEvent.create({
      data: {
        businessId: m.customer.businessId, caseId: m.caseId, customerId: m.customerId, invoiceId: m.invoiceId, at: now(), actor: currentUser.name,
        type: "review_requested", summary: "Sent to Tony for review", detail: m.subject,
      },
    }),
  ]);
  revalidatePath(`/communications/${m.id}`);
  return { ok: true };
}
