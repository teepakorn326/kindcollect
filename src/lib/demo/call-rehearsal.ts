// Rehearsal call (demo fallback for the live Vapi call): the transcript the "Play recording" button loads.
// The audio in public/demo/ is rendered from these turns by scripts/render-rehearsal.mjs.
// Dates follow the 2026 calendar: call on Tue 13 Oct → "next Thursday" = Thu 22 Oct.

export type RehearsalTurn = { speaker: "agent" | "customer"; text: string };

export const REHEARSAL_CALLER = { name: "Priya", role: "Accounts Payable", company: "Harbourside" };

export const REHEARSAL_TURNS: RehearsalTurn[] = [
  {
    speaker: "agent",
    text: "Hi, this is an automated assistant calling on behalf of Tony at Fresh Harvest Produce. This call is recorded. I'm checking on invoice one-zero-one-nine for three thousand three hundred dollars. Could I confirm it's with the right person?",
  },
  { speaker: "customer", text: "Yeah, this is Priya in AP. Which one is that?" },
  {
    speaker: "agent",
    text: "Invoice INV-1019, dated 15 August, purchase order HH-PO-2251, for fresh produce. It was due on 29 August. Has it been received on your side?",
  },
  {
    speaker: "customer",
    text: "Let me look... yes, it's here. It got stuck because the PO was closed before it came in. I'll need to reopen it. Honestly it'll be in next Thursday's run.",
  },
  {
    speaker: "agent",
    text: "Thanks, that's helpful. So to confirm: the invoice is received, the PO needs reopening, and payment is expected in the run on Thursday the 22nd of October. Is there anything Tony should send to make that easier?",
  },
  { speaker: "customer", text: "No, that's fine. I'll reopen the PO today." },
  { speaker: "agent", text: "Great, thank you Priya. I'll let Tony know. Have a good day." },
];

/** Call date the transcript is resolved against (Sydney). */
export const REHEARSAL_CALL_DATE = "2026-10-13";

/**
 * Pre-filled outcome for the rehearsal (used only when extract_call_outcome is unavailable and nothing is cached).
 * Sarah still confirms — and can correct — the date before anything is written.
 */
export const REHEARSAL_OUTCOME = {
  invoice_received: true,
  blocker: "PO closed before the invoice arrived",
  commitment_date: "2026-10-22",
  dispute_raised: false,
  confidence: "medium" as const,
  quotes: ["It got stuck because the PO was closed before it came in.", "Honestly it'll be in next Thursday's run."],
};
