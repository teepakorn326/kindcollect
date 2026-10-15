import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { InvoiceForm, type FormCustomer } from "@/components/invoices/InvoiceForm";
import { db } from "@/lib/db";
import { BUSINESS_ID, DEMO_IDS } from "@/lib/demo/seed";
import { sydneyYmd, today } from "@/lib/clock";
import { docLines } from "@/lib/documents";
import { paymentHistory } from "@/lib/ai/diagnosis";

export const metadata = { title: "Create invoice — KindCollect" };
const isDemoMode = () => (process.env.DEMO_MODE ?? "true") !== "false";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer: requested } = await searchParams;
  const [business, customers, docs] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: BUSINESS_ID } }),
    db.customer.findMany({ where: { businessId: BUSINESS_ID }, orderBy: { name: "asc" } }),
    db.document.findMany({ where: { businessId: BUSINESS_ID }, orderBy: { date: "desc" } }),
  ]);
  const histories = await Promise.all(customers.map((c) => paymentHistory(c.id)));

  const formCustomers: FormCustomer[] = customers.map((c, i) => {
    const h = histories[i];
    const hint = [
      c.requiresPo ? "This customer's AP team rejects invoices without a PO number." : null,
      h.invoicesCompleted >= 4 && h.medianDaysLate > c.termsDays ? `Median ${h.medianDaysLate} days late on ${h.invoicesCompleted} invoices.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      contactName: c.contactName,
      requiresPo: c.requiresPo,
      termsDays: c.termsDays,
      hint: hint || null,
      docs: docs
        .filter((d) => d.customerId === c.id)
        .map((d) => ({ kind: d.kind, number: d.number, poNumber: d.poNumber, fileName: d.fileName, signedBy: d.signedBy, lines: docLines(d.lines) })),
    };
  });

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href="/overview" className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          Invoices
        </Link>
        <span>/</span>
        <span>New invoice</span>
      </nav>
      <InvoiceForm
        customers={formCustomers}
        initialCustomerId={requested && customers.some((c) => c.id === requested) ? requested : DEMO_IDS.customers.harbour}
        nextNumber={`INV-${business.nextInvoiceNumber}`}
        today={sydneyYmd(today())}
        demoMode={isDemoMode()}
        business={{ name: business.name, abn: business.abn, address: business.address, bsb: business.bankBsb, account: business.bankAccount, gstFree: business.gstFree }}
      />
    </>
  );
}
