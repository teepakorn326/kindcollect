import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CallWorkspace } from "@/components/calls/CallWorkspace";
import { db } from "@/lib/db";
import { now, daysOverdue } from "@/lib/clock";
import { formatAud } from "@/lib/money";
import { formatDays, formatTime } from "@/lib/format";
import { callGuard } from "@/lib/rules";
import { asOutcome, asTurns, previousCallStarts } from "@/lib/calls";
import { REHEARSAL_CALLER } from "@/lib/demo/call-rehearsal";

export const metadata = { title: "Voice call — KindCollect" };

export default async function VoiceCallPage({ params }: { params: Promise<{ callId: string }> }) {
  const call = await db.call.findUnique({
    where: { id: (await params).callId },
    relationLoadStrategy: "join",
    include: { customer: true, invoice: true },
  });
  if (!call) notFound();
  const [unanswered, prev] = await Promise.all([
    db.message.count({ where: { invoiceId: call.invoiceId, direction: "outbound", status: "sent" } }),
    previousCallStarts(call.customerId, call.id),
  ]);
  const overdue = daysOverdue(call.invoice.dueDate);
  const guard = callGuard({ at: now(), approved: !!call.approvedBy, previousCallStarts: prev });

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-kc-muted">
        <Link href={`/customers/${call.customerId}`} className="inline-flex items-center gap-1.5 font-medium text-kc-muted hover:text-kc-text">
          <ArrowLeft className="size-4" aria-hidden />
          {call.customer.name}
        </Link>
        <span>/</span>
        <span>{call.invoice.number} · Voice call</span>
      </nav>
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]">Let KindCollect make the call</h1>
        <p className="mt-1 text-[13px] text-kc-muted">
          {call.invoice.number} · {formatAud(call.invoice.balanceCents)} · {overdue > 0 ? `${formatDays(overdue)} overdue` : "not overdue"} · {unanswered} emails
          unanswered · Next step by rule: a phone call to Accounts Payable
        </p>
      </div>
      <CallWorkspace
        callId={call.id}
        phone={call.phoneNumber}
        customerLabel={call.source === "rehearsal" ? REHEARSAL_CALLER.company : call.customer.name.split(" ")[0]}
        guard={guard.allowed ? { allowed: true } : { allowed: false, detail: guard.detail }}
        approvedLine={call.approvedBy && call.approvedAt ? `Script approved by ${call.approvedBy} ${formatTime(call.approvedAt)}` : "Waiting for Tony's approval"}
        initial={{
          status: call.status,
          transcript: asTurns(call.transcript),
          outcome: asOutcome(call.outcome),
          startedAt: call.startedAt?.toISOString() ?? null,
          endedAt: call.endedAt?.toISOString() ?? null,
          recordingUrl: call.recordingUrl,
          source: call.source,
          outcomeConfirmedAt: call.outcomeConfirmedAt?.toISOString() ?? null,
        }}
      />
    </>
  );
}
