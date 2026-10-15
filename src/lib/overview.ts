// Overview KPIs — every number computed from DB rows with lib/money + lib/rules.
import type { CaseCause } from "@prisma/client";
import { db } from "./db";
import { BUSINESS_ID } from "./demo/seed";
import { daysOverdue, today } from "./clock";
import { addCents } from "./money";
import { getQueue, OPEN_STATUSES, type QueueRow } from "./cases";
import { matchPayment } from "./rules";
import { bucketOrder } from "./status";

const DAY_MS = 86_400_000;
const short = (name: string) => name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "");

/** Causes where the right move is a fix on our side, not a reminder. */
export const DONT_CHASE: CaseCause[] = ["paid_not_matched", "invoice_issue_ours"];

/** Activity feed: the events worth reading on a Monday morning. */
const FEED_TYPES = [
  "reminder_held",
  "reply_received",
  "case_classified",
  "reminders_paused",
  "reminder_sent",
  "payment_received",
  "payment_matched",
  "credit_note_approved",
  "message_sent",
  "plan_proposed",
  "plan_approved",
  "match_rejected",
  "diagnosis_rejected",
  "call_approved",
];

export async function getOverview() {
  const asOf = today();
  const { rows, lastSyncedAt } = await getQueue();

  // "Owed" = unpaid balance on overdue invoices that have a case (the demo's five)
  const overdue: QueueRow[] = rows.filter((r) => r.daysOverdue > 0 && r.c.invoice.balanceCents > 0 && r.c.status !== "resolved");
  const owedCents = addCents(...overdue.map((r) => r.c.invoice.balanceCents));
  const dontChase = overdue.filter((r) => DONT_CHASE.includes(r.c.cause));
  const dontChaseCents = addCents(...dontChase.map((r) => r.c.invoice.balanceCents));
  const chase = overdue.filter((r) => !DONT_CHASE.includes(r.c.cause));
  const chaseCents = owedCents - dontChaseCents;
  const fixCents = dontChaseCents;

  // Already paid, not matched = unallocated receipts in suspense
  const [receipts, customers, invoices, held, plans, commitments, corrected, events] = await Promise.all([
    db.payment.findMany({ where: { businessId: BUSINESS_ID, status: "unallocated", amountCents: { gt: 0 } }, include: { customer: true, allocations: true } }),
    db.customer.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, name: true, bankPayerNames: true } }),
    db.invoice.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, number: true, customerId: true, status: true, balanceCents: true, currency: true } }),
    db.message.findMany({ where: { status: "held" }, select: { customerId: true } }),
    db.paymentPlanInstalment.findMany({
      where: { plan: { status: "approved" }, dueDate: { gte: asOf, lte: new Date(asOf.getTime() + 14 * DAY_MS) } },
      include: { plan: { include: { customer: true } } },
      orderBy: { dueDate: "asc" },
    }),
    db.case.findMany({
      where: { businessId: BUSINESS_ID, status: { not: "resolved" }, commitmentDate: { gte: asOf, lte: new Date(asOf.getTime() + 14 * DAY_MS) } },
      include: { customer: true, invoice: true },
    }),
    db.invoice.findMany({
      where: { businessId: BUSINESS_ID, status: "sent", balanceCents: { gt: 0 }, creditNotes: { some: {} }, dueDate: { gte: asOf, lte: new Date(asOf.getTime() + 14 * DAY_MS) } },
      include: { customer: true },
    }),
    db.auditEvent.findMany({
      where: { businessId: BUSINESS_ID, type: { in: FEED_TYPES } },
      orderBy: { at: "desc" },
      take: 5,
      include: { customer: { select: { name: true } } },
    }),
  ]);

  const unmatchedCents = addCents(...receipts.map((p) => p.amountCents - p.allocations.reduce((s, a) => s + a.amountCents, 0)));
  const unmatchedNotes = receipts.map((p) => {
    const m = matchPayment(
      { id: p.id, amountCents: p.amountCents, currency: p.currency, payerName: p.payerName, reference: p.reference },
      customers,
      invoices
    );
    const bits = [p.customer ? short(p.customer.name) : p.payerName];
    if (m.kind === "possible_match" && m.referenceStatus !== "open_invoice") bits.push("wrong reference");
    if (p.customerId && held.some((h) => h.customerId === p.customerId)) bits.push("reminder held");
    return bits.join(" · ");
  });

  // Expected in the next 14 days: approved plan instalments + commitments + corrected invoices
  const expected = [
    ...plans.map((i) => ({ key: `plan-${i.id}`, label: `${short(i.plan.customer.name)} ${ordinal(i.sequence)} instalment`, cents: i.amountCents })),
    ...commitments.map((c) => ({ key: `commit-${c.id}`, label: `${short(c.customer.name)} (promised)`, cents: c.invoice.balanceCents })),
    ...corrected.map((i) => ({ key: `corrected-${i.id}`, label: `${short(i.customer.name)} (corrected)`, cents: i.balanceCents })),
  ];
  const expectedCents = addCents(...expected.map((e) => e.cents));

  // Where the money sits, by cause
  const buckets = bucketOrder
    .map((cause) => ({ cause, cents: addCents(...overdue.filter((r) => r.c.cause === cause).map((r) => r.c.invoice.balanceCents)) }))
    .filter((b) => b.cents > 0);

  const emailsToday = overdue.filter((r) => r.c.cause === "probably_forgot" && !r.guard.blocked).length;
  const openActions = rows.filter((r) => OPEN_STATUSES.includes(r.c.status)).length;

  return {
    asOf,
    lastSyncedAt,
    overdue,
    owedCents,
    owedCustomers: new Set(overdue.map((r) => r.c.customerId)).size,
    chaseCents,
    chaseCustomers: new Set(chase.map((r) => r.c.customerId)).size,
    fixCents,
    dontChaseCount: dontChase.length,
    unmatchedCents,
    unmatchedNotes,
    expected,
    expectedCents,
    buckets,
    emailsToday,
    openActions,
    events,
    daysOverdue: (d: Date) => daysOverdue(d, asOf),
  };
}

function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
