"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { AlertTriangle, FileText, Info, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { addCents, formatAmount, formatAud, multiplyCents, parseAmountToCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { dateOnly } from "@/lib/clock";
import { hasBlockers, threeWayCheck, type ThreeWayIssue } from "@/lib/rules";
import { invoiceFormSchema, type InvoiceFormInput } from "@/lib/invoice-schema";
import { cn } from "@/lib/utils";
import { createInvoice } from "@/app/(shell)/invoices/new/actions";

type Doc = { kind: "purchase_order" | "delivery_note"; number: string; poNumber: string | null; fileName: string; signedBy: string | null; lines: { description: string; quantity: number; unitPriceCents: number }[] };
export type FormCustomer = {
  id: string;
  name: string;
  email: string;
  contactName: string;
  requiresPo: boolean;
  termsDays: number;
  hint: string | null;
  docs: Doc[];
};

/** zod → react-hook-form (the stack has no @hookform/resolvers; this is the whole adapter). */
const zodResolver: Resolver<InvoiceFormInput> = async (values) => {
  const r = invoiceFormSchema.safeParse(values);
  if (r.success) return { values, errors: {} };
  const errors: Record<string, unknown> = {};
  for (const issue of r.error.issues) {
    // nest by path: lines.1.quantity → errors.lines[1].quantity
    let node = errors as Record<string | number, unknown>;
    issue.path.forEach((key, i) => {
      if (i === issue.path.length - 1) node[key] ??= { type: issue.code, message: issue.message };
      else node = (node[key] ??= typeof issue.path[i + 1] === "number" ? [] : {}) as Record<string | number, unknown>;
    });
  }
  return { values: {}, errors: errors as never };
};

const DAY_MS = 86_400_000;
const addDays = (ymd: string, days: number) => new Date(dateOnly(ymd).getTime() + days * DAY_MS).toISOString().slice(0, 10);

export function InvoiceForm({
  customers,
  initialCustomerId,
  nextNumber,
  today,
  business,
  demoMode,
}: {
  demoMode: boolean;
  customers: FormCustomer[];
  initialCustomerId: string;
  nextNumber: string;
  today: string;
  business: { name: string; abn: string; address: string; bsb: string; account: string; gstFree: boolean };
}) {
  const router = useRouter();
  const preview = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesFor = (c: FormCustomer | undefined) => {
    const po = c?.docs.find((d) => d.kind === "purchase_order");
    return po
      ? po.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: (l.unitPriceCents / 100).toFixed(2), note: "" }))
      : [{ description: "", quantity: 1, unitPrice: "", note: "" }];
  };
  const instructions = (number: string) => `EFT to ${business.name} · BSB ${business.bsb} · Acct ${business.account} · Please quote ${number}`;
  const first = customers.find((c) => c.id === initialCustomerId) ?? customers[0];

  const form = useForm<InvoiceFormInput>({
    resolver: zodResolver,
    defaultValues: {
      customerId: first.id,
      number: nextNumber,
      poNumber: "",
      issueDate: today,
      dueDate: addDays(today, first.termsDays),
      lines: linesFor(first),
      paymentInstructions: instructions(nextNumber),
    },
  });
  const { register, control, watch, setValue, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const values = watch();
  const customer = customers.find((c) => c.id === values.customerId) ?? first;
  const po = customer.docs.find((d) => d.kind === "purchase_order" && (!values.poNumber || d.number === values.poNumber)) ?? null;
  const dn = customer.docs.find((d) => d.kind === "delivery_note" && (!po || d.poNumber === po.number)) ?? null;

  // live money + rules (same functions the server runs)
  const calc = useMemo(() => {
    const lines = (values.lines ?? []).map((l) => {
      const unit = parseAmountToCents(String(l.unitPrice ?? ""));
      const qty = Number(l.quantity);
      const ok = unit !== null && Number.isInteger(qty) && qty > 0;
      return { description: String(l.description ?? ""), quantity: ok ? qty : 0, unitPriceCents: unit ?? 0, amountCents: ok ? multiplyCents(qty, unit!) : null, note: l.note ?? "" };
    });
    const subtotal = addCents(...lines.map((l) => l.amountCents ?? 0));
    const issues = threeWayCheck(
      { poNumber: values.poNumber, lines },
      { requiresPo: customer.requiresPo },
      po ? { number: po.number, lines: po.lines } : null,
      dn ? { number: dn.number, poNumber: dn.poNumber, lines: dn.lines } : null
    );
    return { lines, subtotal, gst: business.gstFree ? 0 : Math.round(subtotal / 10), issues };
  }, [values, customer, po, dn, business.gstFree]);
  const blockers = calc.issues.filter((i) => i.severity === "blocker");
  const total = calc.subtotal + calc.gst;
  const schemaValid = invoiceFormSchema.safeParse(values).success;

  const applyFix = (issue: ThreeWayIssue) => {
    if (issue.fix?.kind === "use_po") setValue("poNumber", issue.fix.poNumber, { shouldDirty: true });
    if (issue.fix?.kind === "set_quantity") setValue(`lines.${issue.fix.lineIndex}.quantity`, issue.fix.quantity, { shouldDirty: true });
  };
  const keepAndExplain = (lineIndex: number) => {
    const reason = window.prompt("Why bill this quantity? (shown to Tony and attached to the invoice record)", "Short delivery made up on the next drop");
    if (reason?.trim()) setValue(`lines.${lineIndex}.note`, reason.trim(), { shouldDirty: true });
  };
  const changeCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id)!;
    setValue("customerId", id);
    setValue("poNumber", "");
    setValue("dueDate", addDays(values.issueDate, c.termsDays));
    setValue("lines", linesFor(c));
  };
  const fillFromDeliveryNote = () => {
    if (!dn) return toast({ title: "No delivery note on file for this customer" });
    setValue(
      "lines",
      dn.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: ((po?.lines.find((p) => p.description === l.description)?.unitPriceCents ?? 0) / 100).toFixed(2),
        note: "",
      }))
    );
    if (dn.poNumber) setValue("poNumber", dn.poNumber);
    toast({ title: `Filled from ${dn.number}`, description: "Quantities as delivered and signed." });
  };

  const submit = (mode: "draft" | "send") =>
    start(async () => {
      setError(null);
      const r = await createInvoice(form.getValues(), mode);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(
        mode === "draft"
          ? { title: `${r.number} saved as draft` }
          : r.demoOnly
            ? { variant: "review", title: `${r.number} created — demo mode`, description: "Logged as sent; nothing was emailed." }
            : { variant: "success", title: `${r.number} sent` }
      );
      setConfirm(false);
      router.push(`/customers/${r.customerId}?created=${r.number}`);
    });

  const lineIssue = (i: number) => calc.issues.filter((x) => x.lineIndex === i);
  const poIssue = calc.issues.find((x) => x.code === "missing_po" || x.code === "po_number_mismatch");
  const describe = (i: ThreeWayIssue) => (i.code === "missing_po" ? "missing PO number" : i.code === "po_number_mismatch" ? "PO number mismatch" : `quantity mismatch on line ${(i.lineIndex ?? 0) + 1}`);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]">Create invoice</h1>
          <p className="mt-1 text-[13px] text-kc-muted">
            {business.name} → {customer.name} · Checked against the PO and this morning&apos;s delivery note before it goes out
          </p>
        </div>
        <Button variant="outline" size="md" onClick={fillFromDeliveryNote} disabled={!dn}>
          <Truck className="size-4" aria-hidden />
          Fill from delivery note <span className="text-xs text-kc-muted">optional</span>
        </Button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <form className="flex flex-col rounded-kc-card border border-kc-border bg-kc-surface shadow-kc-card" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-4 border-b border-kc-border px-6 py-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span id="customer-label" className="text-xs font-medium text-kc-muted">
                Customer
              </span>
              <Select value={values.customerId} onValueChange={changeCustomer}>
                <SelectTrigger aria-labelledby="customer-label" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customer.hint && (
                <span className="flex items-center gap-1.5 text-xs text-kc-status-review">
                  <Info className="size-3.5" aria-hidden />
                  {customer.hint}
                </span>
              )}
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Invoice number
              <Input {...register("number")} className="h-9 text-sm text-kc-text" />
              <span className="font-normal">Next in sequence · unique</span>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Customer PO number
              <Input {...register("poNumber")} placeholder="e.g. HH-PO-2291" aria-invalid={!!poIssue} className={cn("h-9 text-sm text-kc-text", poIssue?.severity === "blocker" && "border-kc-status-error")} />
              {poIssue ? (
                <span className="font-normal text-kc-status-error">
                  {customer.requiresPo && !values.poNumber ? `Required for ${customer.name}` : poIssue.message}
                  {poIssue.fix?.kind === "use_po" && (
                    <>
                      {" "}— found “{poIssue.fix.poNumber}” on the delivery note.{" "}
                      <button type="button" className="cursor-pointer font-semibold text-kc-primary underline" onClick={() => applyFix(poIssue)}>
                        Use it
                      </button>
                    </>
                  )}
                </span>
              ) : (
                <span className="font-normal">{customer.requiresPo ? "Required — matches the PO on file" : "Optional for this customer"}</span>
              )}
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Issue date
              <Input type="date" {...register("issueDate")} className="h-9 text-sm text-kc-text" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Due date
              <Input type="date" {...register("dueDate")} className="h-9 text-sm text-kc-text" />
              <span className="font-normal">{customer.termsDays} days · Tony&apos;s standard terms</span>
            </label>
          </div>

          <div className="flex flex-col gap-2 border-b border-kc-border px-6 py-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Line items</h2>
              <span className="text-xs text-kc-muted">Fresh produce{business.gstFree ? " · GST-free" : ""}</span>
            </div>
            <div className="grid grid-cols-[1fr_64px_96px_96px_32px] gap-2 text-xs text-kc-muted">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {fields.map((f, i) => (
              <div key={f.id} className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[1fr_64px_96px_96px_32px] items-center gap-2">
                  <Input {...register(`lines.${i}.description`)} aria-label={`Line ${i + 1} description`} className="h-9" />
                  <Input
                    {...register(`lines.${i}.quantity`)}
                    inputMode="numeric"
                    aria-label={`Line ${i + 1} quantity`}
                    className={cn("h-9 text-right tabular-nums", lineIssue(i).some((x) => x.severity === "blocker") && "border-kc-status-error")}
                  />
                  <Input {...register(`lines.${i}.unitPrice`)} inputMode="decimal" aria-label={`Line ${i + 1} unit price`} className="h-9 text-right tabular-nums" />
                  <span className="text-right tabular-nums">{calc.lines[i]?.amountCents != null ? formatAmount(calc.lines[i].amountCents!) : "—"}</span>
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`} className="cursor-pointer text-kc-muted hover:text-kc-status-error" disabled={fields.length === 1}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {values.lines?.[i]?.note && <p className="pl-1 text-xs text-kc-muted">Explanation: {values.lines[i].note}</p>}
                {lineIssue(i).map((issue) => (
                  <div
                    key={issue.code}
                    className={cn(
                      "flex gap-2 rounded-kc-input px-3 py-2.5 text-[13px]",
                      issue.severity === "blocker" ? "bg-kc-status-error-bg text-kc-text" : "bg-kc-status-review-bg text-kc-text"
                    )}
                  >
                    <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", issue.severity === "blocker" ? "text-kc-status-error" : "text-kc-status-review")} aria-hidden />
                    <div>
                      <span className="font-semibold">Three-way check — line {i + 1}:</span> {issue.message.replace(/^Line \d+: /, "")}{" "}
                      {issue.fix?.kind === "set_quantity" && issue.severity === "blocker" && (
                        <>
                          <button type="button" className="cursor-pointer font-semibold text-kc-primary underline" onClick={() => applyFix(issue)}>
                            Change to {issue.fix.quantity}
                          </button>{" "}
                          ·{" "}
                          <button type="button" className="cursor-pointer font-semibold text-kc-primary underline" onClick={() => keepAndExplain(i)}>
                            Keep {values.lines?.[i]?.quantity} and explain
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div>
              <Button type="button" variant="ghost" size="md" onClick={() => append({ description: "", quantity: 1, unitPrice: "", note: "" })}>
                <Plus className="size-4" aria-hidden /> Add line
              </Button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-kc-border px-6 py-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Payment instructions
              <Textarea rows={3} {...register("paymentInstructions")} className="text-sm text-kc-text" />
            </label>
            <div className="flex flex-col gap-1.5 text-xs font-medium text-kc-muted">
              Attached for the customer&apos;s AP team
              <div className="flex flex-wrap gap-1.5">
                {[dn, po].filter(Boolean).map((d) => (
                  <span key={d!.number} className="inline-flex items-center gap-1.5 rounded-kc-badge border border-kc-border px-2.5 py-1 font-normal text-kc-text">
                    <FileText className="size-3.5" aria-hidden />
                    {d!.fileName}
                    {d!.signedBy && " · signed"}
                  </span>
                ))}
                {!dn && !po && <span className="font-normal">No documents on file</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-b-kc-card bg-kc-bg px-6 py-4">
            <Button type="button" variant="outline" size="lg" disabled={pending || !schemaValid} onClick={() => submit("draft")}>
              Save draft
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => preview.current?.scrollIntoView({ behavior: "smooth" })}>
              Preview
            </Button>
            <div className="flex-1" />
            <Button type="button" size="lg" disabled={pending || hasBlockers(calc.issues) || !schemaValid} onClick={() => setConfirm(true)}>
              Review &amp; send
            </Button>
          </div>
          {(blockers.length > 0 || !schemaValid) && (
            <p className="px-6 pb-4 text-xs text-kc-status-error">
              {blockers.length > 0
                ? `Fix ${blockers.length} issue${blockers.length > 1 ? "s" : ""} to continue: ${blockers.map(describe).join(" · ")}.`
                : Object.values(formState.errors)[0]?.message?.toString() ?? "Complete every line (description, whole quantity, unit price)."}
            </p>
          )}
        </form>

        <aside ref={preview} className="flex flex-col gap-3 scroll-mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-muted uppercase">Live preview</h2>
            <span className="text-xs text-kc-muted">Updates as you type</span>
          </div>
          <div className="flex flex-col gap-4 rounded-kc-card border border-kc-border bg-kc-surface p-6 text-[13px] shadow-kc-card">
            <div className="flex justify-between gap-4">
              <div>
                <div className="font-bold">{business.name}</div>
                <div className="text-xs text-kc-muted">
                  ABN {business.abn} · {business.address}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold tracking-[0.1em] text-kc-muted">INVOICE</div>
                <div className="font-semibold">{values.number}</div>
                <div className={cn("text-xs", !values.poNumber && customer.requiresPo ? "text-kc-status-error" : "text-kc-muted")}>
                  PO: {values.poNumber || (customer.requiresPo ? "[MISSING]" : "—")}
                </div>
              </div>
            </div>
            <div className="flex justify-between gap-4">
              <div>
                <div className="text-xs text-kc-muted">Bill to</div>
                <div className="font-medium">
                  {customer.name} — {customer.contactName}
                </div>
                <div className="text-xs text-kc-muted">{customer.email}</div>
              </div>
              <div className="text-right text-xs text-kc-muted">
                <div>Issued {values.issueDate ? formatDate(dateOnly(values.issueDate)) : "—"}</div>
                <div>Due {values.dueDate ? formatDate(dateOnly(values.dueDate)) : "—"}</div>
              </div>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-kc-border text-left text-xs text-kc-muted">
                  <th className="py-1.5 font-medium">Description</th>
                  <th className="py-1.5 text-right font-medium">Qty</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {calc.lines.map((l, i) => (
                  <tr key={i} className="border-b border-kc-border/60">
                    <td className="py-1.5">{l.description || "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.quantity || "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.amountCents != null ? formatAmount(l.amountCents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto flex w-56 flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-kc-muted">Subtotal</span>
                <span className="tabular-nums">{formatAmount(calc.subtotal)}</span>
              </div>
              {!business.gstFree && (
                <div className="flex justify-between">
                  <span className="text-kc-muted">GST</span>
                  <span className="tabular-nums">{formatAmount(calc.gst)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-kc-border pt-1 font-semibold">
                <span>Total AUD</span>
                <span className="tabular-nums">{formatAmount(total)}</span>
              </div>
            </div>
            <div className="rounded-kc-input bg-kc-bg p-2.5 text-xs text-kc-muted">
              {business.gstFree && "Fresh fruit and vegetables are GST-free. "}
              {values.paymentInstructions}
            </div>
          </div>
          {blockers.some((b) => b.fix?.kind === "set_quantity") && (
            <p className="text-xs text-kc-muted">
              {blockers
                .filter((b) => b.fix?.kind === "set_quantity")
                .map((b) => {
                  const fix = b.fix as { kind: "set_quantity"; lineIndex: number; quantity: number };
                  const line = calc.lines[fix.lineIndex];
                  const delta = multiplyCents(fix.quantity - line.quantity, line.unitPriceCents);
                  return `If line ${fix.lineIndex + 1} is changed to ${fix.quantity} boxes the total becomes ${formatAud(total + delta)}.`;
                })
                .join(" ")}{" "}
              Nothing is sent until you confirm on the Review &amp; send step.
            </p>
          )}
        </aside>
      </div>

      <Dialog open={confirm} onOpenChange={(o) => !o && !pending && setConfirm(false)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Send {values.number} to {customer.name}?
            </DialogTitle>
            <DialogDescription>
              {demoMode ? "Demo mode — the invoice is created and logged as sent; nothing is emailed." : "The invoice is emailed with its attachments."}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-kc-input bg-kc-bg p-3 text-[13px]">
            <dt className="text-kc-muted">Total</dt>
            <dd className="text-right font-semibold tabular-nums">{formatAud(total)}</dd>
            <dt className="text-kc-muted">PO</dt>
            <dd className="text-right">{values.poNumber || "—"}</dd>
            <dt className="text-kc-muted">Due</dt>
            <dd className="text-right">{values.dueDate ? formatDate(dateOnly(values.dueDate)) : "—"}</dd>
            <dt className="text-kc-muted">Three-way check</dt>
            <dd className="text-right">{calc.issues.length ? `${calc.issues.length} explained` : "Clean"}</dd>
            <dt className="text-kc-muted">Journal</dt>
            <dd className="text-right font-mono text-xs">
              Dr AR {formatAmount(total)} · Cr Sales {formatAmount(calc.subtotal)}
            </dd>
          </dl>
          {error && <p className="rounded-kc-input bg-kc-status-error-bg px-3 py-2 text-[13px] text-kc-status-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="md" disabled={pending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={pending} onClick={() => submit("send")}>
              {pending ? "Creating…" : "Confirm & send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && !confirm && <p className="text-[13px] text-kc-status-error">{error}</p>}
    </>
  );
}
