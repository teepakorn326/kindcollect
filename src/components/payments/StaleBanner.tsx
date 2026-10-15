"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAud } from "@/lib/money";
import { usePaymentStale, type Fingerprint } from "./usePaymentStale";
import { useOwnWrite } from "./OwnWrite";

/** Shown when the receipt or an invoice changed after this page was loaded (TanStack Query dataUpdatedAt). */
export function StaleBanner({ paymentId, initial }: { paymentId: string; initial: Fingerprint }) {
  const router = useRouter();
  const { stale: changedRemotely, changed, dataUpdatedAt, latest } = usePaymentStale(paymentId, initial);
  const { ownWrite } = useOwnWrite();
  const stale = changedRemotely && !ownWrite;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!stale) {
    const secs = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000)) : null;
    return (
      <p className="text-xs text-kc-muted" aria-live="polite">
        {secs === null ? "Checking for changes…" : `Balances checked ${secs}s ago`}
      </p>
    );
  }

  const details = changed
    .map((label) => {
      const inv = latest?.invoices.find((i) => i.number === label);
      const before = initial.invoices.find((i) => i.number === label);
      if (!inv) return `${label} was updated`;
      if (before && before.balanceCents === inv.balanceCents) return `${label} was edited (balance still ${formatAud(inv.balanceCents)})`;
      return `${label} is now ${formatAud(inv.balanceCents)}${inv.status === "paid" ? " (paid)" : ""}`;
    })
    .join(" · ");

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-kc-status-review/40 bg-kc-status-review-bg px-4 py-3 text-[13px]">
      <AlertTriangle className="size-4 text-kc-status-review" aria-hidden />
      <div className="flex-1">
        <span className="font-semibold">Data changed since you opened this page.</span> <span>{details}. Review the latest before confirming.</span>
      </div>
      <Button size="md" onClick={() => router.refresh()}>
        Reload
      </Button>
    </div>
  );
}
