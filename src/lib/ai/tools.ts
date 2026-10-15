// Tool definitions (JSON schema, strict) + zod validators for the tool inputs Claude returns.
// The model only ever *suggests*: causes from a closed enum, text, and ids that reference our own data.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const CAUSES = [
  "paid_not_matched",
  "invoice_issue_ours",
  "probably_forgot",
  "cash_flow",
  "habitual_late",
  "blocked_on_customer_po",
  "unknown",
] as const;

const confidence = z.enum(["low", "medium", "high"]);

export const classifyOutput = z.object({
  cause: z.enum(CAUSES),
  summary: z.string().min(1).max(600),
  suggested_action: z.string().min(1).max(120),
  confidence,
  evidence_ids: z.array(z.string()).max(8),
});
export type ClassifyOutput = z.infer<typeof classifyOutput>;

export const draftOutput = z.object({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(2000),
  facts_used: z.array(z.string()).max(12),
});
export type DraftOutput = z.infer<typeof draftOutput>;

export const callOutcomeOutput = z.object({
  invoice_received: z.boolean().nullable(),
  blocker: z.string().max(200).nullable(),
  commitment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  dispute_raised: z.boolean(),
  confidence,
  quotes: z.array(z.string().max(300)).max(3),
});
export type CallOutcomeOutput = z.infer<typeof callOutcomeOutput>;

const str = { type: "string" } as const;
const conf = { type: "string", enum: ["low", "medium", "high"] } as const;

export const toolDefs = {
  classify_case: {
    name: "classify_case",
    description: "Record the diagnosed cause of one overdue invoice, with the ids of the evidence that supports it.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["cause", "summary", "suggested_action", "confidence", "evidence_ids"],
      properties: {
        cause: { type: "string", enum: [...CAUSES] },
        summary: { ...str, description: "Two plain-English sentences for the bookkeeper." },
        suggested_action: { ...str, description: "Short imperative phrase, under 10 words." },
        confidence: conf,
        evidence_ids: { type: "array", items: str, description: "Ids from the input that support the cause." },
      },
    },
  },
  draft_message: {
    name: "draft_message",
    description: "Record an email draft from Tony to the customer. Sarah reviews it before anything is sent.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "body", "facts_used"],
      properties: {
        subject: str,
        body: { ...str, description: "Plain-text email body. Use [PAY LINK] as the pay-link placeholder." },
        facts_used: { type: "array", items: str, description: "Ids of the facts the draft relies on." },
      },
    },
  },
  extract_call_outcome: {
    name: "extract_call_outcome",
    description: "Record what the customer said on the call.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["invoice_received", "blocker", "commitment_date", "dispute_raised", "confidence", "quotes"],
      properties: {
        invoice_received: { type: ["boolean", "null"] },
        blocker: { type: ["string", "null"] },
        commitment_date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        dispute_raised: { type: "boolean" },
        confidence: conf,
        quotes: { type: "array", items: str },
      },
    },
  },
} satisfies Record<string, Anthropic.Beta.BetaTool>;

export type ToolName = keyof typeof toolDefs;

export type ToolOutputs = {
  classify_case: ClassifyOutput;
  draft_message: DraftOutput;
  extract_call_outcome: CallOutcomeOutput;
};

export const validators: { [K in ToolName]: z.ZodType<ToolOutputs[K]> } = {
  classify_case: classifyOutput,
  draft_message: draftOutput,
  extract_call_outcome: callOutcomeOutput,
};

export const promptFile: Record<ToolName, string> = {
  classify_case: "classify-case.md",
  draft_message: "draft-message.md",
  extract_call_outcome: "extract-call-outcome.md",
};
