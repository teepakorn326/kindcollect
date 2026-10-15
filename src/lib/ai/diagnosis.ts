// classify_case: build a deterministic input from the DB, call Claude (cached), validate, apply with rules.
import type { CaseCause, Prisma, WhoActs } from "@prisma/client";
import { db } from "../db";
import { daysOverdue, now, today, sydneyYmd } from "../clock";
import { formatAud } from "../money";
import { formatDay } from "../format";
import { pauseReminders, proposePaymentPlan } from "../rules";
import { causeStatus } from "../status";
import { runTool, type AiOutcome } from "./client";
import type { ClassifyOutput } from "./tools";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const whoActsFor: Record<CaseCause, WhoActs> = {
  paid_not_matched: "sarah",
  invoice_issue_ours: "sarah",
  probably_forgot: "sarah_to_customer",
  cash_flow: "tony_approves",
  habitual_late: "tony_decides",
  blocked_on_customer_po: "tony_decides",
  unknown: "sarah",
};

/** Descriptive payment history (facts, no scores). */
export async function paymentHistory(customerId: string) {
  const paid = await db.invoice.findMany({
    where: { customerId, status: "paid", paidAt: { not: null } },
    select: { dueDate: true, paidAt: true, rejectedForMissingPo: true, issueDate: true, totalCents: true },
  });
  const late = paid.map((i) => Math.max(0, daysOverdue(i.dueDate, i.paidAt!))).sort((a, b) => a - b);
  const mid = late.length / 2;
  const median = late.length === 0 ? 0 : late.length % 2 ? late[Math.floor(mid)] : (late[mid - 1] + late[mid]) / 2;
  const firstIssue = paid.reduce<Date | null>((m, i) => (!m || i.issueDate < m ? i.issueDate : m), null);
  return {
    invoicesCompleted: paid.length,
    paidOnTime: late.filter((d) => d === 0).length,
    medianDaysLate: median,
    rejectedForMissingPo: paid.filter((i) => i.rejectedForMissingPo).length,
    customerSince: firstIssue ? sydneyYmd(firstIssue).slice(0, 7) : null,
  };
}

/** Everything classify_case sees. Only stable fields (no updatedAt / wall-clock), so the cache key is reproducible. */
export async function buildClassifyInput(caseId: string) {
  const c = await db.case.findUniqueOrThrow({
    where: { id: caseId },
    relationLoadStrategy: "join",
    include: {
      customer: true,
      invoice: { include: { lines: { orderBy: { sortOrder: "asc" } }, returns: { include: { creditNote: true } }, creditNotes: true } },
      evidence: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
    },
  });
  const [messages, receipts, history, calls] = await Promise.all([
    db.message.findMany({
      where: { customerId: c.customerId, status: { in: ["sent", "received"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    db.payment.findMany({ where: { customerId: c.customerId, status: "unallocated", amountCents: { gt: 0 } }, orderBy: { date: "asc" } }),
    paymentHistory(c.customerId),
    db.call.findMany({ where: { caseId: c.id, status: "ended" }, orderBy: { endedAt: "asc" } }),
  ]);
  const inv = c.invoice;
  const input = {
    today: sydneyYmd(today()),
    customer: { name: c.customer.name, requires_po: c.customer.requiresPo, terms_days: c.customer.termsDays },
    invoice: {
      id: inv.id,
      number: inv.number,
      po_number: inv.poNumber,
      issued: sydneyYmd(inv.issueDate),
      due: sydneyYmd(inv.dueDate),
      days_overdue: daysOverdue(inv.dueDate),
      total: formatAud(inv.totalCents),
      balance: formatAud(inv.balanceCents),
      lines: inv.lines.map((l) => `${l.quantity} × ${l.description} @ ${formatAud(l.unitPriceCents)}`),
      credit_notes: inv.creditNotes.map((n) => `${n.number} ${formatAud(n.amountCents)}`),
    },
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      date: sydneyYmd(m.occurredAt),
      from: m.direction === "inbound" ? m.fromName : "Tony",
      subject: m.subject,
      text: m.body,
      about_invoice: m.invoiceId === inv.id,
    })),
    documents: [
      ...c.evidence.filter((e) => e.type === "document" || e.type === "returns").map((e) => ({ id: e.id, type: e.type, title: e.title, text: e.excerpt })),
      ...calls.map((call) => ({
        id: call.id,
        type: "call",
        title: `Phone call to ${c.customer.name} accounts payable`,
        text: (Array.isArray(call.transcript) ? (call.transcript as { speaker: string; text: string }[]) : [])
          .map((t) => `${t.speaker === "agent" ? "Assistant" : "Customer"}: ${t.text}`)
          .join("\n"),
      })),
      ...inv.returns.map((r) => ({
        id: r.id,
        type: "returns",
        title: `Return ${r.number}`,
        text: `${r.quantity} × ${r.product} returned ${formatDay(r.date)} (${r.reason.toLowerCase()}); credit note: ${r.creditNote ? r.creditNote.number : "none issued"}`,
      })),
    ],
    bank_receipts_unmatched: receipts.map((p) => ({
      id: p.id,
      date: sydneyYmd(p.date),
      amount: formatAud(p.amountCents),
      payer: p.payerName,
      reference_typed: p.reference,
    })),
    history: { id: `history-${c.customerId}`, ...history },
  };
  const allowedIds = new Set<string>([
    ...input.messages.map((m) => m.id),
    ...input.documents.map((d) => d.id),
    ...input.bank_receipts_unmatched.map((p) => p.id),
    input.history.id,
    inv.id,
  ]);
  return { c, input, allowedIds };
}

export type Classification = AiOutcome<ClassifyOutput> & { caseId: string };

/** Run classify_case. Evidence ids the model returns are filtered to ids we actually supplied. */
export async function classifyCase(caseId: string, opts: { preferCache?: boolean } = {}): Promise<Classification> {
  const { input, allowedIds } = await buildClassifyInput(caseId);
  const outcome = await runTool("classify_case", input, opts);
  return {
    ...outcome,
    caseId,
    output: { ...outcome.output, evidence_ids: outcome.output.evidence_ids.filter((id) => allowedIds.has(id)) },
  };
}

/**
 * Apply a classification as the case's (unconfirmed) diagnosis. Rules decide the side effects:
 * reminders pause per pauseReminders(); a cash-flow diagnosis gets a plan *proposal* from proposePaymentPlan()
 * that only Tony can approve. No money moves here.
 */
export async function applyClassification(cls: Classification, actorNote?: string) {
  const { output } = cls;
  return db.$transaction(
    async (tx) => {
      const c = await tx.case.findUniqueOrThrow({ where: { id: cls.caseId }, include: { invoice: true, paymentPlans: true } });
      const at = now();
      const pause = pauseReminders({ cause: output.cause });

      // Evidence: make sure every cited message is attached to the case
      const citedMessages = await tx.message.findMany({ where: { id: { in: output.evidence_ids } } });
      const existing = await tx.evidence.findMany({ where: { caseId: c.id }, select: { messageId: true, id: true } });
      for (const m of citedMessages) {
        if (existing.some((e) => e.messageId === m.id)) continue;
        await tx.evidence.create({
          data: {
            id: `ev-${m.id}`,
            caseId: c.id,
            type: "email",
            title: m.direction === "inbound" ? "Customer reply" : "Our message",
            excerpt: m.body,
            sourceRef: `message:${m.id}`,
            occurredAt: m.occurredAt,
            messageId: m.id,
          },
        });
      }
      const lead = citedMessages.filter((m) => m.direction === "inbound").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

      await tx.case.update({
        where: { id: c.id },
        data: {
          cause: output.cause,
          summary: output.summary,
          suggestedAction: output.suggested_action,
          suggestedActionDetail: output.suggested_action,
          causeEvidenceLine: lead
            ? `Reply ${formatDay(lead.occurredAt)}: “${lead.body.length > 70 ? `${lead.body.slice(0, 70).trimEnd()}…` : lead.body}”`
            : c.causeEvidenceLine,
          confidence: output.confidence,
          whoActs: whoActsFor[output.cause],
          diagnosisConfirmed: null,
          status: c.status === "resolved" ? "resolved" : "needs_approval",
          ...(pause.pause ? { remindersPaused: true } : {}),
        },
      });

      const events: Prisma.AuditEventCreateManyInput[] = [
        {
          businessId: c.businessId,
          caseId: c.id,
          customerId: c.customerId,
          invoiceId: c.invoiceId,
          at,
          actor: "AI",
          type: "case_classified",
          summary: `Classified: ${lowerFirst(causeStatus[output.cause].label)}`,
          detail: `${output.confidence} confidence${cls.cached ? " · cached" : ""}${actorNote ? ` · ${actorNote}` : ""}`,
          data: { output, model: cls.model, cached: cls.cached, reason: cls.reason ?? null },
        },
      ];
      if (pause.pause && !c.remindersPaused) {
        events.push({
          businessId: c.businessId, caseId: c.id, customerId: c.customerId, invoiceId: c.invoiceId,
          at: new Date(at.getTime() + 1), actor: "Rule", type: "reminders_paused", summary: "Reminders paused", detail: pause.reason,
        });
      }

      let planId: string | null = null;
      const openPlan = c.paymentPlans.find((p) => p.status !== "rejected");
      if (output.cause === "cash_flow" && !openPlan && c.invoice.balanceCents > 0) {
        const instalments = proposePaymentPlan(c.invoice.balanceCents, today());
        const plan = await tx.paymentPlan.create({
          data: {
            customerId: c.customerId,
            caseId: c.id,
            invoiceId: c.invoiceId,
            status: "proposed",
            instalments: { create: instalments },
          },
        });
        planId = plan.id;
        events.push({
          businessId: c.businessId, caseId: c.id, customerId: c.customerId, invoiceId: c.invoiceId,
          at: new Date(at.getTime() + 2), actor: "Rule", type: "plan_proposed",
          summary: `Plan drafted · ${instalments.length} × ${formatAud(instalments[0].amountCents, { cents: false })}`,
          detail: `pending Tony's approval`,
          data: { planId: plan.id, instalments: instalments.map((i) => ({ ...i, dueDate: sydneyYmd(i.dueDate) })) },
        });
      }
      await tx.auditEvent.createMany({ data: events });
      return { planId, paused: pause.pause };
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}
