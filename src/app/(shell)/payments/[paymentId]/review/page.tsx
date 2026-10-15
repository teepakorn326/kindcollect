import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Landmark, PauseCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { AuditTimeline } from "@/components/domain/AuditTimeline";
import { AllocationPanel, type PanelRow } from "@/components/payments/AllocationPanel";
import { StaleBanner } from "@/components/payments/StaleBanner";
import { OwnWriteProvider } from "@/components/payments/OwnWrite";
import { db } from "@/lib/db";
import { getPaymentReview } from "@/lib/payments";
import { formatAmount, formatAud } from "@/lib/money";
import { formatDate, formatDay, formatDays, formatTime } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

const shortName = (name: string) => name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "");

function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase", className)}>{children}</h2>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card", className)}>
      {children}
    </div>
  );
}

/** "INV-1013" with the number part marked */
function MarkedReference({ reference }: { reference: string }) {
  const m = reference.match(/^(.*?)(\d{3,})(.*)$/);
  if (!m) return <>{reference}</>;
  return (
    <>
      {m[1]}
      <mark className="rounded-sm bg-kc-status-review-bg px-0.5 text-kc-text">{m[2]}</mark>
      {m[3]}
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ paymentId: string }> }) {
  const r = await getPaymentReview((await params).paymentId);
  return { title: r ? `Match payment — ${r.payment.customer?.name ?? r.payment.payerName}` : "Payment not found" };
}

export default async function PaymentReviewPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const review = await getPaymentReview((await params).paymentId);
  if (!review) notFound();
  const { payment, match, target, referenced, otherOpen, transposed, statement, heldReminders, allocatedCents, lastSyncedAt, rejection } = review;
  const customer = payment.customer;
  const customerName = customer?.name ?? payment.payerName;
  const remaining = payment.amountCents - allocatedCents;
  const isReceipt = payment.amountCents > 0 && payment.status !== "ignored" && payment.status !== "outgoing";
  const done = payment.allocations.length > 0 && payment.status === "allocated";
  const held = heldReminders.filter((m) => m.status === "held");
  const cancelled = heldReminders.filter((m) => m.status === "cancelled");
  const wrongRef = match.kind === "possible_match" && match.referenceStatus !== "open_invoice";

  // ---------- header ----------
  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href="/queue" className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          Action Queue
        </Link>
        <span>/</span>
        <span>
          Bank receipt {formatDay(payment.date)} · Match payment
        </span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">
            {done ? "Payment matched" : wrongRef ? "Match a payment that used the wrong reference" : "Match a payment"}
          </h1>
          <p className="mt-1 text-[13px] text-kc-muted">
            {customerName} · {formatAud(payment.amountCents)} received
            {done
              ? ` · allocated by ${payment.allocations.map((a) => a.confirmedBy).at(-1)}`
              : rejection
                ? " · Suggested match rejected — receipt stays in suspense"
                : match.kind === "possible_match" && target
                ? ` · Possible match to ${target.number} — confirmation required before the invoice is marked paid`
                : " · No safe match by rule — allocate manually or leave in suspense"}
          </p>
        </div>
        {held.length > 0 && !done && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-kc-badge px-3 py-1.5 text-xs font-semibold", toneClasses.success.badge)}>
            <PauseCircle className="size-4" aria-hidden />
            Reminder held — customer has paid
          </span>
        )}
        {done && cancelled.length > 0 && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-kc-badge px-3 py-1.5 text-xs font-semibold", toneClasses.neutral.badge)}>
            Held reminder cancelled
          </span>
        )}
      </div>
    </>
  );

  // ---------- right column (always) ----------
  const ignored = statement.filter((s) => s.status === "ignored");
  const aside = (
    <aside className="flex flex-col gap-5">
      <Card className="gap-3.5">
        <div className="flex items-center justify-between">
          <H2>Supporting source</H2>
          <Link href="/payments" className="text-xs font-semibold">
            Open full statement
          </Link>
        </div>
        <div className="flex items-center gap-2 text-xs text-kc-muted">
          <Landmark className="size-4" aria-hidden />
          <span className="font-semibold text-kc-text">Bank statement · Fresh Harvest Produce</span>
          {lastSyncedAt && (
            <>
              <span>·</span>
              <span>
                Feed synced {formatDay(lastSyncedAt)} {formatTime(lastSyncedAt)}
              </span>
            </>
          )}
        </div>
        <div className="rounded-kc-input border border-kc-border bg-kc-bg px-5 py-4 font-mono text-xs leading-[1.8] text-kc-text/80">
          <div className="grid grid-cols-[52px_1fr_auto] gap-x-3 gap-y-0.5">
            {statement.map((s) => {
              const hl = s.id === payment.id ? "bg-kc-status-review-bg px-[3px]" : "";
              return (
                <div key={s.id} className="contents" aria-current={s.id === payment.id ? "true" : undefined}>
                  <span className={hl}>{formatDay(s.date)}</span>
                  <span className={hl}>
                    {s.description}
                    {s.status === "outgoing" && s.reference ? ` — ${s.reference}` : ""}
                  </span>
                  <span className={cn("text-right tabular-nums", hl)}>{formatAmount(s.amountCents)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-kc-muted">
          Highlighted line is the receipt being matched.
          {ignored.map((s) => ` The ${shortName(s.payerName).replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} line is a zero-value test transfer and is ignored.`)}
        </p>
      </Card>

      {!done && (
        <Card className="gap-2.5">
          <H2>Checks</H2>
          <ul className="flex flex-col gap-2 text-[13px]">
            {match.checks.map((c) => (
              <li key={c.label} className="flex gap-2.5">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-kc-status-success" aria-label="Pass" />
                ) : c.warn ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-kc-status-review" aria-label="Needs confirmation" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-kc-status-error" aria-label="Fail" />
                )}
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {match.kind === "possible_match" && target && referenced && !done && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-kc-status-error/25 bg-kc-status-error-bg/50 px-4 py-3.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-kc-status-error" aria-hidden />
          <div>
            <span className="font-semibold">What a plain reminder tool would have done today:</span>
            <span className="text-kc-muted">
              {" "}
              {held.length > 0 ? `emailed ${shortName(customerName)} a ${held[0].subject.split(" ")[0].toLowerCase()} reminder for an invoice they already paid` : `chased ${shortName(customerName)} for an invoice they already paid`} —
              or, trusting the reference, credited {referenced.number} and left {target.number} open and chased.
            </span>
          </div>
        </div>
      )}
    </aside>
  );

  // ---------- receipt card ----------
  const receiptCard = (
    <Card>
      <H2>Bank receipt</H2>
      <div className="flex flex-wrap items-baseline gap-3">
        <MoneyValue cents={payment.amountCents} className="text-[30px] font-bold tracking-[-0.02em]" />
        <span className={cn("inline-flex rounded-kc-badge px-2.5 py-[3px] text-xs font-semibold", toneClasses.success.badge)}>
          Cleared · bank feed
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div>
          <dt className="text-kc-muted">Received</dt>
          <dd className="font-medium">{formatDate(payment.date)}</dd>
        </div>
        <div>
          <dt className="text-kc-muted">Reference typed by payer</dt>
          <dd className="font-mono font-medium">{wrongRef ? <MarkedReference reference={payment.reference} /> : payment.reference}</dd>
        </div>
        <div>
          <dt className="text-kc-muted">Payer name</dt>
          <dd className="font-medium">{payment.payerName}</dd>
        </div>
        <div>
          <dt className="text-kc-muted">Currently sitting in</dt>
          <dd className="font-medium">
            {done ? `Allocated to ${payment.allocations.map((a) => a.invoice.number).join(", ")}` : remaining > 0 ? "Unallocated receipts (suspense)" : "—"}
          </dd>
        </div>
      </dl>
    </Card>
  );

  if (!isReceipt) {
    return (
      <>
        {header}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <H2>Not a receipt</H2>
            <p className="text-[13px]">
              {payment.description} · {formatAmount(payment.amountCents)} — {payment.status === "ignored" ? "a zero-value test transfer, ignored by rule." : "money out; nothing to match."}
            </p>
          </Card>
          {aside}
        </div>
      </>
    );
  }

  // ---------- post-action summary (from DB) ----------
  if (done) {
    const events = await db.auditEvent.findMany({
      where: { OR: [{ type: "payment_matched", data: { path: ["paymentId"], equals: payment.id } }, { type: { in: ["reminder_cancelled", "case_resolved"] }, customerId: payment.customerId ?? undefined }] },
      orderBy: { at: "asc" },
    });
    return (
      <>
        {header}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex flex-col gap-5">
            {receiptCard}
            <Card className="gap-3.5 border-kc-status-success/40">
              <div className="flex items-center gap-2 text-sm font-semibold text-kc-status-success">
                <CheckCircle2 className="size-4" aria-hidden />
                Match confirmed
              </div>
              <ul className="flex flex-col gap-2 text-[13px]">
                {payment.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between gap-4 rounded-kc-input border border-kc-border px-3 py-2.5">
                    <span>
                      <span className="font-semibold">{a.invoice.number}</span>{" "}
                      <span className="text-kc-muted">
                        · {formatAud(a.amountCents)} allocated by {a.confirmedBy} at {formatTime(a.confirmedAt)}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      Balance <strong>{formatAud(a.invoice.balanceCents)}</strong>
                      {a.invoice.status === "paid" && <span className="text-kc-status-success"> · Paid</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-kc-muted">Left in suspense</dt>
                <dd className="text-right tabular-nums">{formatAud(remaining)}</dd>
                <dt className="text-kc-muted">Held reminder</dt>
                <dd className="text-right">{cancelled.length ? cancelled.map((m) => `“${m.subject}” cancelled`).join(" · ") : "None"}</dd>
                <dt className="text-kc-muted">Journal</dt>
                <dd className="text-right font-mono text-xs">
                  Dr Suspense {formatAmount(allocatedCents)} · Cr AR – {shortName(customerName)} {formatAmount(allocatedCents)}
                </dd>
                <dt className="text-kc-muted">Sending to {shortName(customerName)}</dt>
                <dd className="text-right">Unblocked — no unmatched receipt</dd>
              </dl>
              <p className="text-xs text-kc-muted">Nothing was sent to {customerName}. A thank-you note is optional and can be drafted from Communications.</p>
              <div className="flex gap-2">
                <Button asChild size="md">
                  <Link href="/queue">Back to Action Queue</Link>
                </Button>
              </div>
            </Card>
            <Card>
              <H2>Audit trail</H2>
              <AuditTimeline events={events} layout="list" relative />
            </Card>
          </section>
          {aside}
        </div>
      </>
    );
  }

  // ---------- proposal ----------
  const rows: PanelRow[] = [];
  const heldFor = (invoiceId: string) => held.find((m) => m.invoiceId === invoiceId)?.subject ?? null;
  if (target) {
    rows.push({
      id: target.id,
      number: target.number,
      outstandingCents: target.balanceCents,
      note: `Issued ${formatDay(target.issueDate)} · due ${formatDay(target.dueDate)}${target.daysOverdue > 0 ? ` · ${formatDays(target.daysOverdue)} overdue` : ""}`,
      proposedCents: match.kind === "possible_match" && !rejection ? match.amountCents : 0,
      heldReminder: heldFor(target.id),
    });
  }
  if (referenced) {
    rows.push({
      id: referenced.id,
      number: referenced.number,
      outstandingCents: referenced.balanceCents,
      note: `The reference they typed${referenced.status === "paid" && referenced.paidAt ? ` · paid in full ${formatDay(referenced.paidAt)}` : ""}${referenced.balanceCents === 0 ? " · nothing outstanding" : ""}`,
      muted: true,
      proposedCents: 0,
    });
  }
  for (const i of otherOpen) {
    rows.push({
      id: i.id,
      number: i.number,
      outstandingCents: i.balanceCents,
      note: `Issued ${formatDay(i.issueDate)} · due ${formatDay(i.dueDate)}${i.daysOverdue > 0 ? ` · ${formatDays(i.daysOverdue)} overdue` : " · not due"}`,
      proposedCents: 0,
      extra: match.kind === "possible_match",
      heldReminder: heldFor(i.id),
    });
  }

  const explanation =
    match.kind === "possible_match" && target
      ? match.referenceStatus === "open_invoice"
        ? `The reference names ${target.number}, and the amount equals its balance.`
        : `“${payment.reference}” is not an open invoice. The payer has exactly one open invoice for exactly this amount${transposed ? ", and the digits are transposed" : ""} — so the match was made by rule, not guessed.`
      : match.kind === "no_match" && match.reason === "ambiguous_amount"
        ? "More than one open invoice equals this amount, so no invoice is suggested. Choose one yourself or leave the receipt in suspense."
        : match.kind === "no_match" && match.reason === "unknown_payer"
          ? "The payer name does not match any customer record. No invoice is suggested."
          : "No open invoice equals this amount. Allocate manually or leave the receipt in suspense.";

  const allInvoices = [target, referenced, ...otherOpen];
  const fingerprint = {
    paymentUpdatedAt: payment.updatedAt.toISOString(),
    invoices: rows.map((r) => {
      const inv = allInvoices.find((i) => i?.id === r.id)!;
      return { id: r.id, number: r.number, balanceCents: inv.balanceCents, updatedAt: inv.updatedAt.toISOString() };
    }),
  };

  return (
    <OwnWriteProvider>
      {header}
      <StaleBanner
        paymentId={payment.id}
        initial={fingerprint}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-5">
          {receiptCard}
          {rejection && (
            <div role="status" className={cn("rounded-[10px] px-4 py-3 text-[13px]", toneClasses.review.badge)}>
              <span className="font-semibold">Marked as not a match</span> by {rejection.actor} at {formatTime(rejection.at)}. The receipt stays in
              suspense and the case is back for review — allocate it manually below, or leave it.
            </div>
          )}
          <AllocationPanel
            payment={{ id: payment.id, remainingCents: remaining, currency: payment.currency }}
            customerName={customerName}
            customerShortName={shortName(customerName)}
            rows={rows}
            explanation={explanation}
            hasProposal={match.kind === "possible_match" && !rejection}
            fingerprint={fingerprint}
          />
        </section>
        {aside}
      </div>
    </OwnWriteProvider>
  );
}
