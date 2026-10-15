"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { dateOnly, now, sydneyYmd, today } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { formatDay } from "@/lib/format";
import { asOutcome, asTurns, CallError, loadRehearsal } from "@/lib/calls";
import { applyClassification, classifyCase } from "@/lib/ai/diagnosis";
import { AiUnavailableError } from "@/lib/ai/client";
import { causeStatus } from "@/lib/status";

type Result = { ok: true; note?: string } | { ok: false; error: string };
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const DAY_MS = 86_400_000;

/** Demo fallback: "Play recording". */
export async function playRecording(callId: string): Promise<Result> {
  try {
    await loadRehearsal(callId);
    revalidatePath(`/calls/${callId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof CallError) return { ok: false, error: e.message };
    if (e instanceof AiUnavailableError) {
      revalidatePath(`/calls/${callId}`);
      return { ok: false, error: `Recording loaded, but the outcome could not be extracted: ${e.message}` };
    }
    console.error("playRecording failed", e);
    return { ok: false, error: "Could not load the recording." };
  }
}

const confirmSchema = z.object({ callId: z.string(), commitmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

/**
 * Sarah confirms what the customer said. Then: classify_case re-runs with the call as evidence, the
 * commitment date she confirmed is set, reminders pause until the day after, a task goes to Tony, audit.
 */
export async function confirmOutcome(input: z.infer<typeof confirmSchema>): Promise<Result> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { callId, commitmentDate } = parsed.data;
  const call = await db.call.findUnique({ where: { id: callId }, include: { customer: true, invoice: true } });
  if (!call) return { ok: false, error: "Call not found" };
  if (call.status !== "ended") return { ok: false, error: "Available when the call ends." };
  if (call.outcomeConfirmedAt) return { ok: false, error: "Already confirmed." };
  const outcome = asOutcome(call.outcome);
  if (!outcome) return { ok: false, error: "No extracted outcome to confirm yet." };
  if (commitmentDate && commitmentDate < sydneyYmd(today())) return { ok: false, error: "The commitment date is in the past." };

  // 1) Re-diagnose with the call transcript as evidence (AI suggests; cached fallback)
  let note: string | undefined;
  let newCause: string | null = null;
  try {
    const cls = await classifyCase(call.caseId);
    await applyClassification(cls, "after AP call");
    newCause = causeStatus[cls.output.cause].label;
  } catch (e) {
    note = e instanceof AiUnavailableError ? `Diagnosis not updated: ${e.message}` : "Diagnosis not updated.";
  }

  // 2) Write what Sarah confirmed
  const at = now();
  const commit = commitmentDate ? dateOnly(commitmentDate) : null;
  const pausedUntil = commit ? new Date(commit.getTime() + DAY_MS) : null;
  const quotes = outcome.quotes.join(" … ");
  await db.$transaction([
    db.call.update({ where: { id: call.id }, data: { outcomeConfirmedBy: currentUser.name, outcomeConfirmedAt: at } }),
    db.case.update({
      where: { id: call.caseId },
      data: {
        commitmentDate: commit,
        remindersPaused: true,
        remindersPausedUntil: pausedUntil,
        status: "waiting_on_customer",
        diagnosisConfirmed: true,
      },
    }),
    db.evidence.upsert({
      where: { id: `ev-${call.id}` },
      create: {
        id: `ev-${call.id}`, caseId: call.caseId, type: "call",
        title: call.source === "rehearsal" ? "Phone call · AP (rehearsal recording)" : "Phone call · Accounts Payable",
        excerpt: quotes || asTurns(call.transcript).filter((t) => t.speaker === "customer").map((t) => t.text).join(" "),
        highlight: outcome.blocker ?? null, sourceRef: `call:${call.id}`, occurredAt: call.endedAt ?? at,
      },
      update: {},
    }),
    db.task.create({
      data: {
        businessId: call.customer.businessId, customerId: call.customerId, caseId: call.caseId, assignee: "Tony",
        title: outcome.blocker ? "Ask AP to confirm the PO is reopened" : "Follow up the payment commitment",
        detail: [outcome.blocker, commit ? `Payment promised ${formatDay(commit)}` : null].filter(Boolean).join(" · "),
        createdBy: currentUser.name, data: { callId: call.id },
      },
    }),
    db.auditEvent.create({
      data: {
        businessId: call.customer.businessId, caseId: call.caseId, customerId: call.customerId, invoiceId: call.invoiceId, at,
        actor: currentUser.name, type: "call_outcome_confirmed",
        summary: `Call outcome confirmed${commit ? ` · payment promised ${formatDay(commit)}` : ""}`,
        detail: [newCause ? `cause → ${lowerFirst(newCause)}` : null, pausedUntil ? `reminders paused until ${formatDay(pausedUntil)}` : null, "task for Tony"]
          .filter(Boolean)
          .join(" · "),
        data: { callId: call.id, outcome, commitmentDate, source: call.source },
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true, note };
}
