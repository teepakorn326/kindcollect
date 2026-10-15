"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { formatAud } from "@/lib/money";
import { formatDay } from "@/lib/format";
import { getCustomerAccount } from "@/lib/customers";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/** "Send to Tony for decision": creates a Task. Never changes the customer's terms. */
export async function sendTermsToTony(input: { customerId: string; option: string }): Promise<Result> {
  const parsed = z.object({ customerId: z.string(), option: z.string() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const acct = await getCustomerAccount(parsed.data.customerId);
  if (!acct) return { ok: false, error: "Customer not found" };
  const option = acct.termsOptions.find((o) => o.key === parsed.data.option);
  if (!option) return { ok: false, error: "That option is no longer suggested." };
  const openCase = acct.c.cases.find((k) => k.status !== "resolved");
  const at = now();
  await db.$transaction([
    db.task.create({
      data: {
        businessId: acct.c.businessId, customerId: acct.c.id, caseId: openCase?.id, assignee: "Tony",
        title: `Decide terms for ${acct.c.name}: ${option.title.toLowerCase()}?`,
        detail: `${option.body} History: paid on time ${acct.history.paidOnTime} of ${acct.history.invoicesCompleted}, median ${acct.history.medianDaysLate} days late.`,
        createdBy: currentUser.name, data: { option: option.key },
      },
    }),
    db.auditEvent.create({
      data: {
        businessId: acct.c.businessId, customerId: acct.c.id, caseId: openCase?.id, invoiceId: openCase?.invoiceId, at, actor: currentUser.name,
        type: "terms_sent_to_tony", summary: `Terms decision sent to Tony · ${option.title.toLowerCase()}`, detail: "terms unchanged until Tony decides",
      },
    }),
  ]);
  revalidatePath(`/customers/${acct.c.id}`);
  return { ok: true };
}

/** "Draft the final notice": a firm draft (rules fill the facts) that opens in Email Approval. Nothing is sent. */
export async function draftFinalNotice(customerId: string): Promise<Result> {
  const acct = await getCustomerAccount(customerId);
  if (!acct) return { ok: false, error: "Customer not found" };
  const inv = acct.oldestOverdue;
  if (!inv) return { ok: false, error: "Nothing overdue to give notice on." };
  const existing = acct.c.messages.find((m) => m.invoiceId === inv.id && m.status === "draft");
  if (existing) return { ok: true, id: existing.id };
  const k = acct.c.cases.find((x) => x.invoiceId === inv.id);
  const deadline = new Date(acct.asOf.getTime() + 7 * 86_400_000);
  const body = [
    `Hello ${acct.c.contactName.split(" ")[0] === "Accounts" ? "AP team" : acct.c.contactName.split(" ")[0]},`,
    "",
    `Invoice ${inv.number}${inv.poNumber ? ` (PO ${inv.poNumber})` : ""} for ${formatAud(inv.balanceCents)} was due on ${formatDay(inv.dueDate)} and is still unpaid.`,
    `Please arrange payment by ${formatDay(deadline)}, or tell us what is holding it up. If we haven't heard by then, we'll call your accounts team.`,
    "",
    "Regards,",
    "Tony",
    "Fresh Harvest Produce",
  ].join("\n");
  const m = await db.message.create({
    data: {
      id: `msg-final-${inv.id}`, customerId: acct.c.id, caseId: k?.id, invoiceId: inv.id, direction: "outbound", status: "draft", tone: "firm",
      subject: `Final notice — ${inv.number}`, body, fromName: "Tony — Fresh Harvest Produce", fromEmail: "tony@freshharvest.example",
      toEmail: acct.c.email, occurredAt: now(),
    },
  });
  revalidatePath(`/customers/${acct.c.id}`);
  return { ok: true, id: m.id };
}
