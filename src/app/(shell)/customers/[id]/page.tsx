import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { TermsPanel } from "@/components/customers/TermsPanel";
import { getCustomerAccount } from "@/lib/customers";
import { daysOverdue } from "@/lib/clock";
import { formatAud } from "@/lib/money";
import { formatDay, formatDate, formatDays } from "@/lib/format";
import { caseStatus, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await getCustomerAccount((await params).id);
  return { title: a ? `${a.c.name} — KindCollect` : "Customer not found" };
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">{children}</h2>;
}

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const a = await getCustomerAccount((await params).id);
  if (!a) notFound();
  const { created } = await searchParams;
  const { c, history, asOf } = a;
  const initials = c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const call = c.calls[0];
  const openTask = c.tasks.find((t) => t.status === "open");
  const outbound = c.messages.filter((m) => m.direction === "outbound" && m.status === "sent");
  const lastUnanswered = outbound[0];

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href="/customers" className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          Customers
        </Link>
        <span>/</span>
        <span>{c.name}</span>
      </nav>

      {created && (
        <div role="status" className={cn("flex items-center gap-2 rounded-[10px] px-4 py-3 text-[13px]", toneClasses.success.badge)}>
          <CheckCircle2 className="size-4" aria-hidden />
          {created} created and logged. See it in the Invoices tab below.
        </div>
      )}

      <section className="flex flex-wrap items-start justify-between gap-6 rounded-kc-card border border-kc-border bg-kc-surface p-6 shadow-kc-card">
        <div className="flex items-start gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-kc-primary-soft font-semibold text-kc-primary">{initials}</div>
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] font-bold tracking-[-0.02em]">{c.name}</h1>
            <p className="text-[13px] text-kc-muted">
              {c.contactName} · {c.email}
              {c.phone && ` · ${c.phone}`}
              {c.requiresPo && " · Requires PO number on every invoice"}
            </p>
            <p className="text-[13px] text-kc-muted">
              Terms: {c.termsDays} days
              {c.deliveryDays && ` · Delivers ${c.deliveryDays}`} · Customer since {formatDate(c.customerSince).replace(/^\d+ /, "")}
              {a.monthlyCents > 0 && ` · ~${formatAud(a.monthlyCents, { cents: false })} a month`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-6 text-[13px]">
          <div>
            <div className="text-xs text-kc-muted">Outstanding</div>
            <MoneyValue cents={a.outstandingCents} className="text-lg font-bold" />
            <div className="text-xs text-kc-muted">{a.openCount} open invoices</div>
          </div>
          <div>
            <div className="text-xs text-kc-muted">Overdue</div>
            <MoneyValue cents={a.overdueCents} className={cn("text-lg font-bold", a.overdueCents > 0 && "text-kc-status-error")} />
            <div className="text-xs text-kc-muted">
              {a.oldestOverdue ? `${a.oldestOverdue.number} · ${formatDays(daysOverdue(a.oldestOverdue.dueDate, asOf))}` : "Nothing overdue"}
            </div>
          </div>
          <div>
            <div className="text-xs text-kc-muted">Latest activity</div>
            <div className="font-semibold">{a.latest?.summary ?? "—"}</div>
            <div className="text-xs text-kc-muted">{a.latest ? formatDay(a.latest.at) : ""}</div>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2">
          <Button asChild size="md">
            <Link href={`/invoices/new?customer=${c.id}`}>
              <Plus className="size-4" aria-hidden /> New invoice
            </Link>
          </Button>
          {call && (
            <Button asChild size="md" variant="outline">
              <Link href={`/calls/${call.id}`}>
                <Phone className="size-4" aria-hidden /> Call AP with KindCollect
              </Link>
            </Button>
          )}
          <Button size="md" variant="outline" disabled title="Customer details are edited by Tony">
            Edit customer
          </Button>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_1fr]">
        <div className="flex flex-col gap-5">
          {a.termsOptions.length > 0 && (
            <TermsPanel
              customerId={c.id}
              customerName={c.name}
              options={a.termsOptions}
              openTask={openTask?.title ?? null}
              rationale={`Another reminder is unlikely to change a pattern of ${history.invoicesCompleted} invoices paid a median ${history.medianDaysLate} days late. The lever that works with a large customer is the terms, not the tone.`}
            />
          )}

          <section className="overflow-hidden rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
            <Tabs defaultValue="invoices">
              <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-kc-border bg-transparent px-4 pt-2 pb-0">
                {[
                  ["invoices", "Invoices", c.invoices.length],
                  ["payments", "Payments", c.payments.filter((p) => p.amountCents > 0).length],
                  ["cases", "Cases", c.cases.length],
                  ["communication", "Communication", c.messages.length],
                  ["documents", "Documents", c.documents.length + a.evidenceDocs.length],
                ].map(([v, label, n]) => (
                  <TabsTrigger
                    key={v}
                    value={String(v)}
                    className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-3 data-[state=active]:border-kc-primary data-[state=active]:text-kc-primary data-[state=active]:shadow-none"
                  >
                    {label} <span className="ml-1 text-kc-muted">{n}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="invoices" className="m-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-kc-muted">
                      <th className="px-5 py-2.5 font-medium">Invoice</th>
                      <th className="px-3 py-2.5 font-medium">PO</th>
                      <th className="px-3 py-2.5 font-medium">Due</th>
                      <th className="px-3 py-2.5 font-medium">Paid</th>
                      <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.invoices.map((i) => {
                      const od = daysOverdue(i.dueDate, asOf);
                      const late = i.paidAt ? Math.max(0, daysOverdue(i.dueDate, i.paidAt)) : 0;
                      return (
                        <tr key={i.id} className="border-t border-kc-border">
                          <td className="px-5 py-2.5 font-medium">{i.number}</td>
                          <td className={cn("px-3 py-2.5", !i.poNumber && c.requiresPo ? "text-kc-status-error" : "text-kc-muted")}>
                            {i.poNumber ?? (c.requiresPo ? "missing" : "—")}
                          </td>
                          <td className="px-3 py-2.5">{formatDay(i.dueDate)}</td>
                          <td className="px-3 py-2.5 text-kc-muted">{i.paidAt ? `${formatDay(i.paidAt)}${late ? ` (+${late})` : ""}` : "—"}</td>
                          <td className="px-3 py-2.5 text-right">
                            <MoneyValue cents={i.totalCents} />
                          </td>
                          <td className="px-5 py-2.5">
                            {i.status === "paid" ? (
                              <span className="inline-flex gap-1">
                                <StatusBadge kind="payment" value="paid" />
                                {i.rejectedForMissingPo && <span className="text-xs text-kc-muted">reissued with PO</span>}
                              </span>
                            ) : i.status === "draft" ? (
                              <StatusBadge kind="payment" value="draft" />
                            ) : od > 0 ? (
                              <span className={cn("inline-flex rounded-kc-badge px-2.5 py-[3px] text-xs font-semibold", toneClasses.error.badge)}>
                                {formatDays(od)} overdue
                              </span>
                            ) : (
                              <StatusBadge kind="payment" value="not_due" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="payments" className="m-0">
                <ul className="divide-y divide-kc-border text-[13px]">
                  {c.payments
                    .filter((p) => p.amountCents > 0)
                    .map((p) => (
                      <li key={p.id} className="flex justify-between gap-4 px-5 py-2.5">
                        <span>
                          {formatDay(p.date)} · <span className="font-mono text-xs">{p.description}</span>
                        </span>
                        <span className="tabular-nums">
                          {formatAud(p.amountCents)} · <span className="text-kc-muted">{p.status === "allocated" ? "matched" : "in suspense"}</span>
                        </span>
                      </li>
                    ))}
                </ul>
              </TabsContent>

              <TabsContent value="cases" className="m-0">
                <ul className="divide-y divide-kc-border text-[13px]">
                  {c.cases.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                      <Link href={`/queue/${k.id}`} className="font-semibold">
                        {k.number} · {k.invoice.number}
                      </Link>
                      <span className="flex items-center gap-2">
                        <StatusBadge kind="cause" value={k.cause} />
                        <span className={cn("rounded-kc-badge px-2 py-0.5 text-xs font-semibold", toneClasses[caseStatus[k.status].tone].badge)}>{caseStatus[k.status].label}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="communication" className="m-0">
                <ul className="divide-y divide-kc-border text-[13px]">
                  {c.messages.map((m) => (
                    <li key={m.id} className="flex justify-between gap-4 px-5 py-2.5">
                      <span>
                        <span className="font-medium">{m.subject}</span>{" "}
                        <span className="text-kc-muted">
                          · {m.direction === "inbound" ? `from ${m.fromName}` : `${m.status}${m.tone ? ` · ${m.tone}` : ""}${m.demoOnly ? " · demo, not sent" : ""}`}
                        </span>
                      </span>
                      <span className="text-kc-muted">{formatDay(m.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="documents" className="m-0">
                <ul className="divide-y divide-kc-border text-[13px]">
                  {c.documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 px-5 py-2.5">
                      <FileText className="size-4 text-kc-muted" aria-hidden />
                      <span className="flex-1">{d.fileName}</span>
                      <span className="text-xs text-kc-muted">
                        {d.kind === "purchase_order" ? "Purchase order" : "Delivery note"} · {formatDay(d.date)}
                      </span>
                    </li>
                  ))}
                  {a.evidenceDocs.map((d) => (
                    <li key={d.id} className="flex items-center gap-2.5 px-5 py-2.5">
                      <FileText className="size-4 text-kc-muted" aria-hidden />
                      <span className="flex-1">{d.title}</span>
                      <span className="text-xs text-kc-muted">{d.excerpt.split("\n")[0]}</span>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
            <div className="flex items-center justify-between">
              <H2>Payment history</H2>
              <span className="text-xs text-kc-muted">Descriptive only</span>
            </div>
            <dl className="flex flex-col gap-2 text-[13px]">
              {[
                ["Invoices completed", history.invoicesCompleted],
                ["Paid on time", `${history.paidOnTime} of ${history.invoicesCompleted}`],
                ["Median days late", history.medianDaysLate],
                ["Rejected for missing PO", history.rejectedForMissingPo],
                ["Active disputes", history.activeDisputes],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between">
                  <dt className="text-kc-muted">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-kc-border pt-2 text-xs text-kc-muted">
              {history.invoicesCompleted} completed invoices{history.customerSince ? ` since ${formatDate(new Date(`${history.customerSince}-15T12:00:00+10:00`)).replace(/^\d+ /, "")}` : ""}. These are facts about payments, not a judgement about the customer.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
            <H2>Recent communication</H2>
            <ul className="flex flex-col gap-2.5 text-[13px]">
              {c.messages.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <div className="font-medium">{m.subject}</div>
                  <div className="text-xs text-kc-muted">
                    {m.direction === "inbound" ? `From ${m.fromName}` : `Sent`} · {formatDay(m.occurredAt)}
                    {m.tone && ` · ${m.tone} tone`}
                    {m.direction === "outbound" && m === lastUnanswered && !c.messages.some((x) => x.direction === "inbound" && x.occurredAt > m.occurredAt) && " · no reply"}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {openTask && (
            <section className="flex flex-col gap-1.5 rounded-kc-card border border-kc-status-review/40 bg-kc-status-review-bg/40 px-6 py-4 text-[13px]">
              <H2>Waiting for Tony</H2>
              <div className="font-medium">{openTask.title}</div>
              {openTask.detail && <div className="text-xs text-kc-muted">{openTask.detail}</div>}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
