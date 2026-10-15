"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { draftFinalNotice, sendTermsToTony } from "@/app/(shell)/customers/[id]/actions";

/** Suggested change of terms — Sarah can only send it to Tony as a Task; terms never change here. */
export function TermsPanel({
  customerId,
  customerName,
  rationale,
  options,
  openTask,
}: {
  customerId: string;
  customerName: string;
  rationale: string;
  options: { key: string; title: string; body: string }[];
  openTask: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(options[0]?.key);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const chosen = options.find((o) => o.key === choice);

  const send = () =>
    start(async () => {
      const r = await sendTermsToTony({ customerId, option: choice! });
      if (!r.ok) {
        toast({ variant: "destructive", title: "Not sent", description: r.error });
        return;
      }
      toast({ title: "Sent to Tony", description: "A task is waiting for his decision. Terms are unchanged." });
      setConfirm(false);
      router.refresh();
    });

  const draft = () =>
    start(async () => {
      const r = await draftFinalNotice(customerId);
      if (!r.ok || !r.id) {
        toast({ variant: "destructive", title: "No draft", description: r.ok ? "" : r.error });
        return;
      }
      router.push(`/communications/${r.id}`);
    });

  return (
    <section className="flex flex-col gap-3 rounded-kc-card border border-kc-status-review/40 bg-kc-surface px-6 py-5 shadow-kc-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-status-review uppercase">Suggested change of terms — for Tony to decide</h2>
        <span className="rounded-kc-badge border border-kc-primary-line bg-kc-primary-tint px-2 py-0.5 text-[11px] font-semibold text-kc-primary">Suggested</span>
      </div>
      <p className="text-[13px] text-kc-muted">{rationale}</p>
      <div className="grid gap-2.5 text-[13px] md:grid-cols-3" role="radiogroup" aria-label="Terms options">
        {options.map((o) => (
          <label
            key={o.key}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-3",
              choice === o.key ? "border-kc-primary bg-kc-primary-tint" : "border-kc-border"
            )}
          >
            <input type="radio" name="terms" className="mt-[3px] accent-kc-primary" checked={choice === o.key} onChange={() => setChoice(o.key)} />
            <span>
              <span className="font-semibold">{o.title}</span>
              <span className="block text-xs text-kc-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" disabled={pending || !!openTask} onClick={() => setConfirm(true)}>
          Send to Tony for decision
        </Button>
        <Button size="lg" variant="outline" disabled={pending} onClick={draft}>
          Draft the final notice
        </Button>
        <span className="text-xs text-kc-muted">{openTask ? `Waiting for Tony: ${openTask}` : "Changing terms is Tony's call, not Sarah's and not the AI's."}</span>
      </div>

      <Dialog open={confirm} onOpenChange={(o) => !o && !pending && setConfirm(false)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send this decision to Tony?</DialogTitle>
            <DialogDescription>Creates a task for Tony. {customerName}&apos;s terms do not change until he decides.</DialogDescription>
          </DialogHeader>
          {chosen && (
            <div className="rounded-kc-input bg-kc-bg p-3 text-[13px]">
              <div className="font-semibold">{chosen.title}</div>
              <div className="text-kc-muted">{chosen.body}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={pending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={send}>
              {pending ? "Sending…" : "Send to Tony"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
