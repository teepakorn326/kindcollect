import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, Info, Receipt } from "lucide-react";
import type { EvidenceType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { EvidenceCard } from "@/components/domain/EvidenceCard";
import { SuggestionPanel } from "@/components/domain/SuggestionPanel";
import { AuditTimeline } from "@/components/domain/AuditTimeline";
import { SourceDialog } from "@/components/domain/SourceDialog";
import { CreditNotePanel } from "@/components/queue/CreditNotePanel";
import { PlanPanel } from "@/components/queue/PlanPanel";
import { CaseAiTools } from "@/components/queue/CaseAiTools";
import { PENDING_REPLIES } from "@/lib/demo/seed";
import { proposePaymentPlan } from "@/lib/rules";
import { followupKey, getCaseDetail, paymentKey } from "@/lib/cases";
import { formatAud } from "@/lib/money";
import { formatDate, formatDateTime, formatDay, formatDays, formatTime, toDateInput } from "@/lib/format";
import { caseStatus, causeHint, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

const sourcePhrase: Record<EvidenceType, string> = {
  email: "the customer's reply",
  returns: "the returns log",
  bank: "the bank feed",
  history: "payment history",
  call: "the call",
  document: "the invoice documents",
};

const proposedFixCopy: Record<string, string> = {
  invoice_issue_ours: "Issue a credit note for the returned goods, then send the corrected invoice with a new due date.",
};

function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase", className)}>{children}</h2>;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export async function generateMetadata({ params }: { params: Promise<{ caseId: string }> }) {
  const d = await getCaseDetail((await params).caseId);
  return { title: d ? `Case ${d.c.number} — ${d.c.customer.name}` : "Case not found" };
}

export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const detail = await getCaseDetail((await params).caseId);
  if (!detail) notFound();
  const { c, ctx, invoiceMessages, asOf, daysOverdue, action } = detail;
  const inv = c.invoice;

  // newest first: the customer's latest words lead
  const cards = c.evidence.filter((e) => e.type !== "document").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const documents = c.evidence.filter((e) => e.type === "document");
  const sources = [...new Set(cards.map((e) => sourcePhrase[e.type]))];
  const counts = [
    plural(c.evidence.filter((e) => e.type === "email").length, "message"),
    plural(c.evidence.filter((e) => e.type === "returns").length, "returns record"),
    plural(c.evidence.filter((e) => e.type === "bank").length, "bank line"),
    plural(c.evidence.filter((e) => e.type === "history").length, "history record"),
    plural(documents.length, "document"),
  ].filter((s) => !s.startsWith("0 "));

  const openReturns = inv.returns.filter((r) => !r.creditNote);
  const issuedNotes = inv.creditNotes;
  const creditedCents = issuedNotes.reduce((s, n) => s + n.amountCents, 0);
  const rejected = c.diagnosisConfirmed === false;
  const awaiting =
    c.status === "needs_approval"
      ? { label: `Awaiting ${c.whoActs.startsWith("tony") ? "Tony" : "Sarah"}'s approval`, sub: "Now" }
      : c.status === "needs_review"
        ? { label: "Awaiting review", sub: "Now" }
        : undefined;
  const pendingReply = Object.entries(PENDING_REPLIES).find(([, r]) => r.caseId === c.id && !c.messages.some((m) => m.id === r.id));
  const plan = c.paymentPlans.filter((p) => p.status !== "rejected").at(-1) ?? null;
  const planRows = (rows: { sequence: number; dueDate: Date; amountCents: number }[]) =>
    rows.map((i) => ({ sequence: i.sequence, label: formatDay(i.dueDate), amount: formatAud(i.amountCents, { cents: false }) }));
  const defaultDue = toDateInput(new Date(asOf.getTime() + c.customer.termsDays * 86_400_000));

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href="/queue" className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          Action Queue
        </Link>
        <span>/</span>
        <span>Case {c.number}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 lg:flex-nowrap">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">
              {inv.number} · {c.customer.name}
            </h1>
            <MoneyValue cents={inv.balanceCents} className="text-[22px] font-semibold" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="payment" value={paymentKey(inv, asOf)} prefix="Payment" />
            <StatusBadge kind="cause" value={c.cause} prefix="Cause" long />
            <StatusBadge kind="followup" value={followupKey(c)} prefix="Reminders" />
            {c.status !== "needs_approval" && (
              <span className={cn("inline-flex rounded-kc-badge px-2.5 py-1 text-xs font-semibold", toneClasses[caseStatus[c.status].tone].badge)}>
                {caseStatus[c.status].label}
              </span>
            )}
            <span className="text-xs text-kc-muted">
              Due {formatDay(inv.dueDate)} · {daysOverdue > 0 ? `${formatDays(daysOverdue)} overdue` : daysOverdue === 0 ? "due today" : `due in ${formatDays(-daysOverdue)}`} ·{" "}
              {c.customer.termsDays}-day terms
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" size="md">
            <Link href={`/customers/${c.customerId}`}>View customer</Link>
          </Button>
          <SourceDialog asButton trigger="Open invoice" title={`${inv.number} · ${c.customer.name}`} description={`Issued ${formatDate(inv.issueDate)} · due ${formatDate(inv.dueDate)}${inv.poNumber ? ` · PO ${inv.poNumber}` : ""}`}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-kc-muted">
                  <th className="py-1 font-medium">Description</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Unit</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id} className="border-t border-kc-border">
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatAud(l.unitPriceCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatAud(l.amountCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-kc-border font-semibold">
                  <td className="py-1.5" colSpan={3}>
                    Total (GST-free)
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatAud(inv.totalCents)}</td>
                </tr>
                {issuedNotes.map((n) => (
                  <tr key={n.id}>
                    <td className="py-1.5" colSpan={3}>
                      Credit note {n.number}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">−{formatAud(n.amountCents)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5" colSpan={3}>
                    Balance
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatAud(inv.balanceCents)}</td>
                </tr>
              </tbody>
            </table>
          </SourceDialog>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-5 rounded-kc-card border border-kc-border bg-kc-surface p-6 shadow-kc-card">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <H2>Diagnosis</H2>
              {rejected && (
                <span className={cn("rounded-kc-badge px-2 py-0.5 text-[11px] font-semibold", toneClasses.review.badge)}>
                  Needs review
                </span>
              )}
            </div>
            <p className={cn("text-[15px]", rejected && "text-kc-muted line-through decoration-kc-muted/50")}>{c.summary}</p>
            <div className="flex items-center gap-2 text-xs text-kc-muted">
              <Info className="size-3.5 shrink-0" aria-hidden />
              <span>
                {rejected
                  ? "Marked as not a valid return — the suggested diagnosis is set aside until someone reviews the case."
                  : `Suggested from ${sources.join(" and ")} · ${causeHint[c.cause]}`}
              </span>
            </div>
            <CaseAiTools
              caseId={c.id}
              simulate={pendingReply ? { customer: pendingReply[0], label: `Demo: simulate a reply from ${pendingReply[1].fromName.split(" ")[0]}` } : undefined}
            />
          </div>

          {!rejected && c.cause === "invoice_issue_ours" && openReturns.length > 0 && (
            <CreditNotePanel
              caseId={c.id}
              customerName={c.customer.name}
              invoice={{ number: inv.number, balanceCents: inv.balanceCents, updatedAt: inv.updatedAt.toISOString() }}
              returns={openReturns.map((r) => ({
                id: r.id,
                number: r.number,
                product: r.product,
                quantity: r.quantity,
                unitPriceCents: r.unitPriceCents,
              }))}
              gstFree={ctx.gstFree}
              termsDays={c.customer.termsDays}
              defaultDueDate={defaultDue}
              caseUpdatedAt={c.updatedAt.toISOString()}
              body={proposedFixCopy.invoice_issue_ours}
              evidenceIds={cards.map((e) => e.id)}
            />
          )}

          {issuedNotes.length > 0 && (
            <div className="flex flex-col gap-3 rounded-[10px] border border-kc-status-success/30 bg-kc-status-success-bg/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-kc-status-success">
                <CheckCircle2 className="size-4" aria-hidden />
                Credit note approved
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-kc-input border border-kc-border bg-kc-surface px-3.5 py-3 text-[13px]">
                {issuedNotes.map((n) => (
                  <div key={n.id}>
                    <div className="text-kc-muted">{n.number}</div>
                    <div className="font-semibold tabular-nums">{formatAud(n.amountCents)}</div>
                    <div className="text-xs text-kc-muted">
                      {n.approvedBy} · {formatDateTime(n.approvedAt)}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="text-kc-muted">Corrected balance</div>
                  <div className="font-semibold tabular-nums">
                    {formatAud(inv.balanceCents + creditedCents)} → {formatAud(inv.balanceCents)}
                  </div>
                </div>
                <div>
                  <div className="text-kc-muted">New due date</div>
                  <div className="font-medium">{formatDate(inv.dueDate)}</div>
                </div>
                <div>
                  <div className="text-kc-muted">Reminders</div>
                  <div className="font-medium">{c.remindersPaused ? "Paused" : "Active"}</div>
                </div>
              </div>
              <p className="text-xs text-kc-muted">
                Corrected invoice drafted for review. Nothing has been sent to {c.customer.name}.
              </p>
            </div>
          )}

          {!rejected && c.cause === "cash_flow" && inv.balanceCents > 0 && (
            <PlanPanel
              caseId={c.id}
              customerName={c.customer.name}
              balanceCents={inv.balanceCents}
              balance={formatAud(inv.balanceCents, { cents: false })}
              plan={plan ? { id: plan.id, status: plan.status, instalments: planRows(plan.instalments) } : null}
              preview={planRows(proposePaymentPlan(inv.balanceCents, asOf))}
            />
          )}

          {!rejected && c.cause !== "invoice_issue_ours" && c.cause !== "cash_flow" && (
            <SuggestionPanel
              id="fix"
              title="Proposed fix"
              body={action.label}
              confidence={c.confidence}
              evidenceIds={cards.map((e) => e.id)}
            >
              <p className="text-[13px] text-kc-muted">{action.detail}</p>
              <div>
                <Button asChild size="lg">
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              </div>
            </SuggestionPanel>
          )}

          <div className="flex flex-col gap-2">
            <H2>Invoice facts</H2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
              <div>
                <dt className="text-kc-muted">Issued</dt>
                <dd className="font-medium">{formatDate(inv.issueDate)}</dd>
              </div>
              <div>
                <dt className="text-kc-muted">Due</dt>
                <dd className="font-medium">{formatDate(inv.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-kc-muted">Billing contact</dt>
                <dd className="font-medium">
                  {c.customer.contactName}
                  {c.customer.contactRole && c.customer.contactRole !== "AP" ? `, ${c.customer.contactRole.toLowerCase()}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-kc-muted">Lines</dt>
                <dd className="font-medium">
                  {inv.lines
                    .map((l) => `${l.quantity} × ${l.description.split(" — ")[0].toLowerCase()} ${formatAud(l.unitPriceCents, { cents: false })}`)
                    .join(" · ")}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="flex flex-col gap-5 rounded-kc-card border border-kc-border bg-kc-surface p-6 shadow-kc-card">
          <div className="flex items-center justify-between">
            <H2>Source evidence</H2>
            <span className="text-xs text-kc-muted">{counts.join(" · ")}</span>
          </div>

          {cards.map((e) => {
            const meta =
              e.type === "email" && e.message
                ? `${e.message.fromName} · ${formatDateTime(e.occurredAt)}`
                : e.type === "returns" && e.return
                  ? `${e.return.source} · ${formatDateTime(e.occurredAt)}`
                  : e.type === "bank"
                    ? `Bank feed · ${formatDay(e.occurredAt)}`
                    : `As of ${formatTime(e.occurredAt)} today`;
            return (
              <EvidenceCard key={e.id} evidence={e} meta={meta}>
                {e.type === "email" && e.message && (
                  <>
                    <SourceDialog trigger="View original" title={e.message.subject} description={`From ${e.message.fromName} <${e.message.fromEmail}> · ${formatDateTime(e.message.occurredAt)}`}>
                      <p className="whitespace-pre-line">{e.message.body}</p>
                    </SourceDialog>
                    <SourceDialog muted trigger={`Open thread (${invoiceMessages.length})`} title={`Thread · ${inv.number}`}>
                      <ol className="flex flex-col gap-3">
                        {invoiceMessages.map((m) => (
                          <li key={m.id} className="rounded-kc-input border border-kc-border p-3">
                            <div className="mb-1 text-xs text-kc-muted">
                              {m.direction === "inbound" ? m.fromName : "Tony"} · {formatDateTime(m.occurredAt)} · {m.status}
                            </div>
                            <div className="font-medium">{m.subject}</div>
                            <p className="mt-1 whitespace-pre-line">{m.body}</p>
                          </li>
                        ))}
                      </ol>
                    </SourceDialog>
                  </>
                )}
                {e.type === "returns" && e.return && (
                  <SourceDialog trigger="Open record" title={`Return ${e.return.number}`} description={`${e.return.source} · ${formatDateTime(e.return.date)}`}>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                      <dt className="text-kc-muted">Customer</dt>
                      <dd>{c.customer.name}</dd>
                      <dt className="text-kc-muted">Invoice</dt>
                      <dd>{inv.number}</dd>
                      <dt className="text-kc-muted">Product</dt>
                      <dd>{e.return.product}</dd>
                      <dt className="text-kc-muted">Quantity</dt>
                      <dd>{e.return.quantity} boxes</dd>
                      <dt className="text-kc-muted">Unit price</dt>
                      <dd className="tabular-nums">{formatAud(e.return.unitPriceCents)}</dd>
                      <dt className="text-kc-muted">Reason</dt>
                      <dd>{e.return.reason}</dd>
                      <dt className="text-kc-muted">Signed</dt>
                      <dd>
                        {e.return.signedBy} · Driver: {e.return.driver}
                      </dd>
                    </dl>
                  </SourceDialog>
                )}
                {e.type === "bank" && e.paymentId && (
                  <Link href={`/payments/${e.paymentId}/review`} className="font-semibold">
                    Open bank line
                  </Link>
                )}
              </EvidenceCard>
            );
          })}

          {(documents.length > 0 || inv.returns.length > 0) && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold">Related documents</h3>
              <ul className="flex flex-col gap-1.5">
                {documents.map((d) => (
                  <li key={d.id} id={d.id} className="flex items-center gap-2.5 rounded-kc-input border border-kc-border px-2.5 py-2 text-[13px]">
                    <FileText className="size-4 text-kc-muted" aria-hidden />
                    <span className="flex-1">{d.title}</span>
                    <span className="text-xs text-kc-muted">{d.excerpt.replace(/^Delivery note · /, "")}</span>
                  </li>
                ))}
                {inv.returns.map((r) =>
                  r.creditNote ? (
                    <li key={r.id} className={cn("flex items-center gap-2.5 rounded-kc-input border border-kc-status-success/30 px-2.5 py-2 text-[13px]", toneClasses.success.badge)}>
                      <Receipt className="size-4" aria-hidden />
                      <span className="flex-1 font-medium">
                        Credit note {r.creditNote.number} · {formatAud(r.creditNote.amountCents)} for {r.number}
                      </span>
                    </li>
                  ) : (
                    <li key={r.id} className={cn("flex items-center gap-2.5 rounded-kc-input border border-dashed border-kc-status-info/40 px-2.5 py-2 text-[13px]", toneClasses.info.badge)}>
                      <Receipt className="size-4" aria-hidden />
                      <span className="flex-1 font-medium">Credit note — none issued for {r.number}</span>
                    </li>
                  )
                )}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <section className="flex flex-col gap-3.5 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
        <H2>Activity timeline</H2>
        <AuditTimeline events={c.auditEvents} pending={awaiting} />
      </section>
    </>
  );
}
