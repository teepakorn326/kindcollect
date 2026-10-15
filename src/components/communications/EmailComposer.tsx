"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Paperclip, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SendGuard } from "@/components/domain/SendGuard";
import { toast } from "@/hooks/use-toast";
import { draftAmountIssues } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { approveAndSend, redraft, saveDraft } from "@/app/(shell)/communications/[draftId]/actions";

type Tone = "warm" | "neutral" | "firm";
export type ComposerFact = { id: string; text: string; source: string };

export function EmailComposer({
  draftId,
  from,
  initial,
  recommended,
  why,
  facts,
  allowedCents,
  invoiceNumber,
  payLinkLabel,
  guard,
  demoMode,
  updatedAt,
  customerName,
  asideExtra,
}: {
  draftId: string;
  from: string;
  initial: { to: string; subject: string; body: string; tone: Tone; factsUsed: string[] | null };
  recommended: Tone;
  why: string;
  facts: ComposerFact[];
  allowedCents: number[];
  invoiceNumber: string;
  payLinkLabel: string | null;
  guard: { blocked: false } | { blocked: true; reason: "unmatched_payment" | "dispute"; href: string; amount?: string };
  demoMode: boolean;
  updatedAt: string;
  customerName: string;
  asideExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [to, setTo] = useState(initial.to);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [factsUsed, setFactsUsed] = useState<string[] | null>(initial.factsUsed);
  const [cached, setCached] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();

  const issues = draftAmountIssues(`${subject}\n${body}`, allowedCents);

  const draft = (t: Tone, fresh = false) =>
    startDraft(async () => {
      setTone(t);
      setAiError(null);
      const r = await redraft({ draftId, tone: t, fresh });
      if (!r.ok) {
        setAiError(r.error);
        return;
      }
      setSubject(r.subject);
      setBody(r.body);
      setFactsUsed(r.factsUsed);
      setCached(r.cached);
    });

  const payload = { draftId, to, subject, body, tone, expectedUpdatedAt: updatedAt };

  const save = () =>
    startSave(async () => {
      const r = await saveDraft(payload);
      if (!r.ok) {
        toast({ variant: "destructive", title: "Not saved", description: r.error });
        return;
      }
      toast({ title: "Draft saved", description: "Nothing was sent." });
      router.refresh();
    });

  const send = () =>
    startSend(async () => {
      setSendError(null);
      const r = await approveAndSend(payload);
      if (!r.ok) {
        setSendError(r.error);
        return;
      }
      toast(
        r.demoOnly
          ? { variant: "review", title: "Demo mode — message logged, not sent", description: `Approved for ${customerName}. Nothing was emailed.` }
          : { variant: "success", title: "Email sent", description: `Approved and sent to ${to}.` }
      );
      router.refresh();
    });

  const usedFacts = factsUsed === null ? facts : facts.filter((f) => factsUsed.includes(f.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
      <aside className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
          <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Why this tone</h2>
          <div className="flex gap-1.5" role="group" aria-label="Tone">
            {(["warm", "neutral", "firm"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                disabled={drafting}
                onClick={() => t !== tone && draft(t)}
                className={cn(
                  "h-9 flex-1 cursor-pointer rounded-kc-input border text-sm capitalize disabled:cursor-wait",
                  tone === t ? "border-kc-primary bg-kc-primary-tint font-semibold text-kc-primary" : "border-kc-border bg-kc-surface font-medium text-kc-muted hover:text-kc-text"
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-kc-muted">{why}</p>
          {tone !== recommended && (
            <p className="text-xs text-kc-status-review">
              Suggested tone for this customer is <strong className="capitalize">{recommended}</strong>.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
          <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Facts used in this draft</h2>
          <ul className="flex flex-col gap-2 text-[13px]">
            {usedFacts.map((f) => (
              <li key={f.id} className="flex gap-2.5">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-kc-primary" aria-hidden />
                <span>
                  {f.text} <span className="text-kc-muted">— {f.source}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-kc-muted">
            Status is rechecked at send time. If {customerName.replace(/\s+(Co\.?)$/, "")} pays or replies first, sending is paused automatically.
          </p>
        </div>
        {asideExtra}
      </aside>

      <section className="flex flex-col rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
        <div className="flex items-center justify-between border-b border-kc-border px-6 py-4">
          <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Draft from Tony</h2>
          <div className="flex items-center gap-2">
            {cached && <span className="rounded-kc-badge border border-kc-border px-1.5 py-px text-[11px] text-kc-muted">cached</span>}
            <button
              type="button"
              onClick={() => draft(tone, true)}
              disabled={drafting}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-kc-muted hover:text-kc-text disabled:cursor-wait"
              title="Ask Claude for a fresh draft in this tone"
            >
              <RefreshCw className={cn("size-3.5", drafting && "animate-spin")} aria-hidden />
              {drafting ? "Drafting…" : "Redraft"}
            </button>
            <span className="rounded-kc-badge border border-kc-primary-line bg-kc-primary-tint px-2 py-0.5 text-[11px] font-semibold text-kc-primary">
              Suggested · editable
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 border-b border-kc-border px-6 py-4">
          <label className="grid grid-cols-[80px_1fr] items-center gap-3 text-[13px] text-kc-muted">
            From
            <Input value={from} readOnly className="h-9 bg-kc-bg text-kc-text" />
          </label>
          <label className="grid grid-cols-[80px_1fr] items-center gap-3 text-[13px] text-kc-muted">
            To
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-kc-text" />
          </label>
          <label className="grid grid-cols-[80px_1fr] items-center gap-3 text-[13px] text-kc-muted">
            Subject
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 font-medium text-kc-text" />
          </label>
        </div>
        <div className="flex-1 px-6 py-5">
          <label htmlFor="draft-body" className="mb-1.5 block text-xs text-kc-muted">
            Message
          </label>
          <Textarea
            id="draft-body"
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-busy={drafting}
            className={cn("p-3.5 text-sm leading-relaxed", drafting && "opacity-50")}
          />
          {aiError && <p className="mt-2 text-xs text-kc-status-error">{aiError} The current draft is kept.</p>}
          {issues.length > 0 && (
            <p role="alert" className="mt-2 rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-xs text-kc-status-error">
              Amounts that don&apos;t match {invoiceNumber}: {issues.join(", ")}. Edit before approving.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px]">
            <span className="text-kc-muted">Attachments</span>
            <span className="inline-flex items-center gap-1.5 rounded-kc-badge border border-kc-border px-2.5 py-1">
              <Paperclip className="size-3.5" aria-hidden />
              {invoiceNumber}.pdf
            </span>
            {payLinkLabel && body.includes("[PAY LINK]") && (
              <span className="inline-flex items-center rounded-kc-badge border border-kc-primary-line bg-kc-primary-tint px-2.5 py-1 font-medium text-kc-primary">
                {payLinkLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-b-kc-card border-t border-kc-border bg-kc-bg px-6 py-4">
          <Button variant="outline" size="lg" onClick={save} disabled={saving || drafting}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button variant="outline" size="lg" disabled title="Tasks for Tony arrive with Customer Account (Phase 9)">
            Ask Tony to review
          </Button>
          <div className="flex-1" />
          {guard.blocked ? (
            <div className="w-full sm:w-auto sm:min-w-[320px]">
              <SendGuard reason={guard.reason} href={guard.href} amount={guard.amount} />
            </div>
          ) : (
            <>
              <span className="text-xs text-kc-muted">Status rechecked at send</span>
              <Button size="lg" disabled={drafting || issues.length > 0 || !to} onClick={() => setConfirm(true)}>
                Approve &amp; send
              </Button>
            </>
          )}
        </div>
      </section>

      <Dialog open={confirm} onOpenChange={(o) => !o && !sending && setConfirm(false)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve this email to {customerName}?</DialogTitle>
            <DialogDescription>
              {demoMode
                ? "Demo mode — the message is logged as approved and will not be sent."
                : "The email is sent from Tony's address as soon as you confirm."}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-kc-input bg-kc-bg p-3 text-[13px]">
            <dt className="text-kc-muted">To</dt>
            <dd>{to}</dd>
            <dt className="text-kc-muted">Subject</dt>
            <dd>{subject}</dd>
            <dt className="text-kc-muted">Tone</dt>
            <dd className="capitalize">{tone}</dd>
            <dt className="text-kc-muted">Pay link</dt>
            <dd>{body.includes("[PAY LINK]") ? "Included" : "None"}</dd>
          </dl>
          {sendError && (
            <p role="alert" className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">
              {sendError}{" "}
              <button type="button" className="font-semibold underline" onClick={() => router.refresh()}>
                Reload
              </button>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={sending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={sending} onClick={send}>
              {sending ? "Approving…" : demoMode ? "Approve (demo — don't send)" : "Approve & send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
