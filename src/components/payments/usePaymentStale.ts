"use client";

import { useQuery } from "@tanstack/react-query";
import type { PaymentState } from "@/lib/payments";

export type Fingerprint = {
  paymentUpdatedAt: string;
  invoices: { id: string; number: string; balanceCents: number; updatedAt: string }[];
};

/**
 * Polls the receipt + its customer's invoices and compares with what the page was rendered from.
 * Shared query key, so the banner and the Confirm button see the same result.
 */
export function usePaymentStale(paymentId: string, initial: Fingerprint) {
  const q = useQuery({
    queryKey: ["payment-state", paymentId],
    queryFn: async (): Promise<PaymentState> => {
      const res = await fetch(`/api/payments/${paymentId}/state`, { cache: "no-store" });
      if (!res.ok) throw new Error(`state ${res.status}`);
      return res.json();
    },
    refetchInterval: 5_000,
  });

  const changed: string[] = [];
  if (q.data) {
    if (q.data.payment.updatedAt !== initial.paymentUpdatedAt) changed.push("this receipt");
    for (const inv of initial.invoices) {
      const now = q.data.invoices.find((i) => i.id === inv.id);
      if (!now || now.balanceCents !== inv.balanceCents || now.updatedAt !== inv.updatedAt) changed.push(inv.number);
    }
  }
  return { stale: changed.length > 0, changed, dataUpdatedAt: q.dataUpdatedAt, latest: q.data };
}
