import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const copy = {
  unmatched_payment: {
    title: "Sending paused",
    body: (amount?: string) =>
      `${amount ? `A ${amount}` : "A"} receipt from this customer is waiting to be matched. Match it before sending any reminder.`,
    cta: "Match payment",
  },
  dispute: {
    title: "Sending paused",
    body: () => "This customer has an open dispute. Resolve it before sending any reminder.",
    cta: "Open case",
  },
} as const;

/** Replaces the Approve button when sendGuard() blocks. */
export function SendGuard({
  reason = "unmatched_payment",
  href,
  amount,
}: {
  reason?: "unmatched_payment" | "dispute";
  href: string;
  /** formatted amount, e.g. "A$3,000" */
  amount?: string;
}) {
  const c = copy[reason];
  return (
    <div role="status" className="flex flex-col gap-2 rounded-[10px] border border-kc-status-review/40 bg-kc-status-review-bg p-3.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-kc-status-review">
        <PauseCircle className="size-4" aria-hidden />
        {c.title}
      </div>
      <p className="text-[13px] text-kc-text">{c.body(amount)}</p>
      <div>
        <Button asChild size="md">
          <Link href={href}>{c.cta}</Link>
        </Button>
      </div>
    </div>
  );
}
