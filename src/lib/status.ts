// Single source of status / cause labels and their colour tokens. Status = label + colour, never colour alone.
import type { CaseCause, CaseStatus, Confidence, EvidenceType, WhoActs } from "@prisma/client";

export type Tone = "success" | "review" | "error" | "info" | "neutral";

/** Tailwind classes per tone — only kc-* tokens. */
export const toneClasses: Record<Tone, { badge: string; text: string; dot: string; bar: string }> = {
  success: { badge: "bg-kc-status-success-bg text-kc-status-success", text: "text-kc-status-success", dot: "bg-kc-status-success", bar: "bg-kc-status-success" },
  review: { badge: "bg-kc-status-review-bg text-kc-status-review", text: "text-kc-status-review", dot: "bg-kc-status-review", bar: "bg-kc-status-review" },
  error: { badge: "bg-kc-status-error-bg text-kc-status-error", text: "text-kc-status-error", dot: "bg-kc-status-error", bar: "bg-kc-status-error" },
  info: { badge: "bg-kc-status-info-bg text-kc-status-info", text: "text-kc-status-info", dot: "bg-kc-status-info", bar: "bg-kc-status-info" },
  neutral: { badge: "bg-kc-border/60 text-kc-text", text: "text-kc-muted", dot: "bg-kc-muted", bar: "bg-kc-muted" },
};

export type StatusDef = { label: string; tone: Tone };

// ---------- likely cause ----------

export const causeStatus: Record<CaseCause, StatusDef & { long: string; bucket: string; bucketTone: Tone }> = {
  paid_not_matched: { label: "Paid · not matched", long: "Paid, not matched", tone: "success", bucket: "Already in the bank", bucketTone: "neutral" },
  invoice_issue_ours: { label: "Invoice issue — ours", long: "Invoice issue — our side", tone: "info", bucket: "Needs a credit note", bucketTone: "info" },
  probably_forgot: { label: "Probably forgot", long: "Probably forgot", tone: "success", bucket: "Needs a reminder", bucketTone: "success" },
  cash_flow: { label: "Cash-flow trouble", long: "Cash-flow trouble", tone: "review", bucket: "Needs a payment plan", bucketTone: "review" },
  habitual_late: { label: "Habitual late payer", long: "Habitual late payer", tone: "error", bucket: "Needs firmer terms", bucketTone: "error" },
  blocked_on_customer_po: { label: "Blocked on customer's PO", long: "Blocked on customer's PO", tone: "error", bucket: "Waiting on customer's PO", bucketTone: "error" },
  unknown: { label: "Needs review", long: "Cause unknown — needs review", tone: "review", bucket: "Needs review", bucketTone: "review" },
};

/** Order of the "Where the money sits" bars (Overview mockup). */
export const bucketOrder: CaseCause[] = [
  "probably_forgot",
  "cash_flow",
  "invoice_issue_ours",
  "habitual_late",
  "blocked_on_customer_po",
  "unknown",
  "paid_not_matched",
];

// ---------- payment status of an invoice ----------

export type PaymentStatusKey = "paid" | "unpaid" | "not_due" | "overdue" | "partially_paid" | "draft" | "void";

export const paymentStatus: Record<PaymentStatusKey, StatusDef> = {
  paid: { label: "Paid", tone: "success" },
  unpaid: { label: "Unpaid", tone: "info" },
  not_due: { label: "Unpaid · not due", tone: "info" },
  overdue: { label: "Overdue", tone: "error" },
  partially_paid: { label: "Partially paid", tone: "review" },
  draft: { label: "Draft", tone: "neutral" },
  void: { label: "Void", tone: "neutral" },
};

// ---------- follow-up (reminders) ----------

export type FollowupKey = "active" | "paused" | "held" | "cancelled" | "plan_agreed";

export const followupStatus: Record<FollowupKey, StatusDef> = {
  active: { label: "Active", tone: "info" },
  paused: { label: "Paused", tone: "neutral" },
  held: { label: "Held — customer has paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  plan_agreed: { label: "Paused — plan agreed", tone: "review" },
};

// ---------- case workflow ----------

export const caseStatus: Record<CaseStatus, StatusDef> = {
  needs_approval: { label: "Needs approval", tone: "review" },
  needs_review: { label: "Needs review", tone: "review" },
  waiting_on_customer: { label: "Waiting on customer", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
};

export const whoActsLabel: Record<WhoActs, string> = {
  sarah: "Sarah",
  sarah_to_customer: "Sarah → customer",
  tony_approves: "Tony approves",
  tony_decides: "Tony decides",
};

/** "Who acts" filter groups (Action Queue). */
export const whoActsFilter: Record<"sarah" | "tony" | "customer", WhoActs[]> = {
  sarah: ["sarah", "sarah_to_customer"],
  tony: ["tony_approves", "tony_decides"],
  customer: ["sarah_to_customer"],
};

export const confidenceLabel: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };

// ---------- evidence ----------

export const evidenceTypeLabel: Record<EvidenceType, StatusDef> = {
  email: { label: "Message", tone: "info" },
  returns: { label: "Returns log", tone: "info" },
  bank: { label: "Bank feed", tone: "success" },
  document: { label: "Document", tone: "neutral" },
  call: { label: "Call", tone: "info" },
  history: { label: "Payment history", tone: "neutral" },
};

// ---------- AI wording (CLAUDE.md §0: never "AI verified") ----------

export const suggestionLabels = {
  suggested: "Suggested",
  possibleMatch: "Possible match — confirmation required",
  needsReview: "Needs review",
  cached: "cached",
} as const;

/** One line under the diagnosis: why chasing is (or isn't) the answer. */
export const causeHint: Record<CaseCause, string> = {
  paid_not_matched: "Customer has already paid — a reminder would chase money that is in the bank",
  invoice_issue_ours: "Not a customer problem — a chase would make it worse",
  probably_forgot: "Loyal customer — a warm nudge is enough",
  cash_flow: "Customer wants to pay — a plan works better than a firmer reminder",
  habitual_late: "Reminders have not worked — the lever is the terms, not the tone",
  blocked_on_customer_po: "Waiting on the customer's AP — a reminder will not unblock it",
  unknown: "Not enough evidence yet — review before acting",
};

/** Audit timeline dot tone by event type. */
const auditTones: Record<string, Tone> = {
  invoice_sent: "success",
  reminder_sent: "success",
  message_sent: "success",
  payment_received: "success",
  payment_matched: "success",
  reminder_held: "success",
  credit_note_approved: "success",
  plan_approved: "success",
  plan_rejected: "neutral",
  draft_saved: "neutral",
  return_logged: "info",
  invoice_corrected: "info",
  reply_received: "info",
  reminders_paused: "info",
  case_classified: "review",
  diagnosis_rejected: "review",
  plan_proposed: "review",
  call_approved: "review",
  call_outcome_confirmed: "review",
  send_blocked: "error",
  reminder_cancelled: "neutral",
  case_resolved: "success",
  match_rejected: "review",
};

export function auditTone(type: string): Tone {
  return auditTones[type] ?? "neutral";
}
