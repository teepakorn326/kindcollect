// Email Approval: facts (from our DB, never from the AI), tone rationale, guard, and draft_message input.
import type { Tone } from "@prisma/client";
import { cache } from "react";
import { db } from "./db";
import { calendarDaysBetween, daysOverdue, today, sydneyYmd } from "./clock";
import { formatAud } from "./money";
import { formatDay } from "./format";
import { sendGuard } from "./rules";
import { paymentHistory } from "./ai/diagnosis";
import { runTool } from "./ai/client";

export type Fact = { id: string; text: string; source: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;
const month = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", month: "long" });

/** Recommended tone by cause: warm for loyal customers, firm only where reminders have stopped working. */
export const recommendedTone: Record<string, Tone> = {
  probably_forgot: "warm",
  cash_flow: "warm",
  paid_not_matched: "neutral",
  invoice_issue_ours: "neutral",
  blocked_on_customer_po: "neutral",
  habitual_late: "firm",
  unknown: "neutral",
};

export const getDraftContext = cache(async (draftId: string) => {
  const m = await db.message.findUnique({
    where: { id: draftId },
    relationLoadStrategy: "join",
    include: { customer: true, invoice: true, case: true },
  });
  if (!m || m.direction !== "outbound" || !m.invoice) return null;
  const inv = m.invoice;
  const asOf = today();

  const [history, payments, cases, inbound, returns, pastOutbound, yearInvoices, allHeld] = await Promise.all([
    paymentHistory(m.customerId),
    db.payment.findMany({ where: { status: "unallocated", amountCents: { gt: 0 } }, select: { id: true, customerId: true, status: true, amountCents: true } }),
    db.case.findMany({ select: { id: true, customerId: true, cause: true, status: true } }),
    db.message.count({ where: { customerId: m.customerId, direction: "inbound", occurredAt: { gte: inv.issueDate } } }),
    db.return.count({ where: { invoiceId: inv.id } }),
    db.message.count({ where: { invoiceId: inv.id, direction: "outbound", status: "sent" } }),
    db.invoice.findMany({
      where: { customerId: m.customerId, issueDate: { gte: new Date(asOf.getTime() - 365 * DAY_MS) } },
      select: { totalCents: true },
    }),
    db.message.findMany({ where: { status: "held" }, include: { customer: true } }),
  ]);
  const guard = sendGuard(m.customerId, { payments, cases });
  const overdue = daysOverdue(inv.dueDate, asOf);
  const unmatched = payments.filter((p) => p.customerId === m.customerId);

  // ---- facts (ids are what the AI may cite; text is ours) ----
  const facts: Fact[] = [
    { id: "f-invoice", text: `${inv.number} · ${formatAud(inv.balanceCents)} · due ${formatDay(inv.dueDate)}`, source: "invoice record" },
    { id: "f-period", text: `${inv.number} is for ${month.format(inv.issueDate)}'s produce`, source: "invoice record" },
  ];
  if (overdue > 0) facts.push({ id: "f-overdue", text: `${overdue} days overdue`, source: "invoice record" });
  if (unmatched.length === 0 && inbound === 0 && returns === 0) {
    facts.push({ id: "f-quiet", text: "No payment, no reply, no return logged", source: "bank feed, inbox, driver app" });
  }
  if (history.invoicesCompleted > 0) {
    facts.push(
      history.paidOnTime === history.invoicesCompleted
        ? { id: "f-history", text: "Never late before", source: "payment history" }
        : { id: "f-history", text: `Paid on time ${history.paidOnTime} of ${history.invoicesCompleted} invoices`, source: "payment history" }
    );
  }
  facts.push({
    id: "f-contact",
    text: pastOutbound === 0 ? "First reminder for this invoice" : `${pastOutbound} earlier reminder${pastOutbound > 1 ? "s" : ""} for this invoice`,
    source: "outbox",
  });
  const day = m.customer.deliveryDays && WEEKDAYS.indexOf(m.customer.deliveryDays);
  if (typeof day === "number" && day >= 0) {
    const ahead = ((day - new Date(asOf.getTime() + 11 * 3600_000).getUTCDay() + 7) % 7) || 7;
    const next = new Date(asOf.getTime() + ahead * DAY_MS);
    facts.push({ id: "f-delivery", text: `Next delivery ${WEEKDAYS[day]} ${formatDay(next)}`, source: "delivery schedule" });
  }
  if (m.customer.payLinkEnabled) facts.push({ id: "f-paylink", text: "Pay link enabled for this customer", source: "settings" });

  // ---- why this tone (numbers from the DB) ----
  const tone = recommendedTone[m.case?.cause ?? "unknown"];
  const yearly = yearInvoices.reduce((s, i) => s + i.totalCents, 0);
  const since = history.customerSince ? calendarDaysBetween(new Date(`${history.customerSince}-01T12:00:00+10:00`), asOf) : 0;
  const years = since >= 700 ? "over two years" : since >= 365 ? "over a year" : "since they started";
  const name = m.customer.name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "");
  const why =
    tone === "warm" && history.paidOnTime === history.invoicesCompleted && history.invoicesCompleted > 0
      ? `${name} has paid ${history.paidOnTime} of ${history.invoicesCompleted} invoices on time ${years}. A firm tone would risk a ${formatAud(yearly, { cents: false })}-a-year relationship over a ${overdue}-day slip.`
      : tone === "firm"
        ? `${name} has paid ${history.paidOnTime} of ${history.invoicesCompleted} invoices on time (median ${history.medianDaysLate} days late) and ${pastOutbound} reminders went unanswered. A firmer tone is proportionate; it stays courteous.`
        : `A plain, polite reminder fits: ${overdue > 0 ? `${overdue} days overdue` : "not yet overdue"}, ${pastOutbound} earlier reminder${pastOutbound === 1 ? "" : "s"}.`;

  const allowedCents = [inv.balanceCents, inv.totalCents];
  const blockedOthers = allHeld
    .filter((h) => h.customerId !== m.customerId)
    .map((h) => ({ h, g: sendGuard(h.customerId, { payments, cases }) }))
    .filter((x) => x.g.blocked);

  return { m, inv, facts, guard, overdue, recommended: tone, why, allowedCents, history, pastOutbound, blockedOthers, unmatched };
});

export type DraftContext = NonNullable<Awaited<ReturnType<typeof getDraftContext>>>;

/** draft_message input — stable across resets so the AI cache keeps working. */
export function draftInput(ctx: DraftContext, tone: Tone) {
  return {
    customer: { name: ctx.m.customer.name, contact_first_name: ctx.m.customer.contactName.split(" ")[0] },
    invoice: { number: ctx.inv.number, due: sydneyYmd(ctx.inv.dueDate) },
    cause: ctx.m.case?.cause ?? "unknown",
    tone,
    facts: ctx.facts.map(({ id, text }) => ({ id, text })),
  };
}

export async function generateDraft(ctx: DraftContext, tone: Tone, fresh = false) {
  const outcome = await runTool("draft_message", draftInput(ctx, tone), { preferCache: !fresh });
  const factIds = new Set(ctx.facts.map((f) => f.id));
  return { ...outcome, output: { ...outcome.output, facts_used: outcome.output.facts_used.filter((id) => factIds.has(id)) } };
}
