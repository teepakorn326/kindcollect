// "Sync bank feed" (mock input, real logic): insert the next seeded bank line, then re-run
// matchPayment + sendGuard for the affected customer. Rules may hold drafts and re-diagnose; nothing is allocated.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { BUSINESS_ID, PENDING_BANK_LINES } from "./demo/seed";
import { dateOnly, now } from "./clock";
import { formatAud } from "./money";
import { formatDay } from "./format";
import { matchPayment, sendGuard } from "./rules";

export type SyncResult =
  | { inserted: null; message: string }
  | {
      inserted: { id: string; description: string; amountCents: number };
      match: { kind: "possible_match"; invoiceNumber: string } | { kind: "no_match"; reason: string };
      heldDrafts: number;
      sendingPaused: boolean;
      remaining: number;
    };

export async function syncNextBankLine(): Promise<SyncResult> {
  const existing = await db.payment.findMany({ where: { id: { in: PENDING_BANK_LINES.map((l) => l.id) } }, select: { id: true } });
  const pending = PENDING_BANK_LINES.filter((l) => !existing.some((e) => e.id === l.id));
  const next = pending[0];
  if (!next) return { inserted: null, message: "Bank feed is up to date — no new lines." };

  return db.$transaction(
    async (tx) => {
      const at = now();
      const [customers, invoices] = await Promise.all([
        tx.customer.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, name: true, bankPayerNames: true } }),
        tx.invoice.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, number: true, customerId: true, status: true, balanceCents: true, currency: true } }),
      ]);
      const match = matchPayment(
        { id: next.id, amountCents: next.amountCents, currency: "AUD", payerName: next.payerName, reference: next.reference },
        customers,
        invoices
      );
      const customerId = match.customerId ?? null;
      const customer = customers.find((c) => c.id === customerId);

      await tx.payment.create({
        data: {
          id: next.id, businessId: BUSINESS_ID, customerId, date: dateOnly(next.date), amountCents: next.amountCents,
          payerName: next.payerName, reference: next.reference, description: next.description, status: "unallocated", syncedAt: at,
        },
      });

      const events: Prisma.AuditEventCreateManyInput[] = [];
      const cs = match.kind === "possible_match" ? await tx.case.findFirst({ where: { invoiceId: match.invoiceId, status: { not: "resolved" } } }) : null;
      events.push({
        businessId: BUSINESS_ID, customerId, caseId: cs?.id, invoiceId: match.kind === "possible_match" ? match.invoiceId : undefined, at,
        actor: "Bank feed", type: "payment_received",
        summary: `${formatAud(next.amountCents, { cents: false })} received · ref “${next.reference}”`,
        detail: match.kind === "possible_match" ? `possible match ${match.invoiceNumber}` : "no safe match — in suspense",
      });

      // Rule: a receipt from this customer is waiting → hold outbound drafts (sendGuard would block them anyway)
      let heldDrafts = 0;
      if (customerId) {
        const drafts = await tx.message.findMany({ where: { customerId, direction: "outbound", status: "draft" } });
        if (drafts.length) {
          await tx.message.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: "held" } });
          heldDrafts = drafts.length;
          events.push({
            businessId: BUSINESS_ID, customerId, caseId: drafts[0].caseId, invoiceId: drafts[0].invoiceId, at: new Date(at.getTime() + 1),
            actor: "Rule", type: "reminder_held", summary: drafts.length > 1 ? `${drafts.length} reminders held` : "Reminder held",
            detail: "rule: receipt waiting to be matched",
          });
        }
      }

      // Rule re-diagnosis: the receipt plausibly pays this invoice → paid, not matched (suggested, unconfirmed)
      if (match.kind === "possible_match" && cs && customer) {
        await tx.case.update({
          where: { id: cs.id },
          data: {
            cause: "paid_not_matched",
            summary: `${customer.name} paid ${formatAud(next.amountCents)} on ${formatDay(dateOnly(next.date))} with reference “${next.reference}”. It equals the balance of ${match.invoiceNumber}.`,
            causeEvidenceLine: `Bank: ${formatAud(next.amountCents, { cents: false })} received ${formatDay(dateOnly(next.date))}, ref “${next.reference}”`,
            suggestedAction: "Match payment",
            suggestedActionDetail: heldDrafts ? "Reminder held automatically" : "Confirm the match",
            whoActs: "sarah",
            confidence: "high",
            diagnosisConfirmed: null,
            remindersPaused: true,
            status: "needs_approval",
          },
        });
        await tx.evidence.create({
          data: {
            id: `ev-${next.id}`, caseId: cs.id, type: "bank", title: "Bank receipt",
            excerpt: `${formatDay(dateOnly(next.date))} · ${next.description} · ${formatAud(next.amountCents)}`, highlight: next.reference,
            sourceRef: `bank:${next.id}`, occurredAt: dateOnly(next.date), paymentId: next.id,
          },
        });
        events.push({
          businessId: BUSINESS_ID, customerId, caseId: cs.id, invoiceId: cs.invoiceId, at: new Date(at.getTime() + 2),
          actor: "Rule", type: "case_classified", summary: "Re-diagnosed: paid · not matched", detail: "rule: amount matches an open invoice",
        });
      }
      await tx.auditEvent.createMany({ data: events });

      const guard = customerId
        ? sendGuard(customerId, {
            payments: await tx.payment.findMany({ where: { customerId, status: "unallocated" }, select: { id: true, customerId: true, status: true, amountCents: true } }),
            cases: await tx.case.findMany({ where: { customerId }, select: { id: true, customerId: true, cause: true, status: true } }),
          })
        : { blocked: false as const };

      return {
        inserted: { id: next.id, description: next.description, amountCents: next.amountCents },
        match: match.kind === "possible_match" ? { kind: "possible_match" as const, invoiceNumber: match.invoiceNumber } : { kind: "no_match" as const, reason: match.reason },
        heldDrafts,
        sendingPaused: guard.blocked,
        remaining: pending.length - 1,
      };
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}
