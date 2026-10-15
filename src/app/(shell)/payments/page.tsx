import Link from "next/link";
import { db } from "@/lib/db";
import { BUSINESS_ID } from "@/lib/demo/seed";
import { formatAmount } from "@/lib/money";
import { formatDay, formatTime } from "@/lib/format";
import { toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata = { title: "Payments — KindCollect" };

const statusDef: Record<string, { label: string; tone: Tone }> = {
  unallocated: { label: "Unallocated · suspense", tone: "review" },
  allocated: { label: "Matched", tone: "success" },
  ignored: { label: "Ignored · zero value", tone: "neutral" },
  outgoing: { label: "Money out", tone: "neutral" },
};

/** Bank feed statement (seeded — mock input, real matching). */
export default async function PaymentsPage() {
  const lines = await db.payment.findMany({
    where: { businessId: BUSINESS_ID },
    orderBy: [{ date: "desc" }, { amountCents: "desc" }],
    take: 60,
    relationLoadStrategy: "join",
    include: { allocations: { include: { invoice: { select: { number: true } } } } },
  });
  const lastSync = lines.reduce<Date | null>((m, l) => (!m || l.syncedAt > m ? l.syncedAt : m), null);

  return (
    <>
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Payments</h1>
        <p className="mt-1 text-[13px] text-kc-muted">
          Bank statement · Fresh Harvest Produce{lastSync && <> · Feed synced {formatDay(lastSync)} {formatTime(lastSync)}</>} · Demo data
        </p>
      </div>
      <section className="overflow-hidden rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-kc-bg text-left text-xs text-kc-muted">
              <th className="px-5 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Description</th>
              <th className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 font-medium">Matched to</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const def = statusDef[l.status];
              return (
                <tr key={l.id} className="border-t border-kc-border">
                  <td className="px-5 py-2.5 whitespace-nowrap">{formatDay(l.date)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{l.description}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatAmount(l.amountCents)}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-flex rounded-kc-badge px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap", toneClasses[def.tone].badge)}>{def.label}</span>
                  </td>
                  <td className="px-5 py-2.5">
                    {l.status === "unallocated" ? (
                      <Link href={`/payments/${l.id}/review`} className="font-semibold">
                        Match payment
                      </Link>
                    ) : (
                      <span className="text-kc-muted">{l.allocations.map((a) => a.invoice.number).join(", ") || "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
