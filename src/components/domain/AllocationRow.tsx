"use client";

import { Input } from "@/components/ui/input";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Parse "3,000.00" → 300000 cents (lib/money). */
export const parseCents = parseAmountToCents;

export const centsToInput = (cents: number) =>
  new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

export const ALLOCATION_GRID = "grid grid-cols-[22px_1fr_96px_128px] items-center gap-3";

/**
 * One invoice in a payment allocation. Validates ≤ outstanding and ≤ unallocated as you type;
 * allocate() in lib/money.ts is the authoritative check (run live by the panel and again on the server).
 */
export function AllocationRow({
  invoice,
  proposedCents,
  unallocatedCents,
  checked,
  value,
  onChange,
  onCheckedChange,
}: {
  invoice: { id: string; number: string; outstandingCents: number; note: React.ReactNode; muted?: boolean };
  proposedCents: number;
  /** receipt cents not taken by other rows */
  unallocatedCents: number;
  checked: boolean;
  value: string;
  onChange: (value: string) => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const cents = parseCents(value);
  const nothingOwed = invoice.outstandingCents === 0;
  const error = !checked
    ? null
    : cents === null
      ? "Enter an amount like 3,000.00"
      : cents > invoice.outstandingCents
        ? "More than this invoice's balance"
        : cents > unallocatedCents
          ? "More than is left on the receipt"
          : null;

  return (
    <div>
      <label
        className={cn(
          ALLOCATION_GRID,
          "rounded-[10px] border p-3",
          invoice.muted || nothingOwed ? "border-dashed border-kc-muted/40 bg-kc-bg text-kc-muted" : "border-kc-border",
          error && "border-kc-status-error"
        )}
      >
        <input
          type="checkbox"
          className="size-[18px] accent-kc-primary"
          checked={checked}
          disabled={nothingOwed}
          onChange={(e) => onCheckedChange(e.target.checked)}
          aria-label={`Allocate to ${invoice.number}`}
        />
        <span>
          <span className="font-semibold text-kc-text">{invoice.number}</span>
          <span className="block text-xs">{invoice.note}</span>
        </span>
        <MoneyValue cents={invoice.outstandingCents} className="text-right" />
        <span className="flex items-center justify-end gap-1.5">
          <span className="text-kc-muted">A$</span>
          <Input
            inputMode="decimal"
            aria-label={`Amount for ${invoice.number}`}
            aria-invalid={!!error}
            value={checked ? value : "0.00"}
            disabled={!checked}
            placeholder={centsToInput(proposedCents)}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-[96px] text-right tabular-nums disabled:bg-kc-border/50"
          />
        </span>
      </label>
      {error && <p className="mt-1 px-3 text-xs text-kc-status-error">{error}</p>}
    </div>
  );
}
