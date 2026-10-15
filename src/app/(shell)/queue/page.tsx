import Link from "next/link";
import type { CaseCause } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/domain/StatusBadge";
import { MoneyValue } from "@/components/domain/MoneyValue";
import { QueueFilters, type FilterDef } from "@/components/queue/QueueFilters";
import { SelectAll } from "@/components/queue/SelectAll";
import { getQueue, OPEN_STATUSES, type QueueRow } from "@/lib/cases";
import { formatDays, formatTime } from "@/lib/format";
import { caseStatus, causeStatus, toneClasses, whoActsFilter, whoActsLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata = { title: "Action Queue — KindCollect" };

const causeOptions: CaseCause[] = ["paid_not_matched", "invoice_issue_ours", "probably_forgot", "cash_flow", "habitual_late", "blocked_on_customer_po"];

type Search = { cause?: string; who?: string; status?: string; overdue?: string; customer?: string };

function matches(row: QueueRow, s: Search): boolean {
  const { c, daysOverdue } = row;
  if (s.cause && s.cause !== "all" && c.cause !== s.cause) return false;
  if (s.who && s.who !== "anyone" && !whoActsFilter[s.who as keyof typeof whoActsFilter]?.includes(c.whoActs)) return false;
  const status = s.status ?? "open";
  if (status === "open" && !OPEN_STATUSES.includes(c.status)) return false;
  if (status !== "open" && status !== "all" && c.status !== status) return false;
  if (s.overdue === "lt14" && !(daysOverdue < 14)) return false;
  if (s.overdue === "14to30" && !(daysOverdue >= 14 && daysOverdue <= 30)) return false;
  if (s.overdue === "gt30" && !(daysOverdue > 30)) return false;
  if (s.customer && s.customer !== "all" && c.customerId !== s.customer) return false;
  return true;
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const { rows, lastSyncedAt } = await getQueue();
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.c.status));
  const shown = rows.filter((r) => matches(r, search));
  const overdueOpen = open.filter((r) => r.daysOverdue > 0).length;
  const emailsToday = open.filter((r) => r.c.cause === "probably_forgot" && !r.guard.blocked).length;

  const customers = [...new Map(rows.map((r) => [r.c.customerId, r.c.customer.name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1])
  );

  const filters: FilterDef[] = [
    {
      key: "cause",
      label: "Cause",
      defaultValue: "all",
      options: [{ value: "all", label: "All" }, ...causeOptions.map((c) => ({ value: c, label: causeStatus[c].label }))],
    },
    {
      key: "who",
      label: "Who acts",
      defaultValue: "anyone",
      options: [
        { value: "anyone", label: "Anyone" },
        { value: "sarah", label: "Sarah" },
        { value: "tony", label: "Tony" },
        { value: "customer", label: "Customer" },
      ],
    },
    {
      key: "status",
      label: "Status",
      defaultValue: "open",
      options: [
        { value: "open", label: "Needs approval" },
        { value: "waiting_on_customer", label: "Waiting on customer" },
        { value: "resolved", label: "Resolved" },
        { value: "all", label: "All" },
      ],
    },
    {
      key: "overdue",
      label: "Overdue",
      defaultValue: "any",
      options: [
        { value: "any", label: "Any" },
        { value: "lt14", label: "Under 14 days" },
        { value: "14to30", label: "14–30 days" },
        { value: "gt30", label: "Over 30 days" },
      ],
    },
    {
      key: "customer",
      label: "Customer",
      defaultValue: "all",
      options: [{ value: "all", label: "All" }, ...customers.map(([id, name]) => ({ value: id, label: name }))],
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">Action Queue</h1>
          <p className="mt-1 text-[13px] text-kc-muted">
            {overdueOpen} overdue invoices · Ordered by rule: match money first, fix our mistakes second, then chase — never the
            other way round
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="md" disabled title="Coming with AI diagnosis (Phase 6)">
            Weekly summary for Tony
          </Button>
          <Button variant="outline" size="md" disabled title="Coming with AI diagnosis (Phase 6)">
            Re-diagnose all
          </Button>
        </div>
      </div>

      <QueueFilters filters={filters} />

      <section className="overflow-hidden rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="bg-kc-bg text-left text-xs text-kc-muted">
                <th className="w-9 px-5 py-2.5 font-medium">
                  <SelectAll label="Select all cases" />
                </th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Invoice</th>
                <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                <th className="px-3 py-2.5 font-medium">Overdue</th>
                <th className="px-3 py-2.5 font-medium">Likely cause · evidence</th>
                <th className="px-3 py-2.5 font-medium">Who acts</th>
                <th className="px-5 py-2.5 font-medium">Suggested action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, daysOverdue, action }) => (
                <tr key={c.id} className="border-t border-kc-border align-top">
                  <td className="px-5 py-3.5">
                    <input type="checkbox" className="size-4 accent-kc-primary" aria-label={`Select ${c.invoice.number}`} />
                  </td>
                  <td className="px-3 py-3.5 font-medium">
                    <Link href={`/queue/${c.id}`} className="text-kc-text hover:text-kc-primary">
                      {c.customer.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap text-kc-muted">{c.invoice.number}</td>
                  <td className="px-3 py-3.5 text-right whitespace-nowrap">
                    <MoneyValue cents={c.invoice.balanceCents} />
                  </td>
                  <td className={cn("px-3 py-3.5 whitespace-nowrap", daysOverdue > 30 && "font-medium text-kc-status-error")}>
                    {daysOverdue > 0 ? formatDays(daysOverdue) : "Not due"}
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusBadge kind="cause" value={c.cause} />
                    {c.status === "needs_review" && (
                      <span className={cn("ml-1.5 inline-flex rounded-kc-badge px-2.5 py-[3px] text-xs font-semibold", toneClasses[caseStatus.needs_review.tone].badge)}>
                        {caseStatus.needs_review.label}
                      </span>
                    )}
                    <div className="mt-1 text-xs text-kc-muted">{c.causeEvidenceLine}</div>
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap">{whoActsLabel[c.whoActs]}</td>
                  <td className="px-5 py-3.5">
                    <Link href={action.href} className="font-semibold">
                      {action.label}
                    </Link>
                    <div className="text-xs text-kc-muted">{action.detail}</div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr className="border-t border-kc-border">
                  <td colSpan={8} className="px-5 py-10 text-center text-kc-muted">
                    No cases match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-kc-border px-5 py-3 text-xs text-kc-muted">
          <span>
            {shown.length} of {open.length} cases
            {lastSyncedAt && <> · Bank feed synced {formatTime(lastSyncedAt)}</>} · Every case re-diagnosed when new data arrives
          </span>
          <span>
            Only {emailsToday} of {open.length} gets a reminder email today
          </span>
        </div>
      </section>
    </>
  );
}
