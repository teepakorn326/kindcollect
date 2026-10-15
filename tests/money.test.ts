import { describe, expect, it } from "vitest";
import { addCents, allocate, formatAmount, formatAud, MoneyError, multiplyCents, parseAmountToCents, subtractCents } from "@/lib/money";

describe("addCents / subtractCents / multiplyCents", () => {
  it("adds integer cents", () => {
    expect(addCents(300000, 310000, 320000, 340000, 330000)).toBe(1600000);
    expect(addCents()).toBe(0);
  });

  it("rejects fractional cents", () => {
    expect(() => addCents(100, 0.5)).toThrow(MoneyError);
    expect(() => multiplyCents(1.5, 4500)).toThrow(MoneyError);
  });

  it("subtracts and multiplies", () => {
    expect(subtractCents(310000, 36000)).toBe(274000);
    expect(multiplyCents(8, 4500)).toBe(36000);
  });
});

describe("allocate", () => {
  const cityReceipt = { cents: 300000, currency: "AUD" };

  it("allocates City Catering's A$3,000 fully to INV-1031", () => {
    const r = allocate(cityReceipt, [
      { invoiceId: "inv-1031", cents: 300000, outstandingCents: 300000, currency: "AUD" },
      { invoiceId: "inv-1013", cents: 0, outstandingCents: 0, currency: "AUD" },
    ]);
    expect(r.allocatedCents).toBe(300000);
    expect(r.unallocatedCents).toBe(0);
    expect(r.allocations[0].balanceAfterCents).toBe(0);
  });

  it("leaves the remainder unallocated on a part allocation", () => {
    const r = allocate(cityReceipt, [{ invoiceId: "inv-1031", cents: 100000, outstandingCents: 300000, currency: "AUD" }]);
    expect(r.unallocatedCents).toBe(200000);
    expect(r.allocations[0].balanceAfterCents).toBe(200000);
  });

  it("throws when allocations exceed the payment", () => {
    expect(() =>
      allocate(cityReceipt, [
        { invoiceId: "a", cents: 200000, outstandingCents: 200000, currency: "AUD" },
        { invoiceId: "b", cents: 200000, outstandingCents: 200000, currency: "AUD" },
      ])
    ).toThrow(/Over-allocated/);
  });

  it("throws when an allocation exceeds the invoice balance", () => {
    expect(() =>
      allocate(cityReceipt, [{ invoiceId: "inv-1013", cents: 300000, outstandingCents: 0, currency: "AUD" }])
    ).toThrow(/exceeds its balance/);
  });

  it("throws on currency mismatch", () => {
    expect(() =>
      allocate(cityReceipt, [{ invoiceId: "inv-1031", cents: 300000, outstandingCents: 300000, currency: "NZD" }])
    ).toThrow(/Currency mismatch/);
  });

  it("throws on negative or duplicate allocations", () => {
    expect(() =>
      allocate(cityReceipt, [{ invoiceId: "x", cents: -1, outstandingCents: 100, currency: "AUD" }])
    ).toThrow(MoneyError);
    expect(() =>
      allocate(cityReceipt, [
        { invoiceId: "x", cents: 1, outstandingCents: 100, currency: "AUD" },
        { invoiceId: "x", cents: 1, outstandingCents: 100, currency: "AUD" },
      ])
    ).toThrow(/twice/);
  });
});

describe("formatAud", () => {
  it("formats en-AU with cents", () => {
    expect(formatAud(300000)).toBe("A$3,000.00");
    expect(formatAud(36000)).toBe("A$360.00");
    expect(formatAud(0)).toBe("A$0.00");
  });

  it("formats whole dollars for KPIs", () => {
    expect(formatAud(1600000, { cents: false })).toBe("A$16,000");
    expect(formatAud(990000, { cents: false })).toBe("A$9,900");
  });

  it("formats negatives and statement amounts", () => {
    expect(formatAud(-421000)).toBe("−A$4,210.00");
    expect(formatAmount(-421000)).toBe("-4,210.00");
    expect(formatAmount(300000)).toBe("3,000.00");
  });
});

describe("parseAmountToCents", () => {
  it("parses typed amounts to integer cents", () => {
    expect(parseAmountToCents("47.00")).toBe(4700);
    expect(parseAmountToCents("3,000")).toBe(300000);
    expect(parseAmountToCents("A$1,248.5")).toBe(124850);
  });
  it("rejects negatives, letters and sub-cent precision", () => {
    expect(parseAmountToCents("-1")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1.005")).toBeNull();
  });
});
