import Link from "next/link";
import { db } from "@/lib/db";
import { BUSINESS_ID } from "@/lib/demo/seed";
import { daysOverdue, today } from "@/lib/clock";
import { addCents } from "@/lib/money";
import { MoneyValue } from "@/components/domain/MoneyValue";

export const metadata = { title: "Customers — KindCollect" };

export default async function CustomersPage() {
  const customers = await db.customer.findMany({
    where: { businessId: BUSINESS_ID },
    orderBy: { name: "asc" },
    include: { invoices: { where: { status: "sent" } } },
  });
  const asOf = today();
  return (
    <>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]">Customers</h1>
      <section className="overflow-hidden rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-kc-bg text-left text-xs text-kc-muted">
              <th className="px-5 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Contact</th>
              <th className="px-3 py-2.5 font-medium">Terms</th>
              <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
              <th className="px-5 py-2.5 text-right font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-kc-border">
                <td className="px-5 py-3 font-medium">
                  <Link href={`/customers/${c.id}`}>{c.name}</Link>
                </td>
                <td className="px-3 py-3 text-kc-muted">{c.email}</td>
                <td className="px-3 py-3">
                  {c.termsDays} days{c.requiresPo && " · PO required"}
                </td>
                <td className="px-3 py-3 text-right">
                  <MoneyValue cents={addCents(...c.invoices.map((i) => i.balanceCents))} />
                </td>
                <td className="px-5 py-3 text-right">
                  <MoneyValue cents={addCents(...c.invoices.filter((i) => daysOverdue(i.dueDate, asOf) > 0).map((i) => i.balanceCents))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
