// Demo scenario (HANDOFF §3): Fresh Harvest Produce on Mon 13 Oct 2026.
// Idempotent: truncates every business table, then inserts. Stable ids so pre-opened tabs survive a reset.
// AiResult is NOT truncated — it is the cached fallback for AI calls.
// Plain TS (no path aliases, no TS-only runtime syntax) so `node prisma/seed.ts` can run it directly.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dateOnly, sydney } from "../clock.ts";

export const BUSINESS_ID = "biz-fresh-harvest";

/** Stable ids the UI and e2e spec link to. */
export const DEMO_IDS = {
  customers: {
    city: "cust-city-catering",
    sweet: "cust-sweet-bakery",
    bella: "cust-bellas-cafe",
    noodle: "cust-golden-noodle",
    harbour: "cust-harbourside",
  },
  cases: {
    city: "kc-0045",
    sweet: "kc-0043",
    bella: "kc-0044",
    noodle: "kc-0041",
    harbour: "kc-0039",
  },
  cityPayment: "pay-city-1210",
  cityHeldReminder: "msg-city-reminder-2",
  bellaDraft: "msg-bella-nudge",
  harbourCall: "call-harbourside-1019",
  sweetReturn: "ret-0211",
} as const;

const C = DEMO_IDS.customers;
const K = DEMO_IDS.cases;
const B = BUSINESS_ID;
const TONY_EMAIL = "tony@freshharvest.example";

// Product catalogue (cents, GST-free)
const P = {
  greens: { d: "Mixed salad greens — 5kg box", c: 4700 },
  tomatoes: { d: "Tomatoes, truss — 10kg box", c: 5200 },
  strawberries: { d: "Strawberries 250g — box of 12", c: 4500 },
  herbs: { d: "Mixed herbs — box", c: 2400 },
  avocados: { d: "Avocados, Hass — tray", c: 4000 },
  bokchoy: { d: "Bok choy — box", c: 3000 },
  shallots: { d: "Spring onions — box", c: 2800 },
  sprouts: { d: "Bean sprouts — 10kg", c: 3600 },
  chillies: { d: "Chillies, red — box", c: 4000 },
};
type Line = [keyof typeof P, number];

type InvoiceSpec = {
  id: string;
  customerId: string;
  number: string;
  po?: string;
  issue: string;
  due: string;
  lines?: Line[];
  /** for history invoices: one summary line with this amount */
  amountCents?: number;
  paid?: { date: string; payerName: string };
  rejectedForMissingPo?: boolean;
};

// ---------- invoices ----------

const openInvoices: InvoiceSpec[] = [
  {
    id: "inv-1031", customerId: C.city, number: "INV-1031", issue: "2026-09-20", due: "2026-10-04",
    lines: [["greens", 40], ["tomatoes", 16], ["herbs", 12]], // 3,000.00
  },
  {
    id: "inv-1028", customerId: C.sweet, number: "INV-1028", issue: "2026-09-12", due: "2026-09-26",
    lines: [["strawberries", 48], ["greens", 20]], // 3,100.00
  },
  {
    id: "inv-1030", customerId: C.bella, number: "INV-1030", issue: "2026-09-17", due: "2026-10-01",
    lines: [["strawberries", 20], ["greens", 20], ["tomatoes", 20], ["avocados", 8]], // 3,200.00
  },
  {
    id: "inv-1026", customerId: C.noodle, number: "INV-1026", issue: "2026-09-08", due: "2026-09-22",
    lines: [["bokchoy", 40], ["shallots", 30], ["sprouts", 20], ["chillies", 16]], // 3,400.00
  },
  {
    id: "inv-1019", customerId: C.harbour, number: "INV-1019", po: "HH-PO-2251", issue: "2026-08-15", due: "2026-08-29",
    lines: [["tomatoes", 25], ["strawberries", 20], ["greens", 20], ["avocados", 4]], // 3,300.00
  },
  {
    id: "inv-1033", customerId: C.harbour, number: "INV-1033", po: "HH-PO-2288", issue: "2026-10-08", due: "2026-10-22",
    lines: [["greens", 30], ["tomatoes", 20], ["strawberries", 12], ["avocados", 4]], // 3,150.00 — not due
  },
];

const HARBOUR_PAYER = "HARBOURSIDE HOTEL PTY LTD";
// 8 completed Harbourside invoices: days late 38,44,55,48,43,41,52,46 → median 45; 2 rejected for missing PO
const harbourHistory: InvoiceSpec[] = [
  { id: "inv-0952", customerId: C.harbour, number: "INV-0952", po: "HH-PO-2160", issue: "2026-02-06", due: "2026-02-20", amountCents: 288000, paid: { date: "2026-03-30", payerName: HARBOUR_PAYER } },
  { id: "inv-0961", customerId: C.harbour, number: "INV-0961", po: "HH-PO-2174", issue: "2026-03-06", due: "2026-03-20", amountCents: 314000, paid: { date: "2026-05-03", payerName: HARBOUR_PAYER } },
  { id: "inv-0970", customerId: C.harbour, number: "INV-0970", po: "HH-PO-2185", issue: "2026-04-03", due: "2026-04-17", amountCents: 326000, paid: { date: "2026-06-11", payerName: HARBOUR_PAYER } },
  { id: "inv-0978", customerId: C.harbour, number: "INV-0978", issue: "2026-05-01", due: "2026-05-15", amountCents: 305000, paid: { date: "2026-07-02", payerName: HARBOUR_PAYER }, rejectedForMissingPo: true },
  { id: "inv-0987", customerId: C.harbour, number: "INV-0987", po: "HH-PO-2198", issue: "2026-06-05", due: "2026-06-19", amountCents: 299000, paid: { date: "2026-08-01", payerName: HARBOUR_PAYER } },
  { id: "inv-0996", customerId: C.harbour, number: "INV-0996", po: "HH-PO-2210", issue: "2026-07-04", due: "2026-07-18", amountCents: 296000, paid: { date: "2026-08-28", payerName: HARBOUR_PAYER } },
  { id: "inv-1004", customerId: C.harbour, number: "INV-1004", issue: "2026-07-18", due: "2026-08-01", amountCents: 348000, paid: { date: "2026-09-22", payerName: HARBOUR_PAYER }, rejectedForMissingPo: true },
  { id: "inv-1011", customerId: C.harbour, number: "INV-1011", po: "HH-PO-2237", issue: "2026-08-01", due: "2026-08-15", amountCents: 302000, paid: { date: "2026-09-30", payerName: HARBOUR_PAYER } },
];

// 24 Bella's invoices, monthly Sep 2024 – Aug 2026, all paid on or before the due date
const bellaHistory: InvoiceSpec[] = Array.from({ length: 24 }, (_, k) => {
  const issueY = 2024 + Math.floor((8 + k) / 12);
  const issueM = ((8 + k) % 12) + 1;
  const dueY = 2024 + Math.floor((9 + k) / 12);
  const dueM = ((9 + k) % 12) + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  // paid on the due date or up to 3 days early
  const paidDate = new Date(Date.UTC(dueY, dueM - 1, 1 - (k % 4)));
  const n = String(801 + k).padStart(4, "0");
  return {
    id: `inv-${n}`,
    customerId: C.bella,
    number: `INV-${n}`,
    issue: `${issueY}-${pad(issueM)}-17`,
    due: `${dueY}-${pad(dueM)}-01`,
    amountCents: 300000 + ((k * 7) % 6) * 10000,
    paid: { date: paidDate.toISOString().slice(0, 10), payerName: "BELLAS CAFE" },
  };
});

const cityHistory: InvoiceSpec[] = [
  { id: "inv-1013", customerId: C.city, number: "INV-1013", issue: "2026-08-19", due: "2026-09-02", amountCents: 285000, paid: { date: "2026-09-02", payerName: "CITY CATERING CO PTY LTD" } },
];

// ---------- builders ----------

function buildInvoice(spec: InvoiceSpec) {
  const lines: Prisma.InvoiceLineCreateManyInput[] = spec.lines
    ? spec.lines.map(([key, qty], i) => ({
        invoiceId: spec.id,
        sortOrder: i,
        description: P[key].d,
        quantity: qty,
        unitPriceCents: P[key].c,
        amountCents: qty * P[key].c,
      }))
    : [
        {
          invoiceId: spec.id,
          sortOrder: 0,
          description: "Fresh produce — deliveries per attached schedule",
          quantity: 1,
          unitPriceCents: spec.amountCents ?? 0,
          amountCents: spec.amountCents ?? 0,
        },
      ];
  const totalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const invoice: Prisma.InvoiceCreateManyInput = {
    id: spec.id,
    businessId: B,
    customerId: spec.customerId,
    number: spec.number,
    poNumber: spec.po ?? null,
    issueDate: dateOnly(spec.issue),
    dueDate: dateOnly(spec.due),
    status: spec.paid ? "paid" : "sent",
    totalCents,
    balanceCents: spec.paid ? 0 : totalCents,
    paidAt: spec.paid ? dateOnly(spec.paid.date) : null,
    rejectedForMissingPo: spec.rejectedForMissingPo ?? false,
  };
  const payment: Prisma.PaymentCreateManyInput | null = spec.paid
    ? {
        id: `pay-${spec.id.slice(4)}`,
        businessId: B,
        customerId: spec.customerId,
        date: dateOnly(spec.paid.date),
        amountCents: totalCents,
        payerName: spec.paid.payerName,
        reference: spec.number,
        description: `EFT ${spec.paid.payerName} ${spec.number}`,
        status: "allocated",
        syncedAt: sydney(spec.paid.date, "06:05"),
      }
    : null;
  const allocation: Prisma.AllocationCreateManyInput | null = payment
    ? {
        paymentId: payment.id!,
        invoiceId: spec.id,
        amountCents: totalCents,
        confirmedBy: "Sarah",
        confirmedAt: sydney(spec.paid!.date, "09:00"),
      }
    : null;
  return { invoice, lines, payment, allocation };
}

// ---------- seed ----------

export type SeedCounts = Record<string, number>;

export async function seedDemo(db: PrismaClient): Promise<SeedCounts> {
  // Truncate (Business cascades to every business table). AiResult is kept as the AI cache.
  await db.$executeRawUnsafe(`TRUNCATE TABLE "Business" CASCADE`);

  await db.business.create({
    data: {
      id: B,
      name: "Fresh Harvest Produce",
      abn: "[YOUR ABN]",
      address: "Flemington Markets, NSW",
      gstFree: true,
      termsDays: 14,
      bankBsb: "062-000",
      bankAccount: "1234 5678",
      nextInvoiceNumber: 1034,
    },
  });

  await db.user.createMany({
    data: [
      { id: "user-tony", businessId: B, name: "Tony", initials: "TO", email: TONY_EMAIL, role: "owner" },
      { id: "user-sarah", businessId: B, name: "Sarah", initials: "SA", email: "sarah@ledgerlane.example", role: "bookkeeper" },
    ],
  });

  await db.customer.createMany({
    data: [
      {
        id: C.city, businessId: B, name: "City Catering Co.", contactName: "Marco Ricci", contactRole: "Accounts",
        email: "accounts@citycatering.example", phone: "+61 2 9000 2200", termsDays: 14,
        customerSince: dateOnly("2025-03-01"), bankPayerNames: ["CITY CATERING CO PTY LTD"],
      },
      {
        id: C.sweet, businessId: B, name: "Sweet Bakery", contactName: "Hana Kim", contactRole: "Owner",
        email: "hana@sweetbakery.example", phone: "+61 2 9000 3300", termsDays: 14,
        customerSince: dateOnly("2025-06-01"), bankPayerNames: ["SWEET BAKERY"],
      },
      {
        id: C.bella, businessId: B, name: "Bella's Café", contactName: "Bella Moretti", contactRole: "Owner",
        email: "bella@bellascafe.example", phone: "+61 2 9000 4400", termsDays: 14, deliveryDays: "Thursday",
        customerSince: dateOnly("2024-09-01"), payLinkEnabled: true, bankPayerNames: ["BELLAS CAFE"],
      },
      {
        id: C.noodle, businessId: B, name: "Golden Noodle House", contactName: "Kevin Lau", contactRole: "Owner",
        email: "kevin@goldennoodle.example", phone: "+61 2 9000 5500", termsDays: 14,
        customerSince: dateOnly("2025-01-15"), bankPayerNames: ["GOLDEN NOODLE"],
      },
      {
        id: C.harbour, businessId: B, name: "Harbourside Hotel", contactName: "Accounts Payable team", contactRole: "AP",
        email: "ap@harbourside.example", phone: "+61 2 9000 1100", requiresPo: true, termsDays: 14,
        creditLimitCents: 700000, deliveryDays: "Mon/Wed/Fri", customerSince: dateOnly("2026-02-01"),
        bankPayerNames: [HARBOUR_PAYER],
      },
    ],
  });

  const built = [...openInvoices, ...harbourHistory, ...bellaHistory, ...cityHistory].map(buildInvoice);
  await db.invoice.createMany({ data: built.map((b) => b.invoice) });
  await db.invoiceLine.createMany({ data: built.flatMap((b) => b.lines) });

  // Bank feed: history receipts + the lines synced this morning (13 Oct 6:05 AM)
  const synced = sydney("2026-10-13", "06:05");
  await db.payment.createMany({
    data: [
      ...built.flatMap((b) => (b.payment ? [b.payment] : [])),
      {
        id: DEMO_IDS.cityPayment, businessId: B, customerId: C.city, date: dateOnly("2026-10-12"),
        amountCents: 300000, payerName: "CITY CATERING CO PTY LTD", reference: "INV-1013",
        description: "EFT CITY CATERING CO PTY LTD INV-1013", status: "unallocated", syncedAt: synced,
      },
      {
        id: "pay-noodle-1210-test", businessId: B, customerId: C.noodle, date: dateOnly("2026-10-12"),
        amountCents: 0, payerName: "GOLDEN NOODLE", reference: "1026 PART",
        description: "EFT GOLDEN NOODLE 1026 PART", status: "ignored", syncedAt: synced,
      },
      {
        id: "pay-farm-1210", businessId: B, customerId: null, date: dateOnly("2026-10-12"),
        amountCents: -421000, payerName: "MKT FARM PAYMENT", reference: "cash",
        description: "MKT FARM PAYMENT", status: "outgoing", syncedAt: synced,
      },
    ],
  });
  await db.allocation.createMany({ data: built.flatMap((b) => (b.allocation ? [b.allocation] : [])) });

  await db.return.create({
    data: {
      id: DEMO_IDS.sweetReturn, number: "RET-0211", customerId: C.sweet, invoiceId: "inv-1028",
      date: sydney("2026-09-15", "07:40"), product: "Strawberries 250g", quantity: 8, unitPriceCents: 4500,
      reason: "Bruised", signedBy: "H. Kim", driver: "M. Rossi", source: "Driver app",
    },
  });

  await db.case.createMany({
    data: [
      {
        id: K.city, number: "KC-0045", businessId: B, customerId: C.city, invoiceId: "inv-1031",
        cause: "paid_not_matched", status: "needs_approval", whoActs: "sarah", confidence: "high",
        summary:
          "City Catering paid A$3,000 on 12 Oct with reference “INV-1013”, an invoice that was paid in full on 2 Sep. They have exactly one open invoice for exactly this amount — INV-1031.",
        causeEvidenceLine: "Bank: A$3,000 received 12 Oct, ref “INV-1013” — no such open invoice",
        suggestedAction: "Match payment", suggestedActionDetail: "Reminder due today was held automatically",
        remindersPaused: true,
      },
      {
        id: K.sweet, number: "KC-0043", businessId: B, customerId: C.sweet, invoiceId: "inv-1028",
        cause: "invoice_issue_ours", status: "needs_approval", whoActs: "sarah", confidence: "high",
        summary:
          "Sweet Bakery is holding payment because 8 boxes of strawberries were returned as bruised on 15 Sep, and no credit note has been issued. The invoice still bills the full 48 boxes.",
        causeEvidenceLine: "Reply 8 Oct + returns log: 8 boxes returned, no credit note",
        suggestedAction: "Approve credit note", suggestedActionDetail: "Then send the corrected invoice",
        remindersPaused: true,
      },
      {
        id: K.bella, number: "KC-0044", businessId: B, customerId: C.bella, invoiceId: "inv-1030",
        cause: "probably_forgot", status: "needs_approval", whoActs: "sarah_to_customer", confidence: "high",
        summary:
          "Bella's Café has paid 24 of 24 invoices on time over two years and orders every week. No payment, reply or return is logged for INV-1030 — most likely it slipped through.",
        causeEvidenceLine: "Paid on time 24 of 24 invoices over 2 years · no reply, no dispute",
        suggestedAction: "Approve friendly nudge", suggestedActionDetail: "Warm tone · pay link included",
      },
      {
        id: K.noodle, number: "KC-0041", businessId: B, customerId: C.noodle, invoiceId: "inv-1026",
        cause: "cash_flow", status: "needs_approval", whoActs: "tony_approves", confidence: "medium",
        summary:
          "Golden Noodle House replied on 12 Oct that roadworks out front have cut their trade in half. They intend to pay but cannot pay the full balance at once.",
        causeEvidenceLine: "Reply 12 Oct: “roadworks out front, half our customers are gone”",
        suggestedAction: "Offer 2-instalment plan", suggestedActionDetail: "Instalments 20 Oct and 3 Nov · routine reminders stop",
      },
      {
        id: K.harbour, number: "KC-0039", businessId: B, customerId: C.harbour, invoiceId: "inv-1019",
        cause: "habitual_late", status: "needs_approval", whoActs: "tony_decides", confidence: "medium",
        summary:
          "Harbourside Hotel has paid 8 of 8 invoices late, a median 45 days. Three reminders for INV-1019 (5 Sep, 22 Sep, 7 Oct) were not answered. Their AP team requires a PO number on every invoice.",
        causeEvidenceLine: "Median 45 days late over 8 invoices · 3 reminders unanswered",
        suggestedAction: "Call AP, then change terms", suggestedActionDetail: "3 emails ignored → AI voice call, approved by Tony",
      },
    ],
  });

  // ---------- messages ----------
  const tony = { fromName: "Tony — Fresh Harvest Produce", fromEmail: TONY_EMAIL };
  await db.message.createMany({
    data: [
      // City Catering
      {
        id: "msg-city-reminder-1", customerId: C.city, caseId: K.city, invoiceId: "inv-1031",
        direction: "outbound", status: "sent", tone: "warm", ...tony, toEmail: "accounts@citycatering.example",
        subject: "Friendly reminder — INV-1031", occurredAt: sydney("2026-10-06", "09:00"), approvedBy: "Sarah",
        body: "Hi Marco,\n\nJust a friendly reminder that invoice INV-1031 (A$3,000.00) was due on 4 October.\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      {
        id: DEMO_IDS.cityHeldReminder, customerId: C.city, caseId: K.city, invoiceId: "inv-1031",
        direction: "outbound", status: "held", tone: "neutral", ...tony, toEmail: "accounts@citycatering.example",
        subject: "Second reminder — INV-1031", occurredAt: synced,
        body: "Hi Marco,\n\nFollowing up on invoice INV-1031 (A$3,000.00), due 4 October, which still shows as unpaid on our side. Could you let me know when it will be paid?\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      // Sweet Bakery
      {
        id: "msg-sweet-reminder-1", customerId: C.sweet, caseId: K.sweet, invoiceId: "inv-1028",
        direction: "outbound", status: "sent", tone: "warm", ...tony, toEmail: "hana@sweetbakery.example",
        subject: "Friendly reminder — INV-1028", occurredAt: sydney("2026-10-03", "09:00"), approvedBy: "Sarah",
        body: "Hi Hana,\n\nJust a friendly reminder that invoice INV-1028 (A$3,100.00) was due on 26 September.\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      {
        id: "msg-sweet-reply", customerId: C.sweet, caseId: K.sweet, invoiceId: "inv-1028",
        direction: "inbound", status: "received", fromName: "Hana Kim", fromEmail: "hana@sweetbakery.example",
        toEmail: TONY_EMAIL, subject: "Re: Friendly reminder — INV-1028", occurredAt: sydney("2026-10-08", "14:15"),
        body: "Hi Tony, happy to pay but the invoice still has the 8 boxes of strawberries your driver took back on the 15th. Can you fix it and I'll pay the same day?",
      },
      // Bella's Café — draft nudge awaiting approval
      {
        id: DEMO_IDS.bellaDraft, customerId: C.bella, caseId: K.bella, invoiceId: "inv-1030",
        direction: "outbound", status: "draft", tone: "warm", ...tony, toEmail: "bella@bellascafe.example",
        subject: "INV-1030 — quick one from Tony", occurredAt: synced,
        body:
          "Hi Bella,\n\nHope the café's been busy! Just a quick one — invoice INV-1030 for September's produce (A$3,200) was due on 1 October and I don't think it's come through yet. Totally understand if it slipped through the cracks, it happens to all of us.\n\nIf it's easier, you can pay in a couple of taps here: [PAY LINK]. Otherwise the usual bank details are on the attached invoice.\n\nSee you Thursday with the strawberries.\n\nCheers,\nTony\nFresh Harvest Produce",
      },
      // Golden Noodle House
      {
        id: "msg-noodle-reminder-1", customerId: C.noodle, caseId: K.noodle, invoiceId: "inv-1026",
        direction: "outbound", status: "sent", tone: "warm", ...tony, toEmail: "kevin@goldennoodle.example",
        subject: "Friendly reminder — INV-1026", occurredAt: sydney("2026-09-29", "09:00"), approvedBy: "Sarah",
        body: "Hi Kevin,\n\nJust a friendly reminder that invoice INV-1026 (A$3,400.00) was due on 22 September.\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      {
        id: "msg-noodle-reply", customerId: C.noodle, caseId: K.noodle, invoiceId: "inv-1026",
        direction: "inbound", status: "received", fromName: "Kevin Lau", fromEmail: "kevin@goldennoodle.example",
        toEmail: TONY_EMAIL, subject: "Re: Friendly reminder — INV-1026", occurredAt: sydney("2026-10-12", "17:12"),
        body: "Hi Tony, sorry I've been quiet. The council has had roadworks out front for three weeks — half our customers are gone. We will pay, we just can't do it all at once right now. Can we sort something out?",
      },
      // Harbourside Hotel
      {
        id: "msg-harbour-po-reject", customerId: C.harbour, invoiceId: "inv-1004",
        direction: "inbound", status: "received", fromName: "Harbourside AP team", fromEmail: "ap@harbourside.example",
        toEmail: TONY_EMAIL, subject: "Invoice INV-1004 rejected — no PO", occurredAt: sydney("2026-08-12", "11:20"),
        body: "Hello, invoice INV-1004 has been rejected because it has no purchase order number. Please reissue with a valid PO.",
      },
      {
        id: "msg-harbour-reminder-1", customerId: C.harbour, caseId: K.harbour, invoiceId: "inv-1019",
        direction: "outbound", status: "sent", tone: "warm", ...tony, toEmail: "ap@harbourside.example",
        subject: "1st reminder — INV-1019", occurredAt: sydney("2026-09-05", "09:00"), approvedBy: "Sarah",
        body: "Hello AP team,\n\nA friendly reminder that invoice INV-1019 (PO HH-PO-2251, A$3,300.00) was due on 29 August.\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      {
        id: "msg-harbour-reminder-2", customerId: C.harbour, caseId: K.harbour, invoiceId: "inv-1019",
        direction: "outbound", status: "sent", tone: "neutral", ...tony, toEmail: "ap@harbourside.example",
        subject: "2nd reminder — INV-1019", occurredAt: sydney("2026-09-22", "09:00"), approvedBy: "Sarah",
        body: "Hello AP team,\n\nInvoice INV-1019 (PO HH-PO-2251, A$3,300.00) is now 24 days overdue. Please confirm when it will be paid.\n\nThanks,\nTony\nFresh Harvest Produce",
      },
      {
        id: "msg-harbour-reminder-3", customerId: C.harbour, caseId: K.harbour, invoiceId: "inv-1019",
        direction: "outbound", status: "sent", tone: "firm", ...tony, toEmail: "ap@harbourside.example",
        subject: "3rd reminder — INV-1019", occurredAt: sydney("2026-10-07", "09:00"), approvedBy: "Sarah",
        body: "Hello AP team,\n\nInvoice INV-1019 (PO HH-PO-2251, A$3,300.00) is 39 days overdue and we have not had a reply to two reminders. Please arrange payment or tell us what is holding it up.\n\nRegards,\nTony\nFresh Harvest Produce",
      },
    ],
  });

  // ---------- evidence ----------
  await db.evidence.createMany({
    data: [
      {
        id: "ev-city-bank", caseId: K.city, type: "bank", title: "Bank receipt",
        excerpt: "12 Oct · EFT CITY CATERING CO PTY LTD · INV-1013 · A$3,000.00", highlight: "INV-1013",
        sourceRef: `bank:${DEMO_IDS.cityPayment}`, occurredAt: dateOnly("2026-10-12"), paymentId: DEMO_IDS.cityPayment,
      },
      {
        id: "ev-sweet-reply", caseId: K.sweet, type: "email", title: "Customer reply",
        excerpt: "Hi Tony, happy to pay but the invoice still has the 8 boxes of strawberries your driver took back on the 15th. Can you fix it and I'll pay the same day?",
        highlight: "8 boxes of strawberries your driver took back",
        sourceRef: "message:msg-sweet-reply", occurredAt: sydney("2026-10-08", "14:15"), messageId: "msg-sweet-reply",
      },
      {
        id: "ev-sweet-return", caseId: K.sweet, type: "returns", title: "Returns log",
        excerpt: "RET-0211 · Sweet Bakery · ref INV-1028\nStrawberries 250g — 8 boxes — bruised\nSigned: H. Kim · Driver: M. Rossi",
        highlight: "Strawberries 250g — 8 boxes — bruised", sourceRef: "return:RET-0211", occurredAt: sydney("2026-09-15", "07:40"),
        returnId: DEMO_IDS.sweetReturn,
      },
      {
        id: "ev-sweet-invoice", caseId: K.sweet, type: "document", title: "INV-1028.pdf",
        excerpt: "Invoice · 48 boxes billed", highlight: "48 boxes billed", sourceRef: "document:INV-1028.pdf",
        occurredAt: dateOnly("2026-09-12"),
      },
      {
        id: "ev-sweet-delivery", caseId: K.sweet, type: "document", title: "Delivery-note-12Sep.pdf",
        excerpt: "Delivery note · 48 boxes delivered", highlight: "48 boxes delivered",
        sourceRef: "document:Delivery-note-12Sep.pdf", occurredAt: dateOnly("2026-09-12"),
      },
      {
        id: "ev-bella-history", caseId: K.bella, type: "history", title: "Payment history",
        excerpt: "Paid on time 24 of 24 invoices since Sep 2024. No payment, reply or return logged for INV-1030.",
        highlight: "24 of 24", sourceRef: `customer:${C.bella}`, occurredAt: synced,
      },
      {
        id: "ev-noodle-reply", caseId: K.noodle, type: "email", title: "Customer reply",
        excerpt: "Hi Tony, sorry I've been quiet. The council has had roadworks out front for three weeks — half our customers are gone. We will pay, we just can't do it all at once right now. Can we sort something out?",
        highlight: "roadworks out front for three weeks — half our customers are gone",
        sourceRef: "message:msg-noodle-reply", occurredAt: sydney("2026-10-12", "17:12"), messageId: "msg-noodle-reply",
      },
      {
        id: "ev-harbour-history", caseId: K.harbour, type: "history", title: "Payment history",
        excerpt: "8 completed invoices since Feb 2026 · paid on time 0 of 8 · median 45 days late · rejected for missing PO 2",
        highlight: "median 45 days late", sourceRef: `customer:${C.harbour}`, occurredAt: synced,
      },
      {
        id: "ev-harbour-reminders", caseId: K.harbour, type: "email", title: "Reminders sent · INV-1019",
        excerpt: "3 reminders for INV-1019 — 5 Sep (warm), 22 Sep (neutral), 7 Oct (firm) — no reply",
        highlight: "no reply", sourceRef: "message:msg-harbour-reminder-3", occurredAt: sydney("2026-10-07", "09:00"),
        messageId: "msg-harbour-reminder-3",
      },
    ],
  });

  await db.call.create({
    data: {
      id: DEMO_IDS.harbourCall, customerId: C.harbour, caseId: K.harbour, invoiceId: "inv-1019",
      status: "approved", phoneNumber: "+61 2 9000 1100", approvedBy: "Tony", approvedAt: sydney("2026-10-13", "09:40"),
    },
  });

  // ---------- audit trail (history before Sarah's Monday) ----------
  const ev = (
    at: Date, actor: string, type: string, summary: string,
    refs: { caseId?: string; customerId?: string; invoiceId?: string }, detail?: string
  ): Prisma.AuditEventCreateManyInput => ({ businessId: B, at, actor, type, summary, detail, ...refs });

  const city = { caseId: K.city, customerId: C.city, invoiceId: "inv-1031" };
  const sweet = { caseId: K.sweet, customerId: C.sweet, invoiceId: "inv-1028" };
  const bella = { caseId: K.bella, customerId: C.bella, invoiceId: "inv-1030" };
  const noodle = { caseId: K.noodle, customerId: C.noodle, invoiceId: "inv-1026" };
  const harbour = { caseId: K.harbour, customerId: C.harbour, invoiceId: "inv-1019" };

  // Timeline sub-line renders as "<date> · <detail ?? actor>", so details stay short.
  await db.auditEvent.createMany({
    data: [
      ev(sydney("2026-08-15", "08:00"), "Tony", "invoice_sent", "Delivered · invoice sent", harbour),
      ev(sydney("2026-09-05", "09:00"), "Sarah", "reminder_sent", "1st reminder sent", harbour, "warm · no reply"),
      ev(sydney("2026-09-08", "08:00"), "Tony", "invoice_sent", "Delivered · invoice sent", noodle),
      ev(sydney("2026-09-12", "08:00"), "Tony", "invoice_sent", "Delivered · invoice sent", sweet),
      ev(sydney("2026-09-15", "07:40"), "Driver app", "return_logged", "8 boxes returned", sweet, "driver app"),
      ev(sydney("2026-09-17", "08:00"), "Tony", "invoice_sent", "Delivered · invoice sent", bella),
      ev(sydney("2026-09-20", "08:00"), "Tony", "invoice_sent", "Delivered · invoice sent", city),
      ev(sydney("2026-09-22", "09:00"), "Sarah", "reminder_sent", "2nd reminder sent", harbour, "neutral · no reply"),
      ev(sydney("2026-09-29", "09:00"), "Sarah", "reminder_sent", "Friendly reminder sent", noodle, "approved by Sarah"),
      ev(sydney("2026-10-03", "09:00"), "Sarah", "reminder_sent", "Friendly reminder sent", sweet, "approved by Sarah"),
      ev(sydney("2026-10-06", "09:00"), "Sarah", "reminder_sent", "Friendly reminder sent", city, "approved by Sarah"),
      ev(sydney("2026-10-07", "09:00"), "Sarah", "reminder_sent", "3rd reminder sent", harbour, "firm · no reply"),
      ev(sydney("2026-10-08", "14:15"), "Rule", "reminders_paused", "Customer replied · reminders paused", sweet, "rule: invoice disputed"),
      ev(sydney("2026-10-12", "17:12"), "Customer", "reply_received", "Customer replied", noodle, "“roadworks out front, half our customers are gone”"),
      ev(sydney("2026-10-12", "17:13"), "AI", "case_classified", "Classified: cash-flow trouble", noodle, "plan suggested"),
      ev(synced, "Bank feed", "payment_received", "A$3,000 received · ref “INV-1013”", city, "bank feed"),
      ev(synced, "Rule", "reminder_held", "Reminder held", city, "rule: amount matches an open invoice"),
      ev(sydney("2026-10-13", "09:40"), "Tony", "call_approved", "Call script approved", harbour, "approved by Tony"),
    ],
  });

  const [business, users, customers, invoices, invoiceLines, payments, allocations, returns, cases, evidence, messages, calls, auditEvents, aiResults] =
    await Promise.all([
      db.business.count(), db.user.count(), db.customer.count(), db.invoice.count(), db.invoiceLine.count(),
      db.payment.count(), db.allocation.count(), db.return.count(), db.case.count(), db.evidence.count(),
      db.message.count(), db.call.count(), db.auditEvent.count(), db.aiResult.count(),
    ]);
  return { business, users, customers, invoices, invoiceLines, payments, allocations, returns, cases, evidence, messages, calls, auditEvents, aiResults };
}

/**
 * Bank lines that "Sync bank feed" (Phase 7) inserts one at a time, in order.
 * Not inserted by the seed.
 */
export const PENDING_BANK_LINES = [
  {
    id: "pay-bella-1310",
    customerId: C.bella,
    date: "2026-10-13",
    amountCents: 320000,
    payerName: "BELLAS CAFE",
    reference: "INV1030",
    description: "EFT BELLAS CAFE INV1030",
  },
] as const;

/**
 * Inbound replies that "Simulate reply" (POST /api/demo/simulate-reply) inserts. Fixed timestamps keep the
 * classify_case input — and so the AI cache key — identical across resets.
 */
export const PENDING_REPLIES = {
  noodle: {
    id: "msg-sim-noodle-1",
    customerId: C.noodle,
    caseId: K.noodle,
    invoiceId: "inv-1026",
    fromName: "Kevin Lau",
    fromEmail: "kevin@goldennoodle.example",
    subject: "Re: Friendly reminder — INV-1026",
    occurredAt: "2026-10-13T09:12",
    body: "Hi Tony, following up on my last email. Could we split INV-1026 into two payments — half next week and the rest early November? Things should pick up once the roadworks finish. Sorry again.",
  },
  bella: {
    id: "msg-sim-bella-1",
    customerId: C.bella,
    caseId: K.bella,
    invoiceId: "inv-1030",
    fromName: "Bella Moretti",
    fromEmail: "bella@bellascafe.example",
    subject: "INV-1030",
    occurredAt: "2026-10-13T08:47",
    body: "Hi Tony, so sorry, this one completely slipped through with the new espresso machine drama. I'll pay it today. See you Thursday!",
  },
} as const;
