"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SuggestionPanel } from "@/components/domain/SuggestionPanel";
import { toast } from "@/hooks/use-toast";
import { dateOnly } from "@/lib/clock";
import { formatDate } from "@/lib/format";
import { formatAud, subtractCents } from "@/lib/money";
import { creditNote } from "@/lib/rules";
import { approveCreditNote, rejectReturn } from "@/app/(shell)/queue/[caseId]/actions";

type ReturnRow = { id: string; number: string; product: string; quantity: number; unitPriceCents: number };

export function CreditNotePanel({
  caseId,
  customerName,
  invoice,
  returns,
  gstFree,
  termsDays,
  defaultDueDate,
  caseUpdatedAt,
  body,
  evidenceIds,
}: {
  caseId: string;
  customerName: string;
  invoice: { number: string; balanceCents: number; updatedAt: string };
  returns: ReturnRow[];
  gstFree: boolean;
  termsDays: number;
  defaultDueDate: string;
  caseUpdatedAt: string;
  body: string;
  evidenceIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(returns.map((r) => [r.id, r.quantity]))
  );
  const [editing, setEditing] = useState(false);
  const [approver, setApprover] = useState<"Sarah" | "Tony">("Sarah");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [confirm, setConfirm] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<{ message: string; stale?: boolean } | null>(null);

  // Same pure rule the server runs — the display can never disagree with what gets written.
  const valid = returns.every((r) => Number.isInteger(quantities[r.id]) && quantities[r.id] >= 1 && quantities[r.id] <= r.quantity);
  const calc = valid
    ? creditNote(
        returns.map((r) => ({ product: r.product, quantity: quantities[r.id], unitPriceCents: r.unitPriceCents })),
        { gstFree }
      )
    : null;
  const after = calc ? subtractCents(invoice.balanceCents, calc.totalCents) : null;
  const money = (c: number) => formatAud(c, { cents: false });

  const fail = (res: { error: string; stale?: boolean }) => setError({ message: res.error, stale: res.stale });

  const run = (kind: "approve" | "reject") =>
    startTransition(async () => {
      setError(null);
      if (kind === "approve") {
        const res = await approveCreditNote({
          caseId,
          quantities,
          approver,
          dueDate,
          expectedBalanceCents: invoice.balanceCents,
          expectedUpdatedAt: invoice.updatedAt,
        });
        if (!res.ok) return fail(res);
        toast({
          variant: "success",
          title: `Credit note ${res.creditNoteNumbers.join(", ")} approved`,
          description: `${invoice.number} balance is now ${formatAud(res.balanceAfterCents)}. Nothing was sent to ${customerName}.`,
        });
      } else {
        const res = await rejectReturn({ caseId, expectedUpdatedAt: caseUpdatedAt });
        if (!res.ok) return fail(res);
        toast({ title: "Case re-opened for review", description: "Diagnosis marked as not a valid return." });
      }
      // keep the dialog on "Saving…" until the refreshed page arrives
      router.refresh();
    });

  return (
    <SuggestionPanel id="fix" title="Proposed fix" body={body} evidenceIds={evidenceIds}>
      <div className="grid grid-cols-2 gap-3 rounded-kc-input border border-kc-border bg-kc-surface px-3.5 py-3 text-[13px]">
        <div>
          <div className="text-kc-muted">Credit note</div>
          {returns.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5 font-semibold tabular-nums">
              {editing ? (
                <Input
                  type="number"
                  min={1}
                  max={r.quantity}
                  aria-label={`Boxes to credit for ${r.number}`}
                  value={Number.isNaN(quantities[r.id]) ? "" : quantities[r.id]}
                  onChange={(e) => setQuantities((q) => ({ ...q, [r.id]: e.target.valueAsNumber }))}
                  className="h-7 w-16"
                />
              ) : (
                quantities[r.id]
              )}{" "}
              boxes × {formatAud(r.unitPriceCents)}
              {calc && returns.length === 1 && <> = {formatAud(calc.totalCents)}</>}
            </div>
          ))}
          {!valid && <p className="text-xs text-kc-status-error">Enter 1–{returns[0]?.quantity} boxes</p>}
        </div>
        <div>
          <div className="text-kc-muted">Corrected balance</div>
          <div className="font-semibold tabular-nums">
            {formatAud(invoice.balanceCents)} → {after !== null ? formatAud(after) : "—"}
          </div>
        </div>
        <div>
          <div className="text-kc-muted">GST</div>
          <div className="font-medium">
            {gstFree ? "None — fresh produce is GST-free" : calc ? formatAud(calc.gstCents) : "—"}
          </div>
        </div>
        <div>
          <div className="text-kc-muted">New due date</div>
          <div className="font-medium">{termsDays} days from corrected invoice</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 text-xs font-medium text-kc-muted">
          <span id="approver-label">Approver</span>
          <Select value={approver} onValueChange={(v) => setApprover(v as "Sarah" | "Tony")}>
            <SelectTrigger aria-labelledby="approver-label" className="h-9 w-full bg-kc-surface text-sm text-kc-text">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Sarah">Sarah — bookkeeper</SelectItem>
              <SelectItem value="Tony">Tony — owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-kc-muted">
          Due
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-9 bg-kc-surface text-sm text-kc-text"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={!calc || !dueDate} onClick={() => setConfirm("approve")}>
          Approve credit note
        </Button>
        <Button size="lg" variant="outline" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
          {editing ? "Done editing" : "Edit amount"}
        </Button>
        <Button size="lg" variant="ghost" className="text-kc-muted" onClick={() => setConfirm("reject")}>
          Not a valid return
        </Button>
      </div>
      {calc && (
        <p className="text-xs text-kc-muted">
          Approving posts Dr Sales Returns {money(calc.netCents)}
          {calc.gstCents > 0 && <> + GST {money(calc.gstCents)}</>} / Cr Accounts Receivable {money(calc.totalCents)}, drafts the
          corrected invoice for your review, and keeps reminders paused. Nothing is sent to {customerName} yet.
        </p>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          {confirm === "approve" && calc && after !== null ? (
            <>
              <DialogHeader>
                <DialogTitle>Approve credit note for {customerName}?</DialogTitle>
                <DialogDescription>Check the numbers. This writes to the ledger; nothing is sent to the customer.</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-kc-input bg-kc-bg p-3 text-[13px]">
                <dt className="text-kc-muted">Credit note</dt>
                <dd className="text-right font-semibold tabular-nums">{formatAud(calc.totalCents)}</dd>
                <dt className="text-kc-muted">{invoice.number} balance</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {formatAud(invoice.balanceCents)} → {formatAud(after)}
                </dd>
                <dt className="text-kc-muted">Journal</dt>
                <dd className="text-right tabular-nums">
                  Dr Sales Returns {money(calc.netCents)} · Cr AR {money(calc.totalCents)}
                </dd>
                <dt className="text-kc-muted">New due date</dt>
                <dd className="text-right">{formatDate(dateOnly(dueDate))}</dd>
                <dt className="text-kc-muted">Approver</dt>
                <dd className="text-right">{approver}</dd>
                <dt className="text-kc-muted">Reminders</dt>
                <dd className="text-right">Stay paused</dd>
              </dl>
            </>
          ) : (
            <DialogHeader>
              <DialogTitle>Mark as not a valid return?</DialogTitle>
              <DialogDescription>
                The suggested diagnosis is rejected and the case goes back for review. No credit note is issued and nothing is sent.
              </DialogDescription>
            </DialogHeader>
          )}
          {error && (
            <p role="alert" className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">
              {error.message}{" "}
              {error.stale && (
                <button type="button" className="font-semibold underline" onClick={() => router.refresh()}>
                  Reload
                </button>
              )}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={() => run(confirm ?? "approve")}>
              {pending ? "Saving…" : confirm === "approve" ? "Confirm credit note" : "Re-open for review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuggestionPanel>
  );
}
