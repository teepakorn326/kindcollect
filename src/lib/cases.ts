// Server-side case queries + derived view data. Every amount shown comes from lib/rules + lib/money.
import { cache } from "react";
import type { CaseStatus, Prisma } from "@prisma/client";
import { db } from "./db";
import { BUSINESS_ID } from "./demo/seed";
import { daysOverdue, today } from "./clock";
import { formatAud } from "./money";
import { formatDay } from "./format";
import { creditNote, proposePaymentPlan, queueOrder, sendGuard, type SendGuardResult } from "./rules";
import type { FollowupKey, PaymentStatusKey } from "./status";

/** Cases that need a person: shown by default in the queue and counted in the sidebar. */
export const OPEN_STATUSES: CaseStatus[] = ["needs_approval", "needs_review"];

export const caseInclude = {
  customer: true,
  invoice: {
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      creditNotes: { orderBy: { approvedAt: "asc" } },
      returns: { include: { creditNote: true }, orderBy: { date: "asc" } },
      allocations: true,
    },
  },
  messages: { orderBy: { occurredAt: "asc" } },
  calls: true,
  paymentPlans: { include: { instalments: { orderBy: { sequence: "asc" } } } },
} satisfies Prisma.CaseInclude;

export type CaseWithRelations = Prisma.CaseGetPayload<{ include: typeof caseInclude }>;

export type CaseContext = {
  gstFree: boolean;
  /** unallocated receipts by customer (for SendGuard + "Match payment" links) */
  unallocatedPayments: { id: string; customerId: string | null; status: "unallocated"; amountCents: number }[];
  /** all open cases (for dispute checks) */
  allCases: { id: string; customerId: string; cause: CaseWithRelations["cause"]; status: CaseStatus }[];
};

export type CaseAction = { label: string; detail: string; href: string };

/** The suggested next action for a case, with amounts computed by rules (never from seed text or the LLM). */
export function caseAction(c: CaseWithRelations, ctx: CaseContext, asOf: Date = today()): CaseAction {
  const self = `/queue/${c.id}`;
  const money = (cents: number) => formatAud(cents, { cents: false });

  switch (c.cause) {
    case "paid_not_matched": {
      const p = ctx.unallocatedPayments.find((x) => x.customerId === c.customerId);
      return p
        ? { label: "Match payment", detail: c.suggestedActionDetail, href: `/payments/${p.id}/review` }
        : { label: "Payment matched", detail: "No unmatched receipt left for this customer", href: self };
    }
    case "invoice_issue_ours": {
      const open = c.invoice.returns.filter((r) => !r.creditNote);
      if (open.length > 0) {
        const cn = creditNote(open, { gstFree: ctx.gstFree });
        return {
          label: `Approve ${money(cn.totalCents)} credit note`,
          detail: `Then send corrected invoice ${money(c.invoice.balanceCents - cn.totalCents)}`,
          href: self,
        };
      }
      const last = c.invoice.creditNotes.at(-1);
      return {
        label: "Send corrected invoice",
        detail: last ? `Credit note ${last.number} approved · balance ${money(c.invoice.balanceCents)}` : c.suggestedActionDetail,
        href: self,
      };
    }
    case "probably_forgot": {
      const draft = c.messages.find((m) => m.direction === "outbound" && m.status === "draft");
      return { label: c.suggestedAction, detail: c.suggestedActionDetail, href: draft ? `/communications/${draft.id}` : self };
    }
    case "cash_flow": {
      const agreed = c.paymentPlans.find((p) => p.status === "approved");
      if (agreed) {
        return {
          label: "Plan agreed",
          detail: agreed.instalments.map((i) => `${money(i.amountCents)} ${formatDay(i.dueDate)}`).join(" · "),
          href: `${self}#plan`,
        };
      }
      const plan = proposePaymentPlan(c.invoice.balanceCents, asOf);
      const same = plan.every((p) => p.amountCents === plan[0].amountCents);
      return {
        label: same ? `Offer ${plan.length} × ${money(plan[0].amountCents)} plan` : `Offer ${plan.length}-instalment plan`,
        detail: `Instalments ${plan.map((p) => formatDay(p.dueDate)).join(" and ")} · routine reminders stop`,
        href: `${self}#plan`,
      };
    }
    case "habitual_late": {
      const call = c.calls[0];
      return { label: c.suggestedAction, detail: c.suggestedActionDetail, href: call ? `/calls/${call.id}` : `/customers/${c.customerId}` };
    }
    case "blocked_on_customer_po":
      return {
        label: "Wait for the PO to reopen",
        detail: c.commitmentDate ? `Payment promised ${formatDay(c.commitmentDate)}` : c.suggestedActionDetail,
        href: self,
      };
    default:
      return { label: "Review diagnosis", detail: "Not enough evidence to suggest an action", href: self };
  }
}

export function paymentKey(invoice: CaseWithRelations["invoice"], asOf: Date = today()): PaymentStatusKey {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  if (invoice.allocations.length > 0 && invoice.balanceCents > 0) return "partially_paid";
  return daysOverdue(invoice.dueDate, asOf) > 0 ? "unpaid" : "not_due";
}

export function followupKey(c: CaseWithRelations): FollowupKey {
  if (c.messages.some((m) => m.status === "held")) return "held";
  if (c.paymentPlans.some((p) => p.status === "approved")) return "plan_agreed";
  return c.remindersPaused ? "paused" : "active";
}

export function guardFor(customerId: string, ctx: CaseContext): SendGuardResult {
  return sendGuard(customerId, { payments: ctx.unallocatedPayments, cases: ctx.allCases });
}

async function loadContext(): Promise<CaseContext> {
  const [business, unallocatedPayments, allCases] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: BUSINESS_ID }, select: { gstFree: true } }),
    db.payment.findMany({
      where: { businessId: BUSINESS_ID, status: "unallocated", amountCents: { gt: 0 } },
      select: { id: true, customerId: true, status: true, amountCents: true },
      orderBy: { date: "asc" },
    }),
    db.case.findMany({ where: { businessId: BUSINESS_ID }, select: { id: true, customerId: true, cause: true, status: true } }),
  ]);
  return {
    gstFree: business.gstFree,
    unallocatedPayments: unallocatedPayments as CaseContext["unallocatedPayments"],
    allCases,
  };
}

export type QueueRow = {
  c: CaseWithRelations;
  daysOverdue: number;
  action: CaseAction;
  guard: SendGuardResult;
};

/** All cases in rule order, with derived row data. Filtering happens in the page. */
export async function getQueue() {
  const [cases, ctx, lastSync] = await Promise.all([
    db.case.findMany({ where: { businessId: BUSINESS_ID }, include: caseInclude, relationLoadStrategy: "join" }),
    loadContext(),
    db.payment.aggregate({ where: { businessId: BUSINESS_ID }, _max: { syncedAt: true } }),
  ]);
  const asOf = today();
  const ordered = queueOrder(
    cases.map((c) => ({ ...c, dueDate: c.invoice.dueDate })),
    asOf
  );
  const rows: QueueRow[] = ordered.map((c) => ({
    c,
    daysOverdue: daysOverdue(c.invoice.dueDate, asOf),
    action: caseAction(c, ctx, asOf),
    guard: guardFor(c.customerId, ctx),
  }));
  return { rows, lastSyncedAt: lastSync._max.syncedAt };
}

export async function getOpenCaseCount(): Promise<number> {
  return db.case.count({ where: { businessId: BUSINESS_ID, status: { in: OPEN_STATUSES } } });
}

/** cache(): generateMetadata and the page share one load per request. */
export const getCaseDetail = cache(async (id: string) => {
  const c = await db.case.findUnique({
    relationLoadStrategy: "join",
    where: { id },
    include: {
      ...caseInclude,
      evidence: { include: { message: true, return: true, payment: true }, orderBy: { occurredAt: "asc" } },
      auditEvents: { orderBy: { at: "asc" } },
    },
  });
  if (!c) return null;
  const [ctx, invoiceMessages] = await Promise.all([
    loadContext(),
    db.message.findMany({ where: { invoiceId: c.invoiceId }, orderBy: { occurredAt: "asc" } }),
  ]);
  const asOf = today();
  return {
    c,
    ctx,
    invoiceMessages,
    asOf,
    daysOverdue: daysOverdue(c.invoice.dueDate, asOf),
    action: caseAction(c, ctx, asOf),
    guard: guardFor(c.customerId, ctx),
  };
});
