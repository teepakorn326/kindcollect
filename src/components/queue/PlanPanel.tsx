"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SuggestionPanel } from "@/components/domain/SuggestionPanel";
import { toast } from "@/hooks/use-toast";
import { decidePlan, proposePlan } from "@/app/(shell)/queue/[caseId]/actions";

type Instalment = { sequence: number; label: string; amount: string };

/** Cash-flow fix: plan drafted by rules → Tony approves → routine reminders pause. */
export function PlanPanel({
  caseId,
  customerName,
  balanceCents,
  balance,
  plan,
  preview,
}: {
  caseId: string;
  customerName: string;
  balanceCents: number;
  balance: string;
  plan: { id: string; status: "proposed" | "approved" | "rejected"; instalments: Instalment[]; decidedAt?: string } | null;
  /** proposePaymentPlan() preview when no plan exists yet */
  preview: Instalment[];
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<null | "propose" | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rows = plan?.instalments ?? preview;

  const run = () =>
    start(async () => {
      setError(null);
      const res =
        confirm === "propose"
          ? await proposePlan({ caseId, expectedBalanceCents: balanceCents })
          : await decidePlan({ planId: plan!.id, decision: confirm === "approve" ? "approve" : "reject" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast(
        confirm === "propose"
          ? { title: "Plan sent to Tony", description: "Nothing is sent to the customer until Tony approves." }
          : confirm === "approve"
            ? { variant: "success", title: "Plan approved", description: "Routine reminders are paused for this invoice." }
            : { title: "Plan declined" }
      );
      setConfirm(null);
      router.refresh();
    });

  const title =
    plan?.status === "approved" ? "Payment plan · approved by Tony" : plan?.status === "proposed" ? "Payment plan · waiting for Tony" : "Proposed fix";

  return (
    <SuggestionPanel id="plan" title={title} chip={plan?.status === "approved" ? "Approved" : "Suggested"}>
      <p className="text-[15px] font-medium">
        {plan?.status === "approved"
          ? `${customerName} pays ${balance} in ${rows.length} instalments. Routine reminders are paused.`
          : `Offer ${customerName} ${rows.length} instalments for ${balance}. Routine reminders stop once Tony approves.`}
      </p>
      <ol className="grid grid-cols-2 gap-3 rounded-kc-input border border-kc-border bg-kc-surface px-3.5 py-3 text-[13px]">
        {rows.map((i) => (
          <li key={i.sequence}>
            <div className="text-kc-muted">Instalment {i.sequence}</div>
            <div className="font-semibold tabular-nums">
              {i.amount} · {i.label}
            </div>
          </li>
        ))}
      </ol>
      {!plan && (
        <div>
          <Button size="lg" onClick={() => setConfirm("propose")}>
            Send plan to Tony
          </Button>
        </div>
      )}
      {plan?.status === "proposed" && (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => setConfirm("approve")}>
            Approve plan (Tony)
          </Button>
          <Button size="lg" variant="ghost" className="text-kc-muted" onClick={() => setConfirm("reject")}>
            Decline
          </Button>
        </div>
      )}
      <p className="text-xs text-kc-muted">
        Amounts and dates are computed by rule (equal instalments, first in 7 days, then every 14). No journal entry until money arrives.
      </p>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm === "propose" ? "Send this plan to Tony?" : confirm === "approve" ? `Approve the plan for ${customerName}?` : "Decline this plan?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "propose"
                ? "Creates a plan proposal that only Tony can approve. Nothing is sent to the customer."
                : confirm === "approve"
                  ? "Recorded as Tony's decision. Routine reminders for this invoice pause; the instalments become the expected payments."
                  : "The plan is set aside; the case stays open."}
            </DialogDescription>
          </DialogHeader>
          <ul className="rounded-kc-input bg-kc-bg p-3 text-[13px] tabular-nums">
            {rows.map((i) => (
              <li key={i.sequence}>
                {i.amount} · {i.label}
              </li>
            ))}
          </ul>
          {error && <p className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={run}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuggestionPanel>
  );
}
