// Customer Account: descriptive history only (on-time count, median days late) — no scores, no labels.
import { cache } from "react";
import { db } from "./db";
import { daysOverdue, today } from "./clock";
import { addCents, formatAud } from "./money";
import { paymentHistory } from "./ai/diagnosis";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Next delivery weekday after today from "Mon/Wed/Fri" or "Thursday". */
export function nextDeliveryDay(deliveryDays: string | null, asOf: Date): string | null {
  if (!deliveryDays) return null;
  const days = deliveryDays.split("/").map((d) => SHORT[d.slice(0, 3)]).filter((d) => d !== undefined);
  if (!days.length) return null;
  const dow = new Date(asOf.getTime() + 11 * 3600_000).getUTCDay();
  const next = days.map((d) => ((d - dow + 7) % 7) || 7).sort((a, b) => a - b)[0];
  return WEEKDAYS[(dow + next) % 7];
}

export const getCustomerAccount = cache(async (id: string) => {
  const c = await db.customer.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      invoices: { orderBy: { dueDate: "desc" }, include: { allocations: { include: { payment: true } } } },
      payments: { orderBy: { date: "desc" } },
      cases: { include: { invoice: true }, orderBy: { createdAt: "desc" } },
      messages: { orderBy: { occurredAt: "desc" } },
      documents: { orderBy: { date: "desc" } },
      calls: true,
      tasks: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) return null;
  const [history, latest, evidenceDocs] = await Promise.all([
    paymentHistory(c.id),
    db.auditEvent.findFirst({ where: { customerId: c.id }, orderBy: { at: "desc" } }),
    db.evidence.findMany({ where: { case: { customerId: c.id }, type: { in: ["document", "returns"] } } }),
  ]);
  const asOf = today();
  const open = c.invoices.filter((i) => i.status === "sent" && i.balanceCents > 0);
  const overdue = open.filter((i) => daysOverdue(i.dueDate, asOf) > 0);
  const disputes = c.cases.filter((k) => k.status !== "resolved" && k.cause === "invoice_issue_ours").length;
  const pattern = history.invoicesCompleted >= 4 && history.medianDaysLate > c.termsDays;
  const limit = c.creditLimitCents;
  return {
    c,
    asOf,
    history: { ...history, activeDisputes: disputes },
    latest,
    evidenceDocs,
    outstandingCents: addCents(...open.map((i) => i.balanceCents)),
    openCount: open.length,
    overdueCents: addCents(...overdue.map((i) => i.balanceCents)),
    oldestOverdue: overdue.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0] ?? null,
    monthlyCents: Math.round(
      addCents(...c.invoices.filter((i) => asOf.getTime() - i.issueDate.getTime() < 182 * 86_400_000).map((i) => i.totalCents)) / 6
    ),
    /** terms options shown only when the descriptive pattern supports it; amounts computed, never from AI */
    termsOptions: pattern
      ? [
          {
            key: "pay_before_delivery",
            title: "Pay before next delivery",
            body: `Hold ${nextDeliveryDay(c.deliveryDays, asOf) ?? "the next"}'s order until ${overdue[0]?.number ?? "the overdue invoice"} is settled. Lowest risk to Tony's cash.`,
          },
          ...(limit
            ? [{ key: "reduce_limit", title: "Reduce credit limit", body: `${formatAud(limit, { cents: false })} → ${formatAud(Math.round(limit / 2 / 100) * 100, { cents: false })}. Keeps supplying, caps exposure.` }]
            : []),
          { key: "final_notice", title: "Final notice only", body: "Firm message, 7-day deadline, then escalate to a call." },
        ]
      : [],
  };
});
