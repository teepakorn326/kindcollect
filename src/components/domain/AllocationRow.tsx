"use client";

import { Input } from "@/components/ui/input";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { cn } from "@/lib/utils";

/** Parse "3,000.00" → 300000 cents; null when not a valid non-negative amount with ≤ 2 decimals. */
export function parseCents(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * One invoice in a payment allocation. Validates ≤ outstanding and ≤ unallocated as you type;
 * the authoritative check is allocate() in lib/money.ts, re-run on the server.
 */
export function AllocationRow({
  invoice,
  proposedCents,
  unallocatedCents,
  value,
  onChange,
  disabled,
}: {
  invoice: { id: string; number: string; outstandingCents: number; note: React.ReactNode };
  proposedCents: number;
  /** receipt cents not allocated to other rows */
  unallocatedCents: number;
  value: string;
  onChange: (value: string, cents: number | null) => void;
  disabled?: boolean;
}) {
  const cents = parseCents(value);
  const error =
    cents === null
      ? "Enter an amount like 3000.00"
      : cents > invoice.outstandingCents
        ? "More than this invoice's balance"
        : cents > unallocatedCents
          ? "More than is left on the receipt"
          : null;

  return (
    <tr className="border-t border-kc-border align-top">
      <td className="py-3 pr-3">
        <div className="font-semibold">{invoice.number}</div>
        <div className="text-xs text-kc-muted">{invoice.note}</div>
      </td>
      <td className="py-3 pr-3 text-right">
        <MoneyValue cents={invoice.outstandingCents} />
      </td>
      <td className="py-3">
        <label className="flex items-center gap-1.5">
          <span className="text-kc-muted">A$</span>
          <Input
            inputMode="decimal"
            aria-label={`Allocate to ${invoice.number}`}
            aria-invalid={!!error}
            value={value}
            disabled={disabled}
            placeholder={(proposedCents / 100).toFixed(2)}
            onChange={(e) => onChange(e.target.value, parseCents(e.target.value))}
            className={cn("h-9 w-32 text-right tabular-nums", error && "border-kc-status-error")}
          />
        </label>
        {error && <p className="mt-1 text-xs text-kc-status-error">{error}</p>}
      </td>
    </tr>
  );
}
