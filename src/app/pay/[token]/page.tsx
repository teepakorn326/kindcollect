import { notFound } from "next/navigation";
import { CircleCheckBig } from "lucide-react";
import { db } from "@/lib/db";
import { formatAud } from "@/lib/money";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay invoice — Fresh Harvest Produce" };

/** In-app pay link (DEMO_MODE). Shows what the customer would see; no payment is taken. */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const m = await db.message.findUnique({
    where: { id: (await params).token },
    include: { invoice: true, customer: { include: { business: true } } },
  });
  if (!m?.invoice) notFound();
  const { invoice: inv, customer } = m;
  const biz = customer.business;
  return (
    <main className="flex min-h-screen items-start justify-center bg-kc-bg px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-kc-card border border-kc-border bg-kc-surface p-6 shadow-kc-card">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-kc-input bg-kc-primary">
            <CircleCheckBig className="size-4 text-kc-surface" aria-hidden />
          </div>
          <span className="font-bold">{biz.name}</span>
          <span className="ml-auto rounded-kc-badge bg-kc-status-review-bg px-2.5 py-1 text-xs font-semibold text-kc-status-review">Demo data</span>
        </div>
        <div>
          <div className="text-[13px] text-kc-muted">
            {inv.number} · {customer.name}
          </div>
          <div className="text-[30px] font-bold tabular-nums">{formatAud(inv.balanceCents)}</div>
          <div className="text-[13px] text-kc-muted">
            {inv.status === "paid" ? "Paid — thank you" : `Due ${formatDate(inv.dueDate)}`}
          </div>
        </div>
        <div className="rounded-kc-input bg-kc-bg p-3 text-[13px]">
          EFT to {biz.name} · BSB {biz.bankBsb} · Acct {biz.bankAccount} · Please quote {inv.number}
        </div>
        <p className="rounded-kc-input bg-kc-status-review-bg px-3 py-2 text-xs text-kc-status-review">
          Demo pay link — card payments are not connected and no payment is taken.
        </p>
      </div>
    </main>
  );
}
