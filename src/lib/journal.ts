// Journal export for the accountant (HANDOFF §3, seller side, GST-free). Derived from DB rows — never stored separately.
import { db } from "./db";
import { BUSINESS_ID } from "./demo/seed";
import { sydneyYmd } from "./clock";

export type JournalLine = { date: string; journal: string; account: string; debitCents: number; creditCents: number; memo: string; reference: string };

const ar = (name: string) => `Accounts Receivable – ${name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "")}`;

export async function journalLines(): Promise<JournalLine[]> {
  const [invoices, payments, creditNotes, matched] = await Promise.all([
    db.invoice.findMany({ where: { businessId: BUSINESS_ID, status: { in: ["sent", "paid"] } }, include: { customer: true } }),
    db.payment.findMany({ where: { businessId: BUSINESS_ID, amountCents: { gt: 0 }, status: { in: ["allocated", "unallocated"] } }, include: { allocations: { include: { invoice: { include: { customer: true } } } }, customer: true } }),
    db.creditNote.findMany({ include: { invoice: { include: { customer: true } } } }),
    db.auditEvent.findMany({ where: { businessId: BUSINESS_ID, type: "payment_matched" }, select: { data: true } }),
  ]);
  // receipts that went through suspense (matched by a person after landing unallocated)
  const viaSuspense = new Set(matched.map((e) => (e.data as { paymentId?: string } | null)?.paymentId).filter(Boolean) as string[]);
  const lines: JournalLine[] = [];
  const pair = (date: Date, journal: string, dr: string, cr: string, cents: number, memo: string, reference: string) => {
    const d = sydneyYmd(date);
    lines.push({ date: d, journal, account: dr, debitCents: cents, creditCents: 0, memo, reference });
    lines.push({ date: d, journal, account: cr, debitCents: 0, creditCents: cents, memo, reference });
  };

  for (const i of invoices) pair(i.issueDate, `SALE-${i.number}`, ar(i.customer.name), "Sales Revenue", i.totalCents, "Sale on credit", i.number);
  for (const n of creditNotes) pair(n.approvedAt, n.number, "Sales Returns", ar(n.invoice.customer.name), n.amountCents, n.reason, n.invoice.number);
  for (const p of payments) {
    const allocated = p.allocations.reduce((s, a) => s + a.amountCents, 0);
    if (viaSuspense.has(p.id) || p.status === "unallocated") {
      pair(p.date, `RCPT-${p.id}`, "Bank", "Suspense", p.amountCents, `Receipt ${p.payerName} ref ${p.reference}`, p.reference);
      for (const a of p.allocations) pair(a.confirmedAt, `MATCH-${p.id}`, "Suspense", ar(a.invoice.customer.name), a.amountCents, `Matched to ${a.invoice.number} by ${a.confirmedBy}`, a.invoice.number);
    } else {
      for (const a of p.allocations) pair(p.date, `RCPT-${p.id}`, "Bank", ar(a.invoice.customer.name), a.amountCents, `Receipt ${p.payerName}`, a.invoice.number);
      if (p.amountCents > allocated) pair(p.date, `RCPT-${p.id}`, "Bank", "Suspense", p.amountCents - allocated, "Unallocated remainder", p.reference);
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal) || b.debitCents - a.debitCents);
}

const money = (cents: number) => (cents ? `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}` : "");
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(lines: JournalLine[]): string {
  const header = ["Date", "Journal", "Account", "Debit", "Credit", "Memo", "Reference"];
  return [header, ...lines.map((l) => [l.date, l.journal, l.account, money(l.debitCents), money(l.creditCents), l.memo, l.reference])]
    .map((row) => row.map((c) => csvCell(String(c))).join(","))
    .join("\n");
}
