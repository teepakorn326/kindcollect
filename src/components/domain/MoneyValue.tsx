import { formatAud } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Integer cents rendered en-AU with tabular numerals. */
export function MoneyValue({
  cents,
  currency = "AUD",
  showCents = true,
  className,
}: {
  cents: number;
  currency?: "AUD";
  showCents?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)} data-currency={currency}>
      {formatAud(cents, { cents: showCents })}
    </span>
  );
}
