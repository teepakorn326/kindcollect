"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { allocate, formatAud, MoneyError } from "@/lib/money";

type Result = { ok: true } | { ok: false; stale?: boolean; error: string };

class UserError extends Error {
  constructor(
    message: string,
    public stale = false
  ) {
    super(message);
  }
}

const shortName = (name: string) => name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "");

const confirmSchema = z.object({
  paymentId: z.string().min(1),
  allocations: z.array(z.object({ invoiceId: z.string().min(1), cents: z.number().int().positive() })).min(1),
  expectedPaymentUpdatedAt: z.string(),
  /** invoice fingerprints from page load */
  expectedInvoices: z.array(z.object({ id: z.string(), balanceCents: z.number().int(), updatedAt: z.string() })),
});

/**
 * Confirm a (possible) payment match. The allocation is re-validated with allocate() against fresh balances
 * inside one transaction: write Allocations, mark fully-paid invoices paid, cancel held reminders,
 * resolve their cases and append audit events. Never runs without a person clicking Confirm.
 */
export async function confirmMatch(input: z.infer<typeof confirmSchema>): Promise<Result> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { paymentId, allocations, expectedPaymentUpdatedAt, expectedInvoices } = parsed.data;

  const idToNumber = new Map<string, string>();
  try {
    await db.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true, customer: true } });
        if (payment.status !== "unallocated" || payment.updatedAt.toISOString() !== expectedPaymentUpdatedAt) {
          throw new UserError("This receipt changed since you opened the page (it may already be matched). Reload to see the latest.", true);
        }
        const ids = allocations.map((a) => a.invoiceId);
        const invoices = await tx.invoice.findMany({ where: { id: { in: ids } }, include: { customer: true } });
        if (invoices.length !== ids.length) throw new UserError("One of the invoices no longer exists.", true);
        invoices.forEach((i) => idToNumber.set(i.id, i.number));
        for (const inv of invoices) {
          const expected = expectedInvoices.find((e) => e.id === inv.id);
          if (!expected || expected.balanceCents !== inv.balanceCents || expected.updatedAt !== inv.updatedAt.toISOString()) {
            throw new UserError(`${inv.number} changed since you opened the page. Reload to review the latest balance.`, true);
          }
          if (payment.customerId && inv.customerId !== payment.customerId) {
            throw new UserError(`${inv.number} belongs to a different customer than the payer.`);
          }
        }

        const already = payment.allocations.reduce((s, a) => s + a.amountCents, 0);
        // Authoritative money check: throws on over-allocation, balance overrun or currency mismatch
        const result = allocate(
          { cents: payment.amountCents - already, currency: payment.currency },
          allocations.map((a) => {
            const inv = invoices.find((i) => i.id === a.invoiceId)!;
            return { invoiceId: inv.id, cents: a.cents, outstandingCents: inv.balanceCents, currency: inv.currency };
          })
        );

        const at = now();
        await tx.allocation.createMany({
          data: result.allocations.map((a) => ({
            paymentId,
            invoiceId: a.invoiceId,
            amountCents: a.cents,
            confirmedBy: currentUser.name,
            confirmedAt: at,
          })),
        });
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: result.unallocatedCents === 0 ? "allocated" : "unallocated" },
        });

        const paidIds: string[] = [];
        for (const a of result.allocations) {
          const paid = a.balanceAfterCents === 0;
          if (paid) paidIds.push(a.invoiceId);
          await tx.invoice.update({
            where: { id: a.invoiceId },
            data: { balanceCents: a.balanceAfterCents, ...(paid ? { status: "paid", paidAt: payment.date } : {}) },
          });
        }

        // Held reminders for these invoices are cancelled for good
        const held = await tx.message.findMany({ where: { invoiceId: { in: ids }, status: "held" } });
        if (held.length) {
          await tx.message.updateMany({ where: { id: { in: held.map((m) => m.id) } }, data: { status: "cancelled" } });
        }
        const invoiceCases = await tx.case.findMany({ where: { invoiceId: { in: ids } }, select: { id: true, invoiceId: true, customerId: true, status: true } });
        const cases = invoiceCases.filter((c) => paidIds.includes(c.invoiceId) && c.status !== "resolved");
        if (cases.length) {
          await tx.case.updateMany({
            where: { id: { in: cases.map((c) => c.id) } },
            data: { status: "resolved", diagnosisConfirmed: true, remindersPaused: false },
          });
        }

        const customerName = payment.customer?.name ?? payment.payerName;
        const numbers = invoices.map((i) => i.number).join(", ");
        const events = [];
        for (const a of result.allocations) {
          const inv = invoices.find((i) => i.id === a.invoiceId)!;
          const caseId = invoiceCases.find((c) => c.invoiceId === inv.id)?.id;
          events.push({
            businessId: payment.businessId,
            caseId,
            customerId: inv.customerId,
            invoiceId: inv.id,
            at,
            actor: currentUser.name,
            type: "payment_matched",
            summary: `${formatAud(a.cents, { cents: false })} matched to ${inv.number}${a.balanceAfterCents === 0 ? " · paid" : ""}`,
            detail: `confirmed by ${currentUser.name}`,
            data: {
              paymentId,
              referenceTyped: payment.reference,
              allocatedCents: a.cents,
              balanceBeforeCents: a.cents + a.balanceAfterCents,
              balanceAfterCents: a.balanceAfterCents,
              journal: [
                { account: "Suspense", debitCents: a.cents },
                { account: `Accounts Receivable – ${shortName(inv.customer.name)}`, creditCents: a.cents },
              ],
            },
          });
        }
        for (const m of held) {
          const caseId = m.caseId ?? undefined;
          events.push({
            businessId: payment.businessId,
            caseId,
            customerId: m.customerId,
            invoiceId: m.invoiceId,
            at: new Date(at.getTime() + 1),
            actor: "Rule",
            type: "reminder_cancelled",
            summary: "Held reminder cancelled",
            detail: `“${m.subject}” · customer had paid`,
            data: { messageId: m.id },
          });
        }
        for (const c of cases) {
          events.push({
            businessId: payment.businessId,
            caseId: c.id,
            customerId: c.customerId,
            invoiceId: c.invoiceId,
            at: new Date(at.getTime() + 2),
            actor: currentUser.name,
            type: "case_resolved",
            summary: "Case resolved",
            detail: `${customerName} paid · ${numbers}`,
          });
        }
        await tx.auditEvent.createMany({ data: events });
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, stale: e.stale };
    if (e instanceof MoneyError) return { ok: false, error: [...idToNumber].reduce((m, [id, n]) => m.replaceAll(id, n), e.message) };
    console.error("confirmMatch failed", e);
    return { ok: false, error: "Could not confirm the match. Nothing was changed." };
  }
}

const rejectSchema = z.object({ paymentId: z.string().min(1), expectedPaymentUpdatedAt: z.string() });

/** "Not a match": the receipt stays in suspense; the case goes back for review. */
export async function rejectMatch(input: z.infer<typeof rejectSchema>): Promise<Result> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    await db.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: parsed.data.paymentId } });
        if (payment.status !== "unallocated" || payment.updatedAt.toISOString() !== parsed.data.expectedPaymentUpdatedAt) {
          throw new UserError("This receipt changed since you opened the page. Reload to see the latest.", true);
        }
        const cases = payment.customerId
          ? await tx.case.findMany({ where: { customerId: payment.customerId, cause: "paid_not_matched", status: { not: "resolved" } } })
          : [];
        if (cases.length) {
          await tx.case.updateMany({ where: { id: { in: cases.map((c) => c.id) } }, data: { status: "needs_review", diagnosisConfirmed: false } });
        }
        // touch the receipt so other open tabs see it changed
        await tx.payment.update({ where: { id: payment.id }, data: { status: "unallocated" } });
        await tx.auditEvent.create({
          data: {
            businessId: payment.businessId,
            caseId: cases[0]?.id,
            customerId: payment.customerId,
            invoiceId: cases[0]?.invoiceId,
            at: now(),
            actor: currentUser.name,
            type: "match_rejected",
            summary: "Not a match · receipt stays in suspense",
            detail: `by ${currentUser.name}`,
            data: { paymentId: payment.id },
          },
        });
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, stale: e.stale };
    console.error("rejectMatch failed", e);
    return { ok: false, error: "Could not update. Nothing was changed." };
  }
}
