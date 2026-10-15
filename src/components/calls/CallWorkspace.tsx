"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Phone, PlayCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CallTranscript, type TranscriptTurn } from "@/components/domain/CallTranscript";
import { toast } from "@/hooks/use-toast";
import { formatDay } from "@/lib/format";
import { dateOnly } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { confirmOutcome, playRecording } from "@/app/(shell)/calls/[callId]/actions";

type Outcome = {
  invoice_received: boolean | null;
  blocker: string | null;
  commitment_date: string | null;
  dispute_raised: boolean;
  confidence: "low" | "medium" | "high";
  quotes: string[];
  cached: boolean;
  source: "live" | "rehearsal";
};
type CallState = {
  status: "draft" | "approved" | "in_progress" | "ended" | "failed";
  transcript: TranscriptTurn[] | null;
  outcome: Outcome | null;
  startedAt: string | null;
  endedAt: string | null;
  recordingUrl: string | null;
  source: string | null;
  outcomeConfirmedAt: string | null;
};

export function CallWorkspace({
  callId,
  initial,
  phone,
  customerLabel,
  guard,
  approvedLine,
}: {
  callId: string;
  initial: CallState;
  phone: string;
  customerLabel: string;
  /** server-side callGuard result for "now" */
  guard: { allowed: boolean; detail?: string };
  approvedLine: string;
}) {
  const router = useRouter();
  const [starting, startStart] = useTransition();
  const [loading, startLoad] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [date, setDate] = useState(initial.outcome?.commitment_date ?? "");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["call-state", callId],
    queryFn: async (): Promise<CallState> => (await fetch(`/api/calls/${callId}/state`, { cache: "no-store" })).json(),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.status === "in_progress" ? 2_000 : false),
  });
  // a fresh server render (router.refresh) carries the latest snapshot — prefer it over the cache
  const snapshot = JSON.stringify(initial);
  useEffect(() => {
    queryClient.setQueryData(["call-state", callId], JSON.parse(snapshot) as CallState);
  }, [snapshot, callId, queryClient]);
  const call = data ?? initial;
  const live = call.status === "in_progress";
  const ended = call.status === "ended";
  const outcome = call.outcome;
  useEffect(() => {
    if (outcome?.commitment_date) setDate(outcome.commitment_date);
  }, [outcome?.commitment_date]);

  // live timer
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  const elapsed = live && call.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000)) : 0;

  const start = () =>
    startStart(async () => {
      setError(null);
      const r = await fetch("/api/calls/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId }) }).then((x) => x.json());
      if (!r.ok) setError(r.error);
      else toast({ title: "Calling Accounts Payable", description: "The transcript appears as they speak." });
      await refetch();
      router.refresh();
    });

  const play = () =>
    startLoad(async () => {
      setError(null);
      const r = await playRecording(callId);
      if (!r.ok) setError(r.error);
      await refetch();
      router.refresh();
    });

  const confirm = () =>
    startConfirm(async () => {
      const r = await confirmOutcome({ callId, commitmentDate: date || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ variant: "success", title: "Outcome confirmed", description: r.note ?? "Case re-diagnosed, reminders paused, task created for Tony." });
      setConfirmOpen(false);
      await refetch();
      router.refresh();
    });

  const commitment = outcome?.commitment_date ? dateOnly(outcome.commitment_date) : null;
  const marks = [outcome?.blocker ?? "", ...(outcome?.quotes ?? [])].filter(Boolean).flatMap((q) => (q.length > 60 ? [] : [q]));
  const proposedCause = outcome ? (outcome.dispute_raised ? "Invoice issue — ours (disputed)" : outcome.blocker ? "Blocked on customer's PO" : "Payment promised") : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-kc-badge bg-kc-status-error-bg px-3 py-1.5 text-xs font-semibold text-kc-status-error">
            <span className="size-2 rounded-full bg-kc-status-error" />
            Live · {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        )}
        {(live || ended) && (
          <span className="inline-flex items-center rounded-kc-badge bg-kc-border/60 px-3 py-1.5 text-xs font-semibold">
            {call.source === "rehearsal" ? "Recorded rehearsal · demo" : "Recorded · caller informed"}
          </span>
        )}
      </div>

      <ol className="grid grid-cols-3 gap-2 text-[13px]">
        {[
          { n: 1, title: "Prepared", sub: approvedLine, done: true, current: false },
          { n: 2, title: "On the call", sub: live ? "Sarah is listening" : ended ? "Call ended" : "Not started", done: ended, current: live },
          { n: 3, title: "Outcome", sub: call.outcomeConfirmedAt ? "Confirmed by Sarah" : "Extracted for your confirmation", done: !!call.outcomeConfirmedAt, current: ended && !call.outcomeConfirmedAt },
        ].map((s) => (
          <li
            key={s.n}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] border bg-kc-surface px-3.5 py-2.5",
              s.current ? "border-kc-primary text-kc-primary" : s.done ? "border-kc-border text-kc-status-success" : "border-kc-border text-kc-muted"
            )}
          >
            <span
              className={cn(
                "inline-flex size-[22px] items-center justify-center rounded-full text-xs font-bold",
                s.current ? "bg-kc-primary text-kc-surface" : s.done ? "bg-kc-status-success-bg" : "bg-kc-border/60"
              )}
            >
              {s.done ? "✓" : s.n}
            </span>
            <span>
              <span className="font-semibold">
                {s.n} · {s.title}
              </span>
              <span className="block text-kc-muted">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <section className="flex flex-col rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
          <div className="flex items-center justify-between border-b border-kc-border px-6 py-4">
            <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">{live ? "Live transcript" : "Transcript"}</h2>
            <span className="text-xs text-kc-muted">Calling {phone} · Accounts Payable</span>
          </div>
          <div className="px-6 py-5">
            <CallTranscript turns={call.transcript ?? []} live={live} customerLabel={customerLabel} marks={marks} />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-b-kc-card border-t border-kc-border bg-kc-bg px-6 py-4">
            {call.recordingUrl && (
              <audio controls src={call.recordingUrl} className="h-10 max-w-full" aria-label="Call recording">
                <a href={call.recordingUrl}>Download recording</a>
              </audio>
            )}
            <div className="flex-1" />
            {call.status === "approved" && (
              <>
                {!guard.allowed && <span className="text-xs text-kc-status-review">{guard.detail}</span>}
                <Button size="lg" disabled={starting || !guard.allowed} onClick={start}>
                  <Phone className="size-4" aria-hidden />
                  {starting ? "Calling…" : "Start call"}
                </Button>
              </>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-kc-card border border-kc-primary-line bg-kc-surface px-6 py-5 shadow-kc-card">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-primary uppercase">What we&apos;ve understood so far</h2>
              <span className="flex items-center gap-1.5">
                {outcome?.cached && <span className="rounded-kc-badge border border-kc-border px-1.5 py-px text-[11px] text-kc-muted">cached</span>}
                <span className="rounded-kc-badge border border-kc-primary-line bg-kc-primary-tint px-2 py-0.5 text-[11px] font-semibold text-kc-primary">
                  {live ? "Suggested · live" : "Suggested"}
                </span>
              </span>
            </div>
            {outcome ? (
              <dl className="flex flex-col gap-2.5 text-[13px]">
                <Row label="Invoice received?">
                  <span className={cn(outcome.invoice_received && "text-kc-status-success")}>
                    {outcome.invoice_received === null ? "Not discussed" : outcome.invoice_received ? "Yes — confirmed by AP" : "No"}
                  </span>
                </Row>
                <Row label="Blocker">{outcome.blocker ?? "None mentioned"}</Row>
                <Row label="Commitment">{commitment ? `Payment run ${formatDayWithWeekday(commitment)}` : "No date given"}</Row>
                <Row label="Dispute?">
                  <span className={cn(outcome.dispute_raised && "text-kc-status-error")}>{outcome.dispute_raised ? "Yes — hand to Sarah" : "None raised"}</span>
                </Row>
                <Row label="Confidence">
                  <span className={cn(outcome.confidence !== "high" && "text-kc-status-review")}>
                    {outcome.confidence[0].toUpperCase() + outcome.confidence.slice(1)}
                    {outcome.confidence !== "high" && commitment && " — relative date resolved"}
                  </span>
                </Row>
              </dl>
            ) : (
              <p className="text-[13px] text-kc-muted">{live ? "Listening… the outcome is extracted when the call ends." : "Nothing yet — start the call or play the rehearsal recording."}</p>
            )}
            {outcome && (
              <div className="rounded-kc-input bg-kc-bg px-3.5 py-3 text-[13px]">
                <div className="mb-1 text-xs text-kc-muted">Proposed case update after the call</div>
                Cause → <strong>{proposedCause}</strong>
                {commitment && <> · Commitment {formatDay(commitment)} · Reminders paused until {formatDay(new Date(commitment.getTime() + 86_400_000))}</>} · Task for Tony:{" "}
                {outcome.blocker ? "ask AP to confirm PO reopened" : "follow up the commitment"}
              </div>
            )}
            {call.outcomeConfirmedAt ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-kc-status-success">
                <CheckCircle2 className="size-4" aria-hidden /> Outcome confirmed — case updated
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="lg" disabled={!ended || !outcome} onClick={() => setConfirmOpen(true)}>
                  Confirm outcome
                </Button>
                <span className="text-xs text-kc-muted">Available when the call ends. Nothing is written until Sarah confirms.</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
            <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Approved script · guardrails</h2>
            <ul className="flex flex-col gap-2 text-[13px]">
              {[
                "Introduces itself as an assistant for Tony — never pretends to be a person",
                "Asks only 3 things: received? blocker? when? — no negotiation, no pressure",
                "Calls 7:30 AM–9:00 PM business days · max 1 call per customer per week (enforced in code)",
                "Ends the call immediately if asked, or if a dispute is raised — hands to Sarah",
                "Every call approved by Tony first · recording + transcript kept in the audit trail",
              ].map((g) => (
                <li key={g} className="flex gap-2.5">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-kc-primary" aria-hidden />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-kc-border pt-2 text-xs text-kc-muted">
              Guardrails follow the ACCC/ASIC debt collection guideline on contact hours, frequency and conduct. Standard TTS voice — not a clone of Tony.
            </p>
          </div>

          {!call.outcomeConfirmedAt && !live && (
            <div className="flex items-center gap-2.5 rounded-[10px] border border-kc-border bg-kc-surface px-4 py-3.5 text-[13px]">
              <PlayCircle className="size-5 shrink-0 text-kc-muted" aria-hidden />
              <div>
                <span className="font-semibold">Demo fallback:</span>
                <span className="text-kc-muted"> play the recorded rehearsal call if the live line is poor. The outcome panel is pre-filled from that recording.</span>
              </div>
              <button type="button" onClick={play} disabled={loading} className="ml-auto cursor-pointer font-semibold whitespace-nowrap text-kc-primary disabled:cursor-wait">
                {loading ? "Loading…" : "Play recording"}
              </button>
            </div>
          )}
        </aside>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && !confirming && setConfirmOpen(false)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm what AP said?</DialogTitle>
            <DialogDescription>Check the date against the transcript. The case is re-diagnosed with the call as evidence and reminders pause until the day after the commitment.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-xs font-medium text-kc-muted">
            Payment commitment
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-sm text-kc-text" />
          </label>
          {outcome?.quotes.length ? (
            <ul className="rounded-kc-input bg-kc-bg p-3 text-[13px] italic">
              {outcome.quotes.map((q) => (
                <li key={q}>“{q}”</li>
              ))}
            </ul>
          ) : null}
          {error && <p className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={confirming} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={confirming} onClick={confirm}>
              {confirming ? "Updating case…" : "Confirm outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-kc-muted">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

const wd = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short" });
function formatDayWithWeekday(d: Date) {
  return `${wd.format(d)} ${formatDay(d)}`;
}
