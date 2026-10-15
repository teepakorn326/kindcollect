import { describe, expect, it } from "vitest";
import { dateOnly, daysOverdue } from "@/lib/clock";
import {
  creditNote,
  draftAmountIssues,
  extractInvoiceNumber,
  isDigitTransposition,
  hasBlockers,
  matchPayment,
  pauseReminders,
  proposePaymentPlan,
  queueOrder,
  sendGuard,
  threeWayCheck,
  type GuardCase,
  type GuardPayment,
  type MatchCustomer,
  type MatchInvoice,
  type QueueCase,
} from "@/lib/rules";

const TODAY = dateOnly("2026-10-13");

// Fixtures mirror src/lib/demo/seed.ts
const customers: MatchCustomer[] = [
  { id: "cust-city-catering", name: "City Catering Co.", bankPayerNames: ["CITY CATERING CO PTY LTD"] },
  { id: "cust-bellas-cafe", name: "Bella's Café", bankPayerNames: ["BELLAS CAFE"] },
  { id: "cust-harbourside", name: "Harbourside Hotel", bankPayerNames: ["HARBOURSIDE HOTEL PTY LTD"] },
];

const invoices: MatchInvoice[] = [
  { id: "inv-1031", number: "INV-1031", customerId: "cust-city-catering", status: "sent", balanceCents: 300000, currency: "AUD" },
  { id: "inv-1013", number: "INV-1013", customerId: "cust-city-catering", status: "paid", balanceCents: 0, currency: "AUD" },
  { id: "inv-1030", number: "INV-1030", customerId: "cust-bellas-cafe", status: "sent", balanceCents: 320000, currency: "AUD" },
];

const cityReceipt = {
  id: "pay-city-1210",
  amountCents: 300000,
  currency: "AUD",
  payerName: "CITY CATERING CO PTY LTD",
  reference: "INV-1013",
};

describe("matchPayment", () => {
  it("matches City Catering's A$3,000 to INV-1031, ignoring the wrong reference INV-1013", () => {
    const r = matchPayment(cityReceipt, customers, invoices);
    expect(r.kind).toBe("possible_match");
    if (r.kind !== "possible_match") return;
    expect(r.invoiceId).toBe("inv-1031");
    expect(r.customerId).toBe("cust-city-catering");
    expect(r.referenceStatus).toBe("paid_invoice");
    expect(r.referenceInvoiceNumber).toBe("INV-1013");
    // the reference check is a warning that needs confirmation, every other check passes
    const refCheck = r.checks.find((c) => c.label.includes("INV-1013"))!;
    expect(refCheck.warn).toBe(true);
    expect(r.checks.filter((c) => c !== refCheck).every((c) => c.ok)).toBe(true);
  });

  it("does not match when two open invoices share the amount", () => {
    const twoSame: MatchInvoice[] = [
      ...invoices,
      { id: "inv-1035", number: "INV-1035", customerId: "cust-city-catering", status: "sent", balanceCents: 300000, currency: "AUD" },
    ];
    const r = matchPayment(cityReceipt, customers, twoSame);
    expect(r.kind).toBe("no_match");
    if (r.kind !== "no_match") return;
    expect(r.reason).toBe("ambiguous_amount");
    expect(r.candidateInvoiceIds).toEqual(["inv-1031", "inv-1035"]);
  });

  it("does not match an unknown payer, an amount with no open invoice, or a non-receipt", () => {
    expect(matchPayment({ ...cityReceipt, payerName: "SOMEONE ELSE" }, customers, invoices)).toMatchObject({
      kind: "no_match",
      reason: "unknown_payer",
    });
    expect(matchPayment({ ...cityReceipt, amountCents: 299999 }, customers, invoices)).toMatchObject({
      kind: "no_match",
      reason: "no_open_invoice_for_amount",
    });
    expect(matchPayment({ ...cityReceipt, amountCents: 0 }, customers, invoices)).toMatchObject({
      kind: "no_match",
      reason: "not_a_receipt",
    });
  });

  it("confirms the reference when it names the matched invoice", () => {
    const r = matchPayment(
      { id: "p", amountCents: 320000, currency: "AUD", payerName: "BELLAS CAFE", reference: "INV1030" },
      customers,
      invoices
    );
    expect(r).toMatchObject({ kind: "possible_match", invoiceId: "inv-1030", referenceStatus: "open_invoice" });
  });

  it("spots transposed digits (INV-1013 typed for INV-1031)", () => {
    expect(isDigitTransposition("INV-1013", "INV-1031")).toBe(true);
    expect(isDigitTransposition("INV-1031", "INV-1031")).toBe(false);
    expect(isDigitTransposition("INV-1013", "INV-1030")).toBe(false);
  });

  it("parses invoice numbers out of free-text references", () => {
    expect(extractInvoiceNumber("INV-1013")).toBe("INV-1013");
    expect(extractInvoiceNumber("inv 1030 thanks")).toBe("INV-1030");
    expect(extractInvoiceNumber("1026 PART")).toBeNull();
  });
});

describe("queueOrder", () => {
  const cases: QueueCase[] = [
    { id: "harbour", cause: "habitual_late", status: "needs_approval", dueDate: dateOnly("2026-08-29") },
    { id: "noodle", cause: "cash_flow", status: "needs_approval", dueDate: dateOnly("2026-09-22") },
    { id: "bella", cause: "probably_forgot", status: "needs_approval", dueDate: dateOnly("2026-10-01") },
    { id: "sweet", cause: "invoice_issue_ours", status: "needs_approval", dueDate: dateOnly("2026-09-26") },
    { id: "city", cause: "paid_not_matched", status: "needs_approval", dueDate: dateOnly("2026-10-04") },
  ];

  it("puts paid-not-matched first and habitual-late last (the 5 demo cases)", () => {
    expect(queueOrder(cases, TODAY).map((c) => c.id)).toEqual(["city", "sweet", "bella", "noodle", "harbour"]);
  });

  it("puts a commitment that is due ahead of probably-forgot, and a future commitment behind habitual", () => {
    const withCommitment: QueueCase[] = [
      ...cases,
      { id: "due-promise", cause: "blocked_on_customer_po", status: "waiting_on_customer", dueDate: dateOnly("2026-09-01"), commitmentDate: dateOnly("2026-10-13") },
      { id: "future-promise", cause: "blocked_on_customer_po", status: "waiting_on_customer", dueDate: dateOnly("2026-08-01"), commitmentDate: dateOnly("2026-10-23") },
    ];
    const order = queueOrder(withCommitment, TODAY).map((c) => c.id);
    expect(order.indexOf("due-promise")).toBe(2);
    expect(order.at(-1)).toBe("future-promise");
  });

  it("sorts resolved cases to the end and does not mutate the input", () => {
    const input = [{ ...cases[4], status: "resolved" as const }, ...cases.slice(0, 4)];
    const order = queueOrder(input, TODAY);
    expect(order.at(-1)!.id).toBe("city");
    expect(input[0].id).toBe("city");
  });
});

describe("sendGuard", () => {
  const payments: GuardPayment[] = [
    { id: "pay-city-1210", customerId: "cust-city-catering", status: "unallocated", amountCents: 300000 },
    { id: "pay-noodle-test", customerId: "cust-golden-noodle", status: "ignored", amountCents: 0 },
  ];
  const cases: GuardCase[] = [
    { id: "kc-0043", customerId: "cust-sweet-bakery", cause: "invoice_issue_ours", status: "needs_approval" },
    { id: "kc-0044", customerId: "cust-bellas-cafe", cause: "probably_forgot", status: "needs_approval" },
  ];

  it("blocks City Catering — unallocated receipt", () => {
    expect(sendGuard("cust-city-catering", { payments, cases })).toEqual({
      blocked: true,
      reason: "unmatched_payment",
      paymentId: "pay-city-1210",
      amountCents: 300000,
    });
  });

  it("blocks any customer with an open dispute", () => {
    expect(sendGuard("cust-sweet-bakery", { payments, cases })).toEqual({ blocked: true, reason: "dispute", caseId: "kc-0043" });
  });

  it("allows Bella's Café, and unblocks once the receipt is allocated or the dispute resolved", () => {
    expect(sendGuard("cust-bellas-cafe", { payments, cases })).toEqual({ blocked: false });
    expect(sendGuard("cust-city-catering", { payments: [{ ...payments[0], status: "allocated" }], cases })).toEqual({ blocked: false });
    expect(sendGuard("cust-sweet-bakery", { payments, cases: [{ ...cases[0], status: "resolved" }] })).toEqual({ blocked: false });
  });

  it("ignores zero-value test transfers", () => {
    expect(sendGuard("cust-golden-noodle", { payments, cases })).toEqual({ blocked: false });
  });
});

describe("pauseReminders", () => {
  it("pauses on dispute, document request and cash-flow replies", () => {
    expect(pauseReminders({ replyType: "dispute" }).pause).toBe(true);
    expect(pauseReminders({ replyType: "document_request" }).pause).toBe(true);
    expect(pauseReminders({ cause: "cash_flow" })).toEqual({ pause: true, reason: "rule: customer in cash-flow trouble" });
    expect(pauseReminders({ cause: "invoice_issue_ours" }).reason).toBe("rule: invoice disputed");
  });

  it("does not pause otherwise", () => {
    expect(pauseReminders({ cause: "probably_forgot" }).pause).toBe(false);
    expect(pauseReminders({ replyType: "payment_promised" }).pause).toBe(false);
  });
});

describe("creditNote", () => {
  const ret0211 = { id: "ret-0211", product: "Strawberries 250g", quantity: 8, unitPriceCents: 4500 };

  it("is 36000 cents for 8 × A$45, with no GST when the business is GST-free", () => {
    const cn = creditNote([ret0211], { gstFree: true });
    expect(cn.netCents).toBe(36000);
    expect(cn.gstCents).toBe(0);
    expect(cn.totalCents).toBe(36000);
    expect(310000 - cn.totalCents).toBe(274000);
  });

  it("adds 10% GST when the business is not GST-free", () => {
    expect(creditNote([ret0211], { gstFree: false })).toMatchObject({ netCents: 36000, gstCents: 3600, totalCents: 39600 });
  });

  it("rejects empty returns and non-positive quantities", () => {
    expect(() => creditNote([], { gstFree: true })).toThrow();
    expect(() => creditNote([{ ...ret0211, quantity: 0 }], { gstFree: true })).toThrow();
  });
});

describe("threeWayCheck", () => {
  const harbourside = { requiresPo: true };
  const po = {
    number: "HH-PO-2291",
    lines: [
      { description: "Mixed salad greens — 5kg box", quantity: 30, unitPriceCents: 4700 },
      { description: "Tomatoes, truss — 10kg box", quantity: 24, unitPriceCents: 5200 },
      { description: "Strawberries 250g — box of 12", quantity: 14, unitPriceCents: 4500 },
    ],
  };
  const deliveryNote = {
    number: "DN-0931",
    poNumber: "HH-PO-2291",
    lines: [
      { description: "Mixed salad greens — 5kg box", quantity: 30 },
      { description: "Tomatoes, truss — 10kg box", quantity: 22 },
      { description: "Strawberries 250g — box of 12", quantity: 14 },
    ],
  };
  const inv1034 = {
    poNumber: "",
    lines: [
      { description: "Mixed salad greens — 5kg box", quantity: 30, unitPriceCents: 4700 },
      { description: "Tomatoes, truss — 10kg box", quantity: 24, unitPriceCents: 5200 },
      { description: "Strawberries 250g — box of 12", quantity: 14, unitPriceCents: 4500 },
    ],
  };

  it("flags the missing PO for a requiresPo customer, offering the PO from the delivery note", () => {
    const issues = threeWayCheck(inv1034, harbourside, po, deliveryNote);
    const missing = issues.find((i) => i.code === "missing_po")!;
    expect(missing.severity).toBe("blocker");
    expect(missing.fix).toEqual({ kind: "use_po", poNumber: "HH-PO-2291" });
  });

  it("flags the 24-vs-22 tomato mismatch on line 2 with a 'change to 22' fix", () => {
    const issues = threeWayCheck(inv1034, harbourside, po, deliveryNote);
    const qty = issues.find((i) => i.code === "qty_vs_delivery")!;
    expect(qty.severity).toBe("blocker");
    expect(qty.lineIndex).toBe(1);
    expect(qty.message).toContain("ordered 24");
    expect(qty.message).toContain("22 delivered (2 short)");
    expect(qty.fix).toEqual({ kind: "set_quantity", lineIndex: 1, quantity: 22 });
    expect(issues.filter((i) => i.severity === "blocker")).toHaveLength(2);
  });

  it("passes once the PO is used and the quantity is 22", () => {
    const fixed = { poNumber: "HH-PO-2291", lines: inv1034.lines.map((l, i) => (i === 1 ? { ...l, quantity: 22 } : l)) };
    const issues = threeWayCheck(fixed, harbourside, po, deliveryNote);
    expect(hasBlockers(issues)).toBe(false);
  });

  it("downgrades a mismatch to a warning when the line is explained ('Keep 24 and explain')", () => {
    const explained = {
      poNumber: "HH-PO-2291",
      lines: inv1034.lines.map((l, i) => (i === 1 ? { ...l, note: "2 boxes delivered Tuesday" } : l)),
    };
    const issues = threeWayCheck(explained, harbourside, po, deliveryNote);
    expect(hasBlockers(issues)).toBe(false);
    expect(issues.find((i) => i.code === "qty_vs_delivery")?.severity).toBe("warning");
  });

  it("checks quantity against the PO when there is no delivery note", () => {
    const issues = threeWayCheck({ ...inv1034, poNumber: "HH-PO-2291", lines: inv1034.lines.map((l, i) => (i === 1 ? { ...l, quantity: 26 } : l)) }, harbourside, po);
    expect(issues).toEqual([
      expect.objectContaining({ code: "qty_vs_po", severity: "blocker", fix: { kind: "set_quantity", lineIndex: 1, quantity: 24 } }),
    ]);
  });

  it("does not require a PO for customers without requiresPo", () => {
    expect(threeWayCheck({ poNumber: null, lines: [] }, { requiresPo: false })).toEqual([]);
  });
});

describe("proposePaymentPlan", () => {
  it("splits Golden Noodle's A$3,400 into 2 × A$1,700 on 20 Oct and 3 Nov", () => {
    const plan = proposePaymentPlan(340000, TODAY);
    expect(plan.map((p) => p.amountCents)).toEqual([170000, 170000]);
    expect(plan.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual(["2026-10-20", "2026-11-03"]);
  });

  it("puts odd cents on the last instalment", () => {
    expect(proposePaymentPlan(100001, TODAY, { instalments: 3 }).map((p) => p.amountCents)).toEqual([33333, 33333, 33335]);
  });
});

describe("daysOverdue (demo clock)", () => {
  it("computes the demo cases' overdue days on Mon 13 Oct", () => {
    expect(daysOverdue(dateOnly("2026-10-04"), TODAY)).toBe(9); // INV-1031
    expect(daysOverdue(dateOnly("2026-09-26"), TODAY)).toBe(17); // INV-1028 (crosses the DST change)
    expect(daysOverdue(dateOnly("2026-08-29"), TODAY)).toBe(45); // INV-1019
    expect(daysOverdue(dateOnly("2026-10-22"), TODAY)).toBe(-9); // INV-1033 not due
  });
});

describe("draftAmountIssues", () => {
  it("accepts amounts that match the facts, in either format", () => {
    expect(draftAmountIssues("invoice INV-1030 (A$3,200) — total A$3,200.00", [320000])).toEqual([]);
  });

  it("flags an amount the AI made up", () => {
    expect(draftAmountIssues("You owe A$3,250 plus a A$50 fee", [320000])).toEqual(["A$3,250", "A$50"]);
  });

  it("ignores text without amounts", () => {
    expect(draftAmountIssues("See you Thursday", [320000])).toEqual([]);
  });
});
