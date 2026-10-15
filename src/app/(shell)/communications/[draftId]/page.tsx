import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, MonitorPause } from "lucide-react";
import { EmailComposer } from "@/components/communications/EmailComposer";
import { getDraftContext } from "@/lib/communications";
import { formatAud } from "@/lib/money";
import { formatDateTime, formatDays } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

const isDemoMode = () => (process.env.DEMO_MODE ?? "true") !== "false";
const short = (name: string) => name.replace(/\s+(Co\.?|Pty\.? Ltd\.?)$/i, "");

export async function generateMetadata({ params }: { params: Promise<{ draftId: string }> }) {
  const ctx = await getDraftContext((await params).draftId);
  return { title: ctx ? `Email — ${ctx.m.customer.name}` : "Draft not found" };
}

export default async function EmailApprovalPage({ params }: { params: Promise<{ draftId: string }> }) {
  const ctx = await getDraftContext((await params).draftId);
  if (!ctx) notFound();
  const { m, inv, facts, guard, overdue, recommended, why, allowedCents, pastOutbound, blockedOthers, unmatched } = ctx;
  const demo = isDemoMode();
  const tone = m.tone ?? recommended;
  const kind = tone === "warm" ? "nudge" : "reminder";
  const firstContact = pastOutbound === 0;

  const guardProp = guard.blocked
    ? guard.reason === "unmatched_payment"
      ? { blocked: true as const, reason: guard.reason, href: `/payments/${guard.paymentId}/review`, amount: formatAud(guard.amountCents, { cents: false }) }
      : { blocked: true as const, reason: guard.reason, href: `/queue/${guard.caseId}` }
    : { blocked: false as const };

  // Live counter-example: another customer whose held reminder is blocked right now
  const other = blockedOthers[0];
  const asideExtra =
    other && other.g.blocked ? (
      <div className="flex flex-col gap-2 rounded-kc-card border border-kc-status-error/25 bg-kc-status-error-bg/50 px-5 py-4">
        <div className="flex items-center gap-2 font-semibold text-kc-status-error">
          <AlertTriangle className="size-4" aria-hidden />
          What {short(other.h.customer.name)} would see instead
        </div>
        <p className="text-[13px]">
          For their held reminder the Approve button is replaced, because{" "}
          {other.g.reason === "unmatched_payment" ? "a matching payment is already in the bank" : "they have an open dispute"}:
        </p>
        <div className="rounded-kc-input border border-kc-status-error/25 bg-kc-surface px-3.5 py-3 text-[13px]">
          <div className="font-semibold">Sending paused</div>
          <div className="text-kc-muted">
            {other.g.reason === "unmatched_payment"
              ? `A ${formatAud(other.g.amountCents, { cents: false })} receipt from this customer is waiting to be matched. Match it before sending any reminder.`
              : "This customer has an open dispute. Resolve it before sending any reminder."}
          </div>
          <Link href={`/communications/${other.h.id}`} className="mt-2 inline-block font-semibold">
            Open their reminder
          </Link>
        </div>
      </div>
    ) : null;

  const header = (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href="/queue" className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          Action Queue
        </Link>
        <span>/</span>
        <span>
          {inv.number} · {tone === "warm" ? "Friendly nudge" : m.subject}
        </span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">
            {m.status === "draft"
              ? `Approve the ${kind} to ${m.customer.name}`
              : m.status === "held"
                ? `Held reminder to ${m.customer.name}`
                : m.status === "sent"
                  ? `${kind[0].toUpperCase()}${kind.slice(1)} approved for ${m.customer.name}`
                  : `Cancelled reminder to ${m.customer.name}`}
          </h1>
          <p className="mt-1 text-[13px] text-kc-muted">
            {inv.number} · {formatAud(inv.balanceCents)} · {overdue > 0 ? `${formatDays(overdue)} overdue` : "not overdue"} ·{" "}
            {firstContact ? "First contact" : `${pastOutbound} earlier reminder${pastOutbound > 1 ? "s" : ""}`} · Tone: {tone}
            {m.case?.cause === "probably_forgot" && " — loyal customer who probably forgot"}
          </p>
        </div>
        {demo && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-kc-badge px-3 py-1.5 text-xs font-semibold", toneClasses.neutral.badge)}>
            <MonitorPause className="size-4" aria-hidden />
            Demo mode — message will not be sent
          </span>
        )}
      </div>
    </>
  );

  if (m.status === "sent" || m.status === "cancelled") {
    return (
      <>
        {header}
        <section className="flex flex-col gap-3 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
          <div className={cn("flex items-center gap-2 text-sm font-semibold", m.status === "sent" ? "text-kc-status-success" : "text-kc-muted")}>
            <CheckCircle2 className="size-4" aria-hidden />
            {m.status === "sent"
              ? m.demoOnly
                ? `Approved by ${m.approvedBy} at ${formatDateTime(m.occurredAt)} — logged, not sent (demo mode)`
                : `Approved by ${m.approvedBy} and sent ${formatDateTime(m.occurredAt)}`
              : "This reminder was cancelled — the customer had already paid."}
          </div>
          <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-kc-muted">To</dt>
            <dd>{m.toEmail}</dd>
            <dt className="text-kc-muted">Subject</dt>
            <dd className="font-medium">{m.subject}</dd>
          </dl>
          <pre className="rounded-kc-input bg-kc-bg p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{m.body}</pre>
          <Link href={m.caseId ? `/queue/${m.caseId}` : "/queue"} className="text-sm font-semibold">
            Back to the case
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      {m.status === "held" && (
        <div role="status" className={cn("rounded-[10px] px-4 py-3 text-[13px]", toneClasses.success.badge)}>
          <span className="font-semibold">Held automatically</span> at {formatDateTime(m.occurredAt)} —{" "}
          {unmatched.length ? "a receipt from this customer matches an open invoice." : "a rule paused it."}
        </div>
      )}
      <EmailComposer
        draftId={m.id}
        from={m.fromName}
        initial={{ to: m.toEmail, subject: m.subject, body: m.body, tone, factsUsed: null }}
        recommended={recommended}
        why={why}
        facts={facts}
        allowedCents={allowedCents}
        invoiceNumber={inv.number}
        payLinkLabel={m.customer.payLinkEnabled ? `Pay link · ${formatAud(inv.balanceCents)}` : null}
        guard={m.status === "held" && !guard.blocked ? { blocked: false } : guardProp}
        demoMode={demo}
        updatedAt={m.updatedAt.toISOString()}
        customerName={m.customer.name}
        asideExtra={asideExtra}
      />
    </>
  );
}
