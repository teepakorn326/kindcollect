import Link from "next/link";
import { Plus } from "lucide-react";
import type { CaseCause } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { ResetDemoButton, SyncBankButton } from "@/components/overview/DemoControls";
import { currentUser, currentBusinessName } from "@/lib/current-user";
import { getOverview } from "@/lib/overview";
import { now } from "@/lib/clock";
import { formatAud } from "@/lib/money";
import { formatDays, formatRelative, formatTime, formatWeekdayDay } from "@/lib/format";
import { auditTone, causeStatus, toneClasses } from "@/lib/status";
import { proposePaymentPlan } from "@/lib/rules";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview — Fresh Harvest Produce" };

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">{children}</h2>;
}

function Kpi({ label, info, value, tone, sub }: { label: string; info: string; value: number; tone?: "review" | "success"; sub: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-kc-card border border-kc-border bg-kc-surface px-5 py-[18px] shadow-kc-card">
      <div className="flex items-center justify-between text-xs font-medium text-kc-muted">
        {label}
        <span
          title={info}
          aria-label={info}
          className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-kc-muted/40 text-[10px]"
        >
          i
        </span>
      </div>
      <MoneyValue
        cents={value}
        showCents={false}
        className={cn("text-[26px] font-bold tracking-[-0.01em]", tone === "review" && "text-kc-status-review", tone === "success" && "text-kc-status-success")}
      />
      <div className="text-xs text-kc-muted">{sub}</div>
    </div>
  );
}

/** Overview-specific wording of the fix (mockup), linking to where it happens. */
function overviewAction(cause: CaseCause, href: string, customerId: string, balanceCents: number, asOf: Date) {
  switch (cause) {
    case "paid_not_matched":
      return { label: "Match payment", href, dontChase: true };
    case "invoice_issue_ours":
      return { label: "Issue credit note", href, dontChase: true };
    case "probably_forgot":
      return { label: "Friendly nudge + pay link", href };
    case "cash_flow":
      return { label: `Offer ${proposePaymentPlan(balanceCents, asOf).length}-instalment plan`, href };
    case "habitual_late":
      return { label: "Final notice + change terms", href: `/customers/${customerId}` };
    case "blocked_on_customer_po":
      return { label: "Wait for PO reopen", href };
    default:
      return { label: "Review diagnosis", href };
  }
}

export default async function OverviewPage() {
  const o = await getOverview();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false }).format(now()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const maxBucket = Math.max(1, o.owedCents);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">
            {greeting}, {currentUser.name}
          </h1>
          <p className="mt-1 text-[13px] text-kc-muted">
            {currentBusinessName} · {formatWeekdayDay(o.asOf)}
            {o.lastSyncedAt && <> · Bank feed synced {formatTime(o.lastSyncedAt)}</>} · {o.overdue.length} invoices overdue
            {o.dontChaseCount > 0 && `, ${o.dontChaseCount} of them should not be chased`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ResetDemoButton />
          <Button asChild size="lg">
            <Link href="/queue">Review today&apos;s {o.openActions} actions</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/invoices/new">
              <Plus className="size-4" aria-hidden />
              New invoice
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Owed to Tony"
          info="Sum of unpaid balances on overdue invoices"
          value={o.owedCents}
          sub={`${o.overdue.length} invoices · ${o.owedCustomers} customers`}
        />
        <Kpi
          label="Actually needs chasing"
          info="Overdue balance minus invoices with a payment already received or an issue on our side"
          value={o.chaseCents}
          tone="review"
          sub={`${o.chaseCustomers} customers · ${formatAud(o.fixCents, { cents: false })} needs a fix, not a reminder`}
        />
        <Kpi
          label="Already paid, not matched"
          info="Bank receipts that likely belong to an open invoice but have not been allocated"
          value={o.unmatchedCents}
          tone="success"
          sub={o.unmatchedNotes.length ? o.unmatchedNotes.join(" · ") : "Nothing waiting in suspense"}
        />
        <Kpi
          label="Expected in next 14 days"
          info="Approved payment plans, payment commitments and corrected invoices with due dates in the next 14 days"
          value={o.expectedCents}
          sub={
            o.expected.length
              ? o.expected.map((e) => `${e.label} ${formatAud(e.cents, { cents: false })}`).join(" · ")
              : "No plans, commitments or corrected invoices due yet"
          }
        />
      </div>

      <section className="overflow-hidden rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
        <div className="flex items-center justify-between border-b border-kc-border px-5 py-4">
          <H2>
            {o.overdue.length} overdue invoices · {new Set(o.overdue.map((r) => r.c.cause)).size} different causes
          </H2>
          <Link href="/queue" className="text-[13px] font-semibold">
            Open Action Queue
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-kc-muted">
                <th className="px-5 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Invoice</th>
                <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                <th className="px-3 py-2.5 font-medium">Overdue</th>
                <th className="px-3 py-2.5 font-medium">Likely cause</th>
                <th className="px-5 py-2.5 font-medium">Suggested action</th>
              </tr>
            </thead>
            <tbody>
              {o.overdue.map(({ c, daysOverdue, action }) => {
                const a = overviewAction(c.cause, action.href, c.customerId, c.invoice.balanceCents, o.asOf);
                return (
                  <tr key={c.id} className="border-t border-kc-border">
                    <td className="px-5 py-3.5 font-medium">{c.customer.name}</td>
                    <td className="px-3 py-3.5 text-kc-muted">{c.invoice.number}</td>
                    <td className="px-3 py-3.5 text-right">
                      <MoneyValue cents={c.invoice.balanceCents} />
                    </td>
                    <td className={cn("px-3 py-3.5", daysOverdue > 30 && "font-medium text-kc-status-error")}>{formatDays(daysOverdue)}</td>
                    <td className="px-3 py-3.5">
                      <StatusBadge kind="cause" value={c.cause} />
                    </td>
                    <td className="px-5 py-3.5">
                      <Link href={a.href} className="font-semibold">
                        {a.label}
                      </Link>
                      {a.dontChase && <span className="text-kc-muted"> · don&apos;t chase</span>}
                    </td>
                  </tr>
                );
              })}
              {o.overdue.length === 0 && (
                <tr className="border-t border-kc-border">
                  <td colSpan={6} className="px-5 py-8 text-center text-kc-muted">
                    Nothing overdue. Nice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3.5 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
          <div className="flex items-center justify-between">
            <H2>Where the {formatAud(o.owedCents, { cents: false })} sits</H2>
            <span className="text-xs text-kc-muted">By cause, not by colour</span>
          </div>
          <div className="flex flex-col gap-2.5 text-[13px]">
            {o.buckets.map((b) => {
              const def = causeStatus[b.cause];
              return (
                <div key={b.cause} className="grid grid-cols-[160px_1fr_80px] items-center gap-3">
                  <span>{def.bucket}</span>
                  <div
                    className="h-2.5 overflow-hidden rounded-kc-badge bg-kc-border"
                    role="img"
                    aria-label={`${def.bucket}: ${formatAud(b.cents, { cents: false })}`}
                  >
                    <div className={cn("h-full", toneClasses[def.bucketTone].bar)} style={{ width: `${Math.round((b.cents / maxBucket) * 100)}%` }} />
                  </div>
                  <MoneyValue cents={b.cents} showCents={false} className="text-right font-medium" />
                </div>
              );
            })}
          </div>
          <p className="border-t border-kc-border pt-2 text-xs text-kc-muted">
            A generic reminder tool would email all {o.overdue.length === 5 ? "five" : o.overdue.length}. KindCollect sends{" "}
            {o.emailsToday === 0 ? "none today" : o.emailsToday === 1 ? "one" : o.emailsToday}.
          </p>
        </section>

        <section className="flex flex-col gap-3.5 rounded-kc-card border border-kc-border bg-kc-surface px-6 py-5 shadow-kc-card">
          <div className="flex items-center justify-between">
            <H2>Since the bank feed synced</H2>
            <SyncBankButton />
          </div>
          <ul className="flex flex-col gap-2.5 text-[13px]">
            {o.events.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneClasses[auditTone(e.type)].dot)} aria-hidden />
                <div>
                  <span className="font-medium">{e.summary}</span>
                  {e.customer && <> · {e.customer.name}</>}
                  <div className="text-xs text-kc-muted">
                    {formatRelative(e.at)}
                    {e.detail && ` · ${e.detail}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
