// Money is integer cents, always. Nothing in here touches floats except formatting for display.

export type Currency = "AUD";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${label} must be an integer number of cents, got ${value}`);
  return value;
}

/** Sum of integer cent amounts. */
export function addCents(...values: number[]): number {
  return values.reduce((sum, v, i) => sum + assertCents(v, `value[${i}]`), 0);
}

/** a − b in cents. */
export function subtractCents(a: number, b: number): number {
  return assertCents(a, "a") - assertCents(b, "b");
}

/** quantity × unit price, both integers. */
export function multiplyCents(quantity: number, unitCents: number): number {
  if (!Number.isSafeInteger(quantity)) throw new MoneyError(`quantity must be an integer, got ${quantity}`);
  return assertCents(quantity * assertCents(unitCents, "unit price"), "line total");
}

// ---------- allocation ----------

export type AllocationInput = {
  invoiceId: string;
  /** cents to apply to this invoice */
  cents: number;
  /** invoice balance before this allocation */
  outstandingCents: number;
  currency: Currency | string;
};

export type AllocationResult = {
  allocations: { invoiceId: string; cents: number; balanceAfterCents: number }[];
  allocatedCents: number;
  unallocatedCents: number;
};

/**
 * Validate a split of one payment across invoices. Throws MoneyError on over-allocation
 * (more than the payment, or more than an invoice's balance), negative amounts, or currency mismatch.
 */
export function allocate(
  payment: { cents: number; currency: Currency | string },
  allocations: AllocationInput[]
): AllocationResult {
  assertCents(payment.cents, "payment");
  if (payment.cents < 0) throw new MoneyError("Cannot allocate a negative payment");

  const seen = new Set<string>();
  const rows = allocations.map((a) => {
    assertCents(a.cents, `allocation to ${a.invoiceId}`);
    assertCents(a.outstandingCents, `balance of ${a.invoiceId}`);
    if (a.currency !== payment.currency) {
      throw new MoneyError(`Currency mismatch: payment is ${payment.currency}, invoice ${a.invoiceId} is ${a.currency}`);
    }
    if (seen.has(a.invoiceId)) throw new MoneyError(`Invoice ${a.invoiceId} appears twice`);
    seen.add(a.invoiceId);
    if (a.cents < 0) throw new MoneyError(`Allocation to ${a.invoiceId} cannot be negative`);
    if (a.cents > a.outstandingCents) {
      throw new MoneyError(`Allocation to ${a.invoiceId} exceeds its balance (${formatAud(a.outstandingCents)})`);
    }
    return { invoiceId: a.invoiceId, cents: a.cents, balanceAfterCents: a.outstandingCents - a.cents };
  });

  const allocatedCents = addCents(...rows.map((r) => r.cents));
  if (allocatedCents > payment.cents) {
    throw new MoneyError(
      `Over-allocated: ${formatAud(allocatedCents)} allocated from a ${formatAud(payment.cents)} payment`
    );
  }
  return { allocations: rows, allocatedCents, unallocatedCents: payment.cents - allocatedCents };
}

// ---------- formatting ----------

const withCents = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

/** 300000 → "A$3,000.00"; with { cents: false } → "A$3,000". Negative → "−A$4,210.00". */
export function formatAud(cents: number, opts: { cents?: boolean } = {}): string {
  assertCents(cents);
  const showCents = opts.cents ?? true;
  const abs = Math.abs(cents);
  const body = showCents ? withCents.format(abs / 100) : wholeDollars.format(Math.round(abs / 100));
  return `${cents < 0 ? "−" : ""}A$${body}`;
}

/** 300000 → "3,000.00" (statements, journals). */
export function formatAmount(cents: number): string {
  assertCents(cents);
  return `${cents < 0 ? "-" : ""}${withCents.format(Math.abs(cents) / 100)}`;
}
