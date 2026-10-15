"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { dateOnly, now } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { formatAud, subtractCents } from "@/lib/money";
import { formatDay } from "@/lib/format";
import { creditNote } from "@/lib/rules";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; stale?: boolean; error: string };

const approveSchema = z.object({
  caseId: z.string().min(1),
  /** returned quantity to credit, per return id (Edit amount) */
  quantities: z.record(z.string(), z.number().int().positive()),
  approver: z.enum(["Sarah", "Tony"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedBalanceCents: z.number().int(),
  expectedUpdatedAt: z.string(),
});

/**
 * Approve the credit note for returned goods (Sweet Bakery). Rules compute the amount; the server re-checks
 * that nothing changed since the page loaded, writes the CreditNote, reduces the balance, keeps reminders
 * paused and appends audit events — all in one transaction. Nothing is sent to the customer.
 */
export async function approveCreditNote(
  input: z.infer<typeof approveSchema>
): Promise<ActionResult<{ creditNoteNumbers: string[]; balanceAfterCents: number }>> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { caseId, quantities, approver, dueDate, expectedBalanceCents, expectedUpdatedAt } = parsed.data;

  try {
    const result = await db.$transaction(
      async (tx) => {
        const c = await tx.case.findUniqueOrThrow({
          where: { id: caseId },
          include: {
            customer: true,
            business: true,
            invoice: { include: { returns: { include: { creditNote: true } } } },
          },
        });
        const inv = c.invoice;
        if (c.cause !== "invoice_issue_ours" || c.status === "resolved") {
          throw new UserError("This case no longer needs a credit note.");
        }
        if (inv.balanceCents !== expectedBalanceCents || inv.updatedAt.toISOString() !== expectedUpdatedAt) {
          throw new UserError(`${inv.number} changed since you opened this page. Reload to see the latest balance.`, true);
        }

        const open = inv.returns.filter((r) => !r.creditNote);
        if (open.length === 0) throw new UserError("A credit note has already been issued for these returns.", true);
        for (const r of open) {
          const q = quantities[r.id];
          if (q === undefined || q > r.quantity) {
            throw new UserError(`Credit quantity for ${r.number} must be between 1 and ${r.quantity}.`);
          }
        }

        const existing = await tx.creditNote.count();
        const balanceBefore = inv.balanceCents;
        const notes = [];
        let totalCents = 0;
        let gstCents = 0;
        for (const [i, r] of open.entries()) {
          const calc = creditNote([{ product: r.product, quantity: quantities[r.id], unitPriceCents: r.unitPriceCents }], {
            gstFree: c.business.gstFree,
          });
          totalCents += calc.totalCents;
          gstCents += calc.gstCents;
          notes.push(
            await tx.creditNote.create({
              data: {
                number: `CN-${String(existing + i + 1).padStart(4, "0")}`,
                invoiceId: inv.id,
                returnId: r.id,
                amountCents: calc.totalCents,
                gstCents: calc.gstCents,
                reason: `${r.number} · ${r.product} — ${quantities[r.id]} × ${formatAud(r.unitPriceCents)} — ${r.reason.toLowerCase()}`,
                approvedBy: approver,
                approvedAt: now(),
              },
            })
          );
        }

        const balanceAfter = subtractCents(balanceBefore, totalCents);
        if (balanceAfter < 0) throw new UserError("The credit note is larger than the invoice balance.");
        const newDue = dateOnly(dueDate);

        await tx.invoice.update({ where: { id: inv.id }, data: { balanceCents: balanceAfter, dueDate: newDue } });
        await tx.case.update({
          where: { id: c.id },
          data: { diagnosisConfirmed: true, status: "waiting_on_customer", remindersPaused: true },
        });

        const at = now();
        const numbers = notes.map((n) => n.number).join(", ");
        await tx.auditEvent.createMany({
          data: [
            {
              businessId: c.businessId,
              caseId: c.id,
              customerId: c.customerId,
              invoiceId: inv.id,
              at,
              actor: approver,
              type: "credit_note_approved",
              summary: `Credit note ${formatAud(totalCents, { cents: false })} approved`,
              detail: `approved by ${approver}`,
              data: {
                creditNotes: notes.map((n) => ({ id: n.id, number: n.number, amountCents: n.amountCents })),
                amountCents: totalCents,
                gstCents,
                balanceBeforeCents: balanceBefore,
                balanceAfterCents: balanceAfter,
                journal: [
                  { account: "Sales Returns", debitCents: totalCents - gstCents },
                  ...(gstCents ? [{ account: "GST Collected", debitCents: gstCents }] : []),
                  { account: `Accounts Receivable – ${c.customer.name}`, creditCents: totalCents },
                ],
                requestedBy: currentUser.name,
              },
            },
            {
              businessId: c.businessId,
              caseId: c.id,
              customerId: c.customerId,
              invoiceId: inv.id,
              at: new Date(at.getTime() + 1),
              actor: "Rule",
              type: "invoice_corrected",
              summary: `Corrected invoice ${formatAud(balanceAfter, { cents: false })} drafted`,
              detail: `due ${formatDay(newDue)} · not sent · reminders stay paused`,
              data: { creditNoteNumbers: numbers, newDueDate: dueDate },
            },
          ],
        });

        return { creditNoteNumbers: notes.map((n) => n.number), balanceAfterCents: balanceAfter };
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
    revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, stale: e.stale };
    console.error("approveCreditNote failed", e);
    return { ok: false, error: "Could not approve the credit note. Nothing was changed." };
  }
}

const rejectSchema = z.object({ caseId: z.string().min(1), expectedUpdatedAt: z.string() });

/** "Not a valid return": the person rejects the diagnosis; the case re-opens for review. */
export async function rejectReturn(input: z.infer<typeof rejectSchema>): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  try {
    await db.$transaction(
      async (tx) => {
        const c = await tx.case.findUniqueOrThrow({ where: { id: parsed.data.caseId } });
        if (c.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
          throw new UserError("This case changed since you opened it. Reload to see the latest.", true);
        }
        await tx.case.update({ where: { id: c.id }, data: { diagnosisConfirmed: false, status: "needs_review" } });
        await tx.auditEvent.create({
          data: {
            businessId: c.businessId,
            caseId: c.id,
            customerId: c.customerId,
            invoiceId: c.invoiceId,
            at: now(),
            actor: currentUser.name,
            type: "diagnosis_rejected",
            summary: "Not a valid return · re-opened for review",
            detail: `by ${currentUser.name}`,
          },
        });
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, stale: e.stale };
    console.error("rejectReturn failed", e);
    return { ok: false, error: "Could not update the case. Nothing was changed." };
  }
}

class UserError extends Error {
  constructor(
    message: string,
    public stale = false
  ) {
    super(message);
  }
}
