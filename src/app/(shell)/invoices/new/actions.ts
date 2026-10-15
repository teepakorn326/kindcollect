"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { BUSINESS_ID } from "@/lib/demo/seed";
import { dateOnly, now } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { addCents, formatAud, multiplyCents, parseAmountToCents } from "@/lib/money";
import { hasBlockers, threeWayCheck } from "@/lib/rules";
import { invoiceFormSchema, type InvoiceFormInput } from "@/lib/invoice-schema";
import { docLines } from "@/lib/documents";

type Result = { ok: true; invoiceId: string; number: string; customerId: string; demoOnly: boolean } | { ok: false; error: string };
const isDemoMode = () => (process.env.DEMO_MODE ?? "true") !== "false";

/**
 * Save as draft, or send. The server re-runs the zod schema and threeWayCheck(); "send" is refused while any
 * blocker remains. Totals come from multiplyCents/addCents. DEMO_MODE: nothing is emailed.
 */
export async function createInvoice(input: InvoiceFormInput, mode: "draft" | "send"): Promise<Result> {
  const parsed = invoiceFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  const v = parsed.data;

  const [business, customer, docs, clash] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: BUSINESS_ID } }),
    db.customer.findUnique({ where: { id: v.customerId } }),
    db.document.findMany({ where: { customerId: v.customerId } }),
    db.invoice.findFirst({ where: { businessId: BUSINESS_ID, number: v.number } }),
  ]);
  if (!customer) return { ok: false, error: "Customer not found" };
  if (clash) return { ok: false, error: `${v.number} already exists — invoice numbers are unique.` };

  const lines = v.lines.map((l, i) => {
    const unit = parseAmountToCents(l.unitPrice)!;
    return { sortOrder: i, description: l.description, quantity: l.quantity, unitPriceCents: unit, amountCents: multiplyCents(l.quantity, unit), note: l.note };
  });
  const po = docs.find((d) => d.kind === "purchase_order" && (!v.poNumber || d.number === v.poNumber)) ?? null;
  const dn = docs.find((d) => d.kind === "delivery_note" && (!po || d.poNumber === po.number)) ?? null;
  const issues = threeWayCheck(
    { poNumber: v.poNumber, lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, note: l.note })) },
    { requiresPo: customer.requiresPo },
    po ? { number: po.number, lines: docLines(po.lines) } : null,
    dn ? { number: dn.number, poNumber: dn.poNumber, lines: docLines(dn.lines) } : null
  );
  if (mode === "send" && hasBlockers(issues)) {
    return { ok: false, error: `Fix before sending: ${issues.filter((i) => i.severity === "blocker").map((i) => i.message).join(" ")}` };
  }

  const totalCents = addCents(...lines.map((l) => l.amountCents));
  const gstCents = business.gstFree ? 0 : Math.round(totalCents / 10);
  const at = now();
  const demoOnly = mode === "send" && (isDemoMode() || !process.env.RESEND_API_KEY);
  const expectedNumber = `INV-${business.nextInvoiceNumber}`;

  const invoice = await db.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        id: `inv-${v.number.slice(4).toLowerCase()}`,
        businessId: BUSINESS_ID,
        customerId: customer.id,
        number: v.number,
        poNumber: v.poNumber || null,
        issueDate: dateOnly(v.issueDate),
        dueDate: dateOnly(v.dueDate),
        status: mode === "send" ? "sent" : "draft",
        totalCents: totalCents + gstCents,
        balanceCents: totalCents + gstCents,
        lines: {
          create: lines.map((l) => ({ sortOrder: l.sortOrder, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, amountCents: l.amountCents })),
        },
      },
    });
    if (v.number === expectedNumber) {
      await tx.business.update({ where: { id: BUSINESS_ID }, data: { nextInvoiceNumber: business.nextInvoiceNumber + 1 } });
    }
    await tx.auditEvent.create({
      data: {
        businessId: BUSINESS_ID, customerId: customer.id, invoiceId: inv.id, at, actor: currentUser.name,
        type: mode === "send" ? "invoice_sent" : "invoice_drafted",
        summary: mode === "send" ? `${v.number} ${formatAud(inv.totalCents, { cents: false })} sent${demoOnly ? " — logged, not emailed (demo mode)" : ""}` : `${v.number} saved as draft`,
        detail: [v.poNumber ? `PO ${v.poNumber}` : "no PO", issues.length ? `${issues.length} three-way note${issues.length > 1 ? "s" : ""}` : "three-way check clean"].join(" · "),
        data: {
          issues: issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })),
          notes: lines.filter((l) => l.note).map((l) => ({ line: l.sortOrder + 1, note: l.note })),
          journal: mode === "send" ? [{ account: `Accounts Receivable – ${customer.name}`, debitCents: inv.totalCents }, { account: "Sales Revenue", creditCents: totalCents }] : [],
          demoOnly,
        },
      },
    });
    return inv;
  });
  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id, number: invoice.number, customerId: customer.id, demoOnly };
}
