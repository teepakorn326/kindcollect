// Rules engine — CLAUDE.md §5. Pure functions: no DB, no clock reads (pass `today`), no AI.
// The AI suggests a cause; these rules decide what is allowed and compute every number.
import type { CaseCause, CaseStatus, InvoiceStatus, PaymentStatus } from "@prisma/client";
import { addCents, assertCents, multiplyCents, splitCents, type Currency } from "./money";

// ======================= queueOrder =======================

export type QueueCase = {
  id: string;
  cause: CaseCause;
  status: CaseStatus;
  dueDate: Date;
  commitmentDate?: Date | null;
};

/**
 * Rank: paid-not-matched → invoice-issue-ours → commitment due → probably-forgot → cash-flow → habitual.
 * "Match money first, fix our mistakes second, then chase — never the other way round."
 */
export function queueRank(c: QueueCase, today: Date): number {
  if (c.status === "resolved") return 99;
  if (c.cause === "paid_not_matched") return 0;
  if (c.cause === "invoice_issue_ours") return 1;
  if (c.commitmentDate) return c.commitmentDate.getTime() <= today.getTime() ? 2 : 7; // future promise: wait
  switch (c.cause) {
    case "probably_forgot":
      return 3;
    case "cash_flow":
      return 4;
    case "blocked_on_customer_po":
      return 5;
    case "habitual_late":
      return 6;
    default:
      return 8; // unknown: needs review, after the known causes
  }
}

/** Stable sort by rank, then oldest due date first. Returns a new array. */
export function queueOrder<T extends QueueCase>(cases: readonly T[], today: Date): T[] {
  return [...cases].sort(
    (a, b) => queueRank(a, today) - queueRank(b, today) || a.dueDate.getTime() - b.dueDate.getTime()
  );
}

// ======================= matchPayment =======================

export type MatchPaymentInput = {
  id: string;
  amountCents: number;
  currency: Currency | string;
  payerName: string;
  reference: string;
};

export type MatchCustomer = { id: string; name: string; bankPayerNames: string[] };

export type MatchInvoice = {
  id: string;
  number: string;
  customerId: string;
  status: InvoiceStatus;
  balanceCents: number;
  currency: Currency | string;
};

export type CheckResult = { ok: boolean; label: string; warn?: boolean };

export type ReferenceStatus = "open_invoice" | "paid_invoice" | "other_customer_invoice" | "unknown_invoice" | "none";

export type MatchResult =
  | {
      kind: "possible_match";
      customerId: string;
      invoiceId: string;
      invoiceNumber: string;
      amountCents: number;
      referenceStatus: ReferenceStatus;
      /** The invoice number the payer typed, when it names a real invoice */
      referenceInvoiceNumber: string | null;
      checks: CheckResult[];
    }
  | {
      kind: "no_match";
      reason: "not_a_receipt" | "unknown_payer" | "no_open_invoice_for_amount" | "ambiguous_amount" | "currency_mismatch";
      customerId: string | null;
      candidateInvoiceIds: string[];
      checks: CheckResult[];
    };

const normaliseName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
/** "INV-1013", "inv 1013", "INV1013" → "INV-1013" */
export function extractInvoiceNumber(reference: string): string | null {
  const m = reference.toUpperCase().match(/INV[\s-]*0*(\d{3,})/);
  return m ? `INV-${m[1].padStart(4, "0")}` : null;
}

/**
 * payer matches a customer AND amount equals exactly one open invoice → "possible match".
 * The typed reference is reported but never trusted when it names a paid or unknown invoice.
 * Never allocates — a person confirms.
 */
export function matchPayment(
  payment: MatchPaymentInput,
  customers: readonly MatchCustomer[],
  invoices: readonly MatchInvoice[]
): MatchResult {
  assertCents(payment.amountCents, "payment");
  const checks: CheckResult[] = [];
  if (payment.amountCents <= 0) {
    return { kind: "no_match", reason: "not_a_receipt", customerId: null, candidateInvoiceIds: [], checks };
  }

  const payer = normaliseName(payment.payerName);
  const customer = customers.find((c) =>
    c.bankPayerNames.some((n) => {
      const name = normaliseName(n);
      return payer === name || payer.startsWith(`${name} `);
    })
  );
  checks.push({ ok: !!customer, label: "Payer name matches customer record" });
  if (!customer) {
    return { kind: "no_match", reason: "unknown_payer", customerId: null, candidateInvoiceIds: [], checks };
  }

  const open = invoices.filter((i) => i.customerId === customer.id && i.status === "sent" && i.balanceCents > 0);
  const sameAmount = open.filter((i) => i.balanceCents === payment.amountCents);

  // Reference: what did the payer type, and what is it really?
  const refNumber = extractInvoiceNumber(payment.reference);
  const refInvoice = refNumber ? invoices.find((i) => i.number === refNumber) : undefined;
  let referenceStatus: ReferenceStatus = "none";
  if (refNumber && !refInvoice) referenceStatus = "unknown_invoice";
  else if (refInvoice && refInvoice.customerId !== customer.id) referenceStatus = "other_customer_invoice";
  else if (refInvoice && (refInvoice.status === "paid" || refInvoice.balanceCents === 0)) referenceStatus = "paid_invoice";
  else if (refInvoice) referenceStatus = "open_invoice";

  if (sameAmount.length !== 1) {
    checks.push({
      ok: false,
      label:
        sameAmount.length === 0
          ? "No open invoice for this customer equals the amount"
          : `${sameAmount.length} open invoices share this amount — cannot choose by rule`,
    });
    return {
      kind: "no_match",
      reason: sameAmount.length === 0 ? "no_open_invoice_for_amount" : "ambiguous_amount",
      customerId: customer.id,
      candidateInvoiceIds: sameAmount.map((i) => i.id),
      checks,
    };
  }

  const target = sameAmount[0];
  if (target.currency !== payment.currency) {
    checks.push({ ok: false, label: `Currency ${payment.currency} on receipt, ${target.currency} on invoice` });
    return { kind: "no_match", reason: "currency_mismatch", customerId: customer.id, candidateInvoiceIds: [target.id], checks };
  }

  checks.push({ ok: true, label: "Amount equals the only open invoice for this customer" });
  checks.push({ ok: payment.amountCents <= target.balanceCents, label: "Allocation does not exceed the invoice balance" });
  checks.push({ ok: true, label: `Currency ${payment.currency} on receipt and invoice` });

  const typed = payment.reference.trim() || "(blank)";
  const refLabel: Record<ReferenceStatus, string> = {
    open_invoice:
      refInvoice?.id === target.id
        ? `Reference “${typed}” names this invoice`
        : `Reference “${typed}” names a different open invoice — matched by payer + amount, needs your confirmation`,
    paid_invoice: `Reference “${typed}” names a paid invoice — matched by payer + amount, needs your confirmation`,
    other_customer_invoice: `Reference “${typed}” names another customer's invoice — matched by payer + amount, needs your confirmation`,
    unknown_invoice: `Reference “${typed}” is not an invoice number we issued — matched by payer + amount, needs your confirmation`,
    none: `Reference “${typed}” does not name an invoice — matched by payer + amount, needs your confirmation`,
  };
  const refMatchesTarget = referenceStatus === "open_invoice" && refInvoice?.id === target.id;
  checks.push({ ok: refMatchesTarget, warn: !refMatchesTarget, label: refLabel[referenceStatus] });

  return {
    kind: "possible_match",
    customerId: customer.id,
    invoiceId: target.id,
    invoiceNumber: target.number,
    amountCents: payment.amountCents,
    referenceStatus,
    referenceInvoiceNumber: refInvoice ? refInvoice.number : null,
    checks,
  };
}

// ======================= sendGuard =======================

export type GuardPayment = { id: string; customerId: string | null; status: PaymentStatus; amountCents: number };
export type GuardCase = { id: string; customerId: string; cause: CaseCause; status: CaseStatus };

export type SendGuardResult =
  | { blocked: false }
  | { blocked: true; reason: "unmatched_payment"; paymentId: string; amountCents: number }
  | { blocked: true; reason: "dispute"; caseId: string };

/** A dispute = an open case where the customer contests the invoice (our invoice issue). */
export function isOpenDispute(c: GuardCase): boolean {
  return c.status !== "resolved" && c.cause === "invoice_issue_ours";
}

/**
 * Blocks every outbound action to a customer with an unallocated receipt or an open dispute.
 * Call it again at send time — never trust the result from page load.
 */
export function sendGuard(
  customerId: string,
  ctx: { payments: readonly GuardPayment[]; cases: readonly GuardCase[] }
): SendGuardResult {
  const unmatched = ctx.payments.find(
    (p) => p.customerId === customerId && p.status === "unallocated" && p.amountCents > 0
  );
  if (unmatched) {
    return { blocked: true, reason: "unmatched_payment", paymentId: unmatched.id, amountCents: unmatched.amountCents };
  }
  const dispute = ctx.cases.find((c) => c.customerId === customerId && isOpenDispute(c));
  if (dispute) return { blocked: true, reason: "dispute", caseId: dispute.id };
  return { blocked: false };
}

// ======================= pauseReminders =======================

export type ReplyType = "dispute" | "document_request" | "cash_flow" | "payment_promised" | "other";

/** Cause → how the customer's reply reads. */
const replyTypeForCause: Partial<Record<CaseCause, ReplyType>> = {
  invoice_issue_ours: "dispute",
  blocked_on_customer_po: "document_request",
  cash_flow: "cash_flow",
};

export type PauseDecision = { pause: boolean; reason: string | null };

/** Pause routine reminders when a customer reply is classified as a dispute, document request or cash-flow. */
export function pauseReminders(input: { replyType?: ReplyType; cause?: CaseCause }): PauseDecision {
  const type = input.replyType ?? (input.cause ? replyTypeForCause[input.cause] : undefined);
  switch (type) {
    case "dispute":
      return { pause: true, reason: "rule: invoice disputed" };
    case "document_request":
      return { pause: true, reason: "rule: customer needs a document" };
    case "cash_flow":
      return { pause: true, reason: "rule: customer in cash-flow trouble" };
    default:
      return { pause: false, reason: null };
  }
}

// ======================= creditNote =======================

export type ReturnLine = { id?: string; product: string; quantity: number; unitPriceCents: number };

export type CreditNoteCalc = {
  lines: { product: string; quantity: number; unitPriceCents: number; amountCents: number }[];
  netCents: number;
  gstCents: number;
  totalCents: number;
};

export const GST_RATE_BASIS_POINTS = 1000; // 10%

/** qty × unit price per returned line; GST-free when the business sells fresh produce. */
export function creditNote(returns: readonly ReturnLine[], business: { gstFree: boolean }): CreditNoteCalc {
  if (returns.length === 0) throw new Error("A credit note needs at least one returned line");
  const lines = returns.map((r) => {
    if (r.quantity <= 0) throw new Error(`Returned quantity must be positive (${r.product})`);
    return { ...r, amountCents: multiplyCents(r.quantity, r.unitPriceCents) };
  });
  const netCents = addCents(...lines.map((l) => l.amountCents));
  const gstCents = business.gstFree ? 0 : Math.round((netCents * GST_RATE_BASIS_POINTS) / 10000);
  return { lines, netCents, gstCents, totalCents: addCents(netCents, gstCents) };
}

// ======================= threeWayCheck =======================

export type CheckLine = { description: string; quantity: number; unitPriceCents: number; note?: string | null };

export type ThreeWayIssue = {
  severity: "blocker" | "warning";
  code: "missing_po" | "po_number_mismatch" | "qty_vs_delivery" | "qty_vs_po" | "price_vs_po" | "not_on_po";
  lineIndex: number | null;
  message: string;
  /** a one-click fix the UI can offer */
  fix?: { kind: "use_po"; poNumber: string } | { kind: "set_quantity"; lineIndex: number; quantity: number };
};

const sameItem = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Invoice vs customer PO vs delivery note.
 * - missing PO is a blocker for customers with requiresPo
 * - invoiced qty ≠ delivered qty, or qty/price ≠ PO → blocker, unless the line carries an explanation note
 */
export function threeWayCheck(
  invoice: { poNumber?: string | null; lines: readonly CheckLine[] },
  customer: { requiresPo: boolean },
  po?: { number: string; lines: readonly { description: string; quantity: number; unitPriceCents: number }[] } | null,
  deliveryNote?: { number: string; poNumber?: string | null; lines: readonly { description: string; quantity: number }[] } | null
): ThreeWayIssue[] {
  const issues: ThreeWayIssue[] = [];
  const poOnFile = po?.number ?? deliveryNote?.poNumber ?? null;
  const enteredPo = invoice.poNumber?.trim() || null;

  if (!enteredPo && customer.requiresPo) {
    issues.push({
      severity: "blocker",
      code: "missing_po",
      lineIndex: null,
      message: poOnFile
        ? `This customer's AP team rejects invoices without a PO number — found “${poOnFile}” on the delivery note.`
        : "This customer's AP team rejects invoices without a PO number.",
      fix: poOnFile ? { kind: "use_po", poNumber: poOnFile } : undefined,
    });
  } else if (enteredPo && po && enteredPo !== po.number) {
    issues.push({
      severity: "blocker",
      code: "po_number_mismatch",
      lineIndex: null,
      message: `PO “${enteredPo}” does not match the PO on file (“${po.number}”).`,
      fix: { kind: "use_po", poNumber: po.number },
    });
  }

  invoice.lines.forEach((line, i) => {
    if (!line.description.trim()) return;
    const explained = !!line.note?.trim();
    const severity = explained ? "warning" : "blocker";
    const poLine = po?.lines.find((l) => sameItem(l.description, line.description));
    const dnLine = deliveryNote?.lines.find((l) => sameItem(l.description, line.description));

    if (dnLine && dnLine.quantity !== line.quantity) {
      const diff = dnLine.quantity - line.quantity;
      const ordered = poLine ? `PO ${po!.number} ordered ${poLine.quantity}, ` : "";
      issues.push({
        severity,
        code: "qty_vs_delivery",
        lineIndex: i,
        message: `Line ${i + 1}: ${ordered}delivery note ${deliveryNote!.number} shows ${dnLine.quantity} delivered (${Math.abs(diff)} ${diff < 0 ? "short" : "extra"}). Billing ${line.quantity} will be rejected by their AP.`,
        fix: { kind: "set_quantity", lineIndex: i, quantity: dnLine.quantity },
      });
    } else if (!dnLine && poLine && poLine.quantity !== line.quantity) {
      // With a delivery note, billing what was delivered is correct even if the PO ordered more.
      issues.push({
        severity,
        code: "qty_vs_po",
        lineIndex: i,
        message: `Line ${i + 1}: PO ${po!.number} ordered ${poLine.quantity}, invoice bills ${line.quantity}.`,
        fix: { kind: "set_quantity", lineIndex: i, quantity: poLine.quantity },
      });
    }
    if (poLine && poLine.unitPriceCents !== line.unitPriceCents) {
      issues.push({
        severity,
        code: "price_vs_po",
        lineIndex: i,
        message: `Line ${i + 1}: unit price differs from PO ${po!.number}.`,
      });
    }
    if (po && !poLine) {
      issues.push({ severity: "warning", code: "not_on_po", lineIndex: i, message: `Line ${i + 1} is not on PO ${po.number}.` });
    }
  });

  return issues;
}

export const hasBlockers = (issues: readonly ThreeWayIssue[]) => issues.some((i) => i.severity === "blocker");

// ======================= proposePaymentPlan =======================

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cash-flow cases: split the balance into equal instalments, the first a week out, then every 14 days.
 * INV-1026 on 13 Oct → 2 × 170000 on 20 Oct and 3 Nov.
 */
export function proposePaymentPlan(
  balanceCents: number,
  today: Date,
  opts: { instalments?: number; firstAfterDays?: number; everyDays?: number } = {}
): { sequence: number; dueDate: Date; amountCents: number }[] {
  const n = opts.instalments ?? 2;
  const first = opts.firstAfterDays ?? 7;
  const every = opts.everyDays ?? 14;
  if (balanceCents <= 0) throw new Error("Nothing to put on a plan");
  return splitCents(balanceCents, n).map((amountCents, i) => ({
    sequence: i + 1,
    dueDate: new Date(today.getTime() + (first + i * every) * DAY_MS),
    amountCents,
  }));
}
