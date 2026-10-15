"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AllocationRow, ALLOCATION_GRID, centsToInput, parseCents } from "@/components/domain/AllocationRow";
import { toast } from "@/hooks/use-toast";
import { allocate, formatAmount, formatAud, MoneyError, type AllocationResult } from "@/lib/money";
import { cn } from "@/lib/utils";
import { confirmMatch, rejectMatch } from "@/app/(shell)/payments/[paymentId]/review/actions";
import { usePaymentStale, type Fingerprint } from "./usePaymentStale";
import { useOwnWrite } from "./OwnWrite";

export type PanelRow = {
  id: string;
  number: string;
  outstandingCents: number;
  note: string;
  muted?: boolean;
  proposedCents: number;
  /** only shown after "Edit allocation" */
  extra?: boolean;
  heldReminder?: string | null;
};

export function AllocationPanel({
  payment,
  customerName,
  customerShortName,
  rows,
  explanation,
  fingerprint,
  hasProposal,
}: {
  payment: { id: string; remainingCents: number; currency: string };
  customerName: string;
  customerShortName: string;
  rows: PanelRow[];
  explanation: string;
  fingerprint: Fingerprint;
  hasProposal: boolean;
}) {
  const router = useRouter();
  const { stale: changedRemotely } = usePaymentStale(payment.id, fingerprint);
  const { ownWrite, setOwnWrite } = useOwnWrite();
  const stale = changedRemotely && !ownWrite;
  // fresh server data arrived (new fingerprint) → our write is reflected; watch for others again
  useEffect(() => setOwnWrite(false), [fingerprint.paymentUpdatedAt, setOwnWrite]);
  const [editing, setEditing] = useState(!hasProposal);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.id, r.proposedCents > 0])));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.proposedCents > 0 ? centsToInput(r.proposedCents) : ""]))
  );
  const [confirm, setConfirm] = useState<null | "match" | "reject">(null);
  const [error, setError] = useState<{ message: string; stale?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = rows.filter((r) => !r.extra || editing);
  const selected = visible.filter((r) => checked[r.id]);

  // Live validation with the same allocate() the server runs
  const live = useMemo((): { result: AllocationResult | null; error: string | null } => {
    const parsed = selected.map((r) => ({ r, cents: parseCents(values[r.id] ?? "") }));
    if (parsed.some((p) => p.cents === null)) return { result: null, error: "Enter a valid amount on every ticked invoice" };
    try {
      const result = allocate(
        { cents: payment.remainingCents, currency: payment.currency },
        parsed.map(({ r, cents }) => ({ invoiceId: r.id, cents: cents!, outstandingCents: r.outstandingCents, currency: "AUD" }))
      );
      return { result, error: null };
    } catch (e) {
      const msg = e instanceof MoneyError ? e.message : "Invalid allocation";
      return { result: null, error: rows.reduce((m, r) => m.replaceAll(r.id, r.number), msg) };
    }
  }, [selected, values, payment.remainingCents, payment.currency, rows]);

  const allocated = live.result?.allocatedCents ?? 0;
  const unallocated = payment.remainingCents - allocated;
  const nonZero = live.result?.allocations.filter((a) => a.cents > 0) ?? [];
  const canConfirm = !!live.result && nonZero.length > 0 && !stale && !pending;
  const rowById = (id: string) => rows.find((r) => r.id === id)!;
  const held = nonZero.map((a) => rowById(a.invoiceId).heldReminder).filter(Boolean) as string[];

  const run = (kind: "match" | "reject") =>
    startTransition(async () => {
      setError(null);
      setOwnWrite(true);
      const res =
        kind === "match"
          ? await confirmMatch({
              paymentId: payment.id,
              allocations: nonZero.map((a) => ({ invoiceId: a.invoiceId, cents: a.cents })),
              expectedPaymentUpdatedAt: fingerprint.paymentUpdatedAt,
              expectedInvoices: fingerprint.invoices.map(({ id, balanceCents, updatedAt }) => ({ id, balanceCents, updatedAt })),
            })
          : await rejectMatch({ paymentId: payment.id, expectedPaymentUpdatedAt: fingerprint.paymentUpdatedAt });
      if (!res.ok) {
        setOwnWrite(false);
        setError({ message: res.error, stale: res.stale });
        return;
      }
      // dialog stays open on "Saving…" until the refreshed page (summary from the DB) arrives
      toast(
        kind === "match"
          ? { variant: "success", title: "Payment matched", description: `${formatAud(allocated)} from ${customerName} allocated.` }
          : { title: "Marked as not a match", description: "The receipt stays in suspense and the case goes back for review." }
      );
      router.refresh();
      if (kind === "reject") setConfirm(null);
    });

  return (
    <div className="flex flex-col gap-3.5 rounded-kc-card border border-kc-primary-line bg-kc-surface px-6 py-5 shadow-kc-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-primary uppercase">Proposed allocation</h2>
        {hasProposal && (
          <span className="rounded-kc-badge border border-kc-primary-line bg-kc-primary-tint px-2 py-0.5 text-[11px] font-semibold text-kc-primary">
            Suggested
          </span>
        )}
      </div>
      <p className="text-[13px] text-kc-muted">{explanation}</p>

      <div className="flex flex-col gap-2">
        <div className={cn(ALLOCATION_GRID, "px-3 text-xs text-kc-muted")}>
          <span />
          <span>Invoice</span>
          <span className="text-right">Outstanding</span>
          <span className="text-right">Allocate</span>
        </div>
        {visible.map((r) => {
          const others = selected.filter((s) => s.id !== r.id).reduce((sum, s) => sum + (parseCents(values[s.id] ?? "") ?? 0), 0);
          return (
            <AllocationRow
              key={r.id}
              invoice={r}
              proposedCents={r.proposedCents || r.outstandingCents}
              unallocatedCents={payment.remainingCents - others}
              checked={!!checked[r.id]}
              value={values[r.id] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [r.id]: v }))}
              onCheckedChange={(c) => {
                setChecked((s) => ({ ...s, [r.id]: c }));
                if (c && !values[r.id]) setValues((s) => ({ ...s, [r.id]: centsToInput(Math.min(r.outstandingCents, Math.max(0, payment.remainingCents - others))) }));
              }}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-[10px] bg-kc-bg px-4 py-3.5">
        <div>
          <div className="text-xs text-kc-muted">Receipt</div>
          <div className="font-semibold tabular-nums">{formatAud(payment.remainingCents)}</div>
        </div>
        <div>
          <div className="text-xs text-kc-muted">Allocated</div>
          <div className="font-semibold tabular-nums">{live.result ? formatAud(allocated) : "—"}</div>
        </div>
        <div>
          <div className="text-xs text-kc-muted">Unallocated</div>
          <div className={cn("font-semibold tabular-nums", live.result && unallocated === 0 ? "text-kc-status-success" : "text-kc-status-review")}>
            {live.result ? formatAud(unallocated) : "—"}
          </div>
        </div>
      </div>
      {live.error && (
        <p role="alert" className="text-xs text-kc-status-error">
          {live.error}
        </p>
      )}

      {nonZero.length > 0 && (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {nonZero.map((a) => (
            <div key={a.invoiceId} className="flex justify-between gap-4">
              <span className="text-kc-muted">{rowById(a.invoiceId).number} balance after allocation</span>
              <span className="tabular-nums">
                {formatAud(a.cents + a.balanceAfterCents)} → <strong>{formatAud(a.balanceAfterCents)}</strong>
              </span>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <span className="text-kc-muted">Journal</span>
            <span className="font-mono text-xs">
              Dr Suspense {formatAmount(allocated).replace(".00", "")} · Cr AR – {customerShortName} {formatAmount(allocated).replace(".00", "")}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-kc-border pt-1">
        <Button size="lg" className="mt-3" disabled={!canConfirm} onClick={() => setConfirm("match")} title={stale ? "Reload first — data changed" : undefined}>
          Confirm match
        </Button>
        <Button size="lg" variant="outline" className="mt-3" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
          {editing ? "Done editing" : "Edit allocation"}
        </Button>
        {hasProposal && (
          <Button size="lg" variant="ghost" className="mt-3 ml-auto text-kc-status-error hover:text-kc-status-error" onClick={() => setConfirm("reject")}>
            Not a match
          </Button>
        )}
      </div>
      <p className="text-xs text-kc-muted">
        Confirming marks {nonZero.filter((a) => a.balanceAfterCents === 0).map((a) => rowById(a.invoiceId).number).join(", ") || "the invoice"} paid
        {held.length > 0 && ", cancels the held reminder for good"}, writes the audit entry, and shows you a summary. Nothing is sent to{" "}
        {customerShortName}.
      </p>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          {confirm === "match" && live.result ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirm match for {customerName}?</DialogTitle>
                <DialogDescription>Check the summary. This writes to the ledger; nothing is sent to the customer.</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-kc-input bg-kc-bg p-3 text-[13px]">
                <dt className="text-kc-muted">Receipt</dt>
                <dd className="text-right font-semibold tabular-nums">{formatAud(payment.remainingCents)}</dd>
                {nonZero.map((a) => (
                  <div key={a.invoiceId} className="contents">
                    <dt className="text-kc-muted">{rowById(a.invoiceId).number}</dt>
                    <dd className="text-right tabular-nums">
                      {formatAud(a.cents + a.balanceAfterCents)} → {formatAud(a.balanceAfterCents)}
                      {a.balanceAfterCents === 0 && <span className="text-kc-status-success"> · paid</span>}
                    </dd>
                  </div>
                ))}
                <dt className="text-kc-muted">Left in suspense</dt>
                <dd className="text-right tabular-nums">{formatAud(unallocated)}</dd>
                {held.map((h) => (
                  <div key={h} className="contents">
                    <dt className="text-kc-muted">Held reminder</dt>
                    <dd className="text-right">“{h}” cancelled</dd>
                  </div>
                ))}
                <dt className="text-kc-muted">Journal</dt>
                <dd className="text-right font-mono text-xs">
                  Dr Suspense {formatAmount(allocated)} · Cr AR {formatAmount(allocated)}
                </dd>
              </dl>
            </>
          ) : (
            <DialogHeader>
              <DialogTitle>Mark as not a match?</DialogTitle>
              <DialogDescription>
                The receipt stays in unallocated receipts (suspense), nothing is marked paid, and the case goes back for review. Sending
                stays paused while the receipt is unmatched.
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
            <Button size="md" disabled={pending || (confirm === "match" && !canConfirm && !pending)} onClick={() => run(confirm ?? "match")}>
              {pending ? "Saving…" : confirm === "match" ? "Confirm match" : "Not a match"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
