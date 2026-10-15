// Payment Matching view data. The proposal comes from matchPayment() (lib/rules) — never from the AI.
import { cache } from "react";
import { db } from "./db";
import { BUSINESS_ID } from "./demo/seed";
import { daysOverdue, today } from "./clock";
import { isDigitTransposition, matchPayment, type MatchResult } from "./rules";

const DAY_MS = 86_400_000;

/** Fingerprint the page compares against to detect stale data (TanStack Query poll + server re-check). */
export async function getPaymentState(paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, updatedAt: true, customerId: true, allocations: { select: { amountCents: true } } },
  });
  if (!payment) return null;
  const invoices = payment.customerId
    ? await db.invoice.findMany({
        where: { customerId: payment.customerId },
        select: { id: true, number: true, balanceCents: true, status: true, updatedAt: true },
      })
    : [];
  return {
    payment: { id: payment.id, status: payment.status, updatedAt: payment.updatedAt.toISOString() },
    invoices: invoices.map((i) => ({ ...i, updatedAt: i.updatedAt.toISOString() })),
  };
}
export type PaymentState = NonNullable<Awaited<ReturnType<typeof getPaymentState>>>;

export const getPaymentReview = cache(async (paymentId: string) => {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    relationLoadStrategy: "join",
    include: { customer: true, allocations: { include: { invoice: true }, orderBy: { confirmedAt: "asc" } } },
  });
  if (!payment) return null;

  const [customers, invoices, statement, heldReminders, lastSync, rejection] = await Promise.all([
    db.customer.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, name: true, bankPayerNames: true } }),
    db.invoice.findMany({
      where: { businessId: BUSINESS_ID },
      select: { id: true, number: true, customerId: true, status: true, balanceCents: true, totalCents: true, currency: true, issueDate: true, dueDate: true, paidAt: true, updatedAt: true },
    }),
    // statement excerpt: the receipt's day and the day before
    db.payment.findMany({
      where: { businessId: BUSINESS_ID, date: { gte: new Date(payment.date.getTime() - DAY_MS), lte: new Date(payment.date.getTime() + DAY_MS / 2) } },
      orderBy: [{ date: "asc" }, { amountCents: "asc" }],
    }).then((lines) =>
      // statement order: by day, receipts before money out
      lines.sort((a, b) => a.date.getTime() - b.date.getTime() || Number(a.amountCents < 0) - Number(b.amountCents < 0) || a.amountCents - b.amountCents)
    ),
    payment.customerId
      ? db.message.findMany({ where: { customerId: payment.customerId, status: { in: ["held", "cancelled"] } }, orderBy: { occurredAt: "asc" } })
      : Promise.resolve([]),
    db.payment.aggregate({ where: { businessId: BUSINESS_ID }, _max: { syncedAt: true } }),
    db.auditEvent.findFirst({
      where: { type: "match_rejected", data: { path: ["paymentId"], equals: paymentId } },
      orderBy: { at: "desc" },
    }),
  ]);

  // Rules run against the receipt's remaining (unallocated) amount
  const allocatedCents = payment.allocations.reduce((s, a) => s + a.amountCents, 0);
  const match: MatchResult = matchPayment(
    { id: payment.id, amountCents: payment.amountCents - allocatedCents, currency: payment.currency, payerName: payment.payerName, reference: payment.reference },
    customers,
    invoices
  );

  const asOf = today();
  const customerId = match.customerId ?? payment.customerId;
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const target = match.kind === "possible_match" ? byId.get(match.invoiceId) : undefined;
  const referenced = match.kind === "possible_match" && match.referenceInvoiceNumber ? invoices.find((i) => i.number === match.referenceInvoiceNumber) : undefined;
  const otherOpen = invoices.filter(
    (i) => i.customerId === customerId && i.status === "sent" && i.balanceCents > 0 && i.id !== target?.id
  );

  return {
    payment,
    allocatedCents,
    match,
    asOf,
    target: target ? { ...target, daysOverdue: daysOverdue(target.dueDate, asOf) } : undefined,
    referenced: referenced && referenced.id !== target?.id ? referenced : undefined,
    otherOpen: otherOpen.map((i) => ({ ...i, daysOverdue: daysOverdue(i.dueDate, asOf) })),
    transposed: !!(target && referenced && isDigitTransposition(referenced.number, target.number)),
    statement,
    heldReminders,
    lastSyncedAt: lastSync._max.syncedAt,
    /** a person said the suggested match is wrong — don't pre-fill it again */
    rejection,
  };
});
export type PaymentReview = NonNullable<Awaited<ReturnType<typeof getPaymentReview>>>;
