// Voice calls (Vapi): start (guarded in code), webhook ingestion, outcome extraction, rehearsal fallback.
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { now, sydneyYmd } from "./clock";
import { appUrl } from "./app-url";
import { formatDate } from "./format";
import { callGuard } from "./rules";
import { runTool } from "./ai/client";
import type { CallOutcomeOutput } from "./ai/tools";
import { REHEARSAL_CALL_DATE, REHEARSAL_OUTCOME, REHEARSAL_TURNS } from "./demo/call-rehearsal";
import { AiUnavailableError } from "./ai/client";

export type Turn = { speaker: "agent" | "customer"; text: string };
export type StoredOutcome = CallOutcomeOutput & { cached: boolean; source: "live" | "rehearsal" };

export const asTurns = (v: Prisma.JsonValue | null): Turn[] => (Array.isArray(v) ? (v as Turn[]) : []);
export const asOutcome = (v: Prisma.JsonValue | null): StoredOutcome | null => (v && typeof v === "object" ? (v as unknown as StoredOutcome) : null);

/** Rehearsal audio: the real team recording (.mp3) when present, else the rendered placeholder (.m4a). */
export function rehearsalRecordingUrl(): string {
  try {
    readFileSync(path.join(process.cwd(), "public/demo/harbourside-call.mp3"));
    return "/demo/harbourside-call.mp3";
  } catch {
    return "/demo/harbourside-call.m4a";
  }
}

export async function previousCallStarts(customerId: string, exceptId: string) {
  const calls = await db.call.findMany({ where: { customerId, id: { not: exceptId }, startedAt: { not: null }, source: { not: "rehearsal" } }, select: { startedAt: true } });
  return calls.map((c) => c.startedAt!);
}

const spokenAmount = (cents: number) => `${new Intl.NumberFormat("en-AU").format(Math.round(cents / 100))} dollars`;

// ---------------------------------------------------------------- start

export class CallError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** POST /api/calls/start — Tony's approval, hours and frequency are checked here, in code. */
export async function startCall(callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { customer: true, invoice: true } });
  if (!call) throw new CallError("Call not found", 404);
  if (call.status !== "approved") throw new CallError(call.status === "draft" ? "Tony has not approved this call." : "This call has already been made.");

  const at = now();
  const guard = callGuard({ at, approved: !!call.approvedBy, previousCallStarts: await previousCallStarts(call.customerId, call.id) });
  if (!guard.allowed) throw new CallError(guard.detail, 409);

  const apiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const callee = process.env.VAPI_DEMO_CALLEE_NUMBER || call.phoneNumber.replace(/\s/g, "");
  if (!apiKey || !phoneNumberId) throw new CallError("Vapi is not configured (VAPI_API_KEY / VAPI_PHONE_NUMBER_ID). Use “Play recording”.", 503);

  const base = appUrl();
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? "";
  const inv = call.invoice;
  const variables = {
    customer_name: call.customer.name,
    invoice_number: inv.number,
    invoice_date: formatDate(inv.issueDate),
    po_number: inv.poNumber ?? "none",
    amount_spoken: spokenAmount(inv.totalCents),
    due_date: formatDate(inv.dueDate),
  };
  const firstMessage = `Hi, this is an automated assistant calling on behalf of Tony at Fresh Harvest Produce. This call is recorded. I'm checking on invoice ${inv.number} for ${variables.amount_spoken}. Could I confirm it's with the right person?`;
  const server = { url: `${base}/api/vapi/webhook`, headers: { "x-vapi-secret": secret } };

  const body = process.env.VAPI_ASSISTANT_ID
    ? {
        phoneNumberId,
        customer: { number: callee },
        assistantId: process.env.VAPI_ASSISTANT_ID,
        assistantOverrides: { variableValues: variables, firstMessage, server },
      }
    : {
        phoneNumberId,
        customer: { number: callee },
        assistant: {
          firstMessage,
          maxDurationSeconds: 240,
          model: {
            provider: "anthropic",
            model: process.env.VAPI_MODEL || "claude-sonnet-4-6",
            messages: [
              {
                role: "system",
                content: readFileSync(path.join(process.cwd(), "src/lib/ai/prompts/voice-agent.md"), "utf8").replace(
                  /\{\{(\w+)\}\}/g,
                  (_, k: keyof typeof variables) => variables[k] ?? ""
                ),
              },
            ],
          },
          server,
          serverMessages: ["transcript", "status-update", "end-of-call-report"],
        },
      };

  const res = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: unknown };
  if (!res.ok || !json.id) throw new CallError(`Vapi refused the call (${res.status}): ${JSON.stringify(json.message ?? json).slice(0, 200)}`, 502);

  await db.$transaction([
    db.call.update({ where: { id: call.id }, data: { status: "in_progress", vapiCallId: json.id, startedAt: at, transcript: [], source: "live" } }),
    db.auditEvent.create({
      data: {
        businessId: call.customer.businessId, caseId: call.caseId, customerId: call.customerId, invoiceId: call.invoiceId, at,
        actor: "Sarah", type: "call_started", summary: "AI call started · Accounts Payable", detail: "recorded · caller informed",
        data: { vapiCallId: json.id },
      },
    }),
  ]);
  return { vapiCallId: json.id };
}

// ---------------------------------------------------------------- webhook

export function verifyVapiSecret(headers: Headers): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return false;
  const got = headers.get("x-vapi-secret") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type VapiMessage = {
  type?: string;
  call?: { id?: string };
  role?: string;
  transcriptType?: string;
  transcript?: string;
  status?: string;
  endedReason?: string;
  recordingUrl?: string;
  artifact?: {
    transcript?: string;
    messages?: { role?: string; message?: string }[];
    recordingUrl?: string;
    recording?: { url?: string; mono?: { combinedUrl?: string }; stereoUrl?: string };
  };
};

const speakerOf = (role?: string): Turn["speaker"] | null =>
  role === "assistant" || role === "bot" ? "agent" : role === "user" || role === "customer" ? "customer" : null;

/** Handle one Vapi server message. Returns what happened (for logs/tests). */
export async function handleVapiMessage(msg: VapiMessage) {
  const vapiCallId = msg.call?.id;
  if (!vapiCallId) return { ignored: "no call id" };
  const call = await db.call.findUnique({ where: { vapiCallId }, include: { customer: true } });
  if (!call) return { ignored: "unknown call" };
  const type = msg.type ?? "";

  if (type.startsWith("transcript")) {
    const final = type.includes("final") || msg.transcriptType === "final";
    const speaker = speakerOf(msg.role);
    if (!final || !speaker || !msg.transcript?.trim()) return { ignored: "partial transcript" };
    // atomic append — Vapi can deliver transcript events concurrently
    const turn = JSON.stringify([{ speaker, text: msg.transcript.trim() }]);
    await db.$executeRaw`UPDATE "Call" SET "transcript" = COALESCE("transcript", '[]'::jsonb) || ${turn}::jsonb WHERE "id" = ${call.id}`;
    return { appended: speaker };
  }

  if (type === "status-update") {
    if (msg.status === "in-progress" && call.status !== "in_progress") await db.call.update({ where: { id: call.id }, data: { status: "in_progress" } });
    return { status: msg.status };
  }

  if (type === "end-of-call-report") {
    const fromReport = (msg.artifact?.messages ?? [])
      .map((m) => ({ speaker: speakerOf(m.role), text: (m.message ?? "").trim() }))
      .filter((t): t is Turn => !!t.speaker && !!t.text);
    const transcript = fromReport.length ? fromReport : asTurns(call.transcript);
    const recordingUrl =
      msg.artifact?.recordingUrl ?? msg.artifact?.recording?.mono?.combinedUrl ?? msg.artifact?.recording?.url ?? msg.artifact?.recording?.stereoUrl ?? msg.recordingUrl ?? null;
    const at = now();
    await db.$transaction([
      db.call.update({ where: { id: call.id }, data: { status: "ended", endedAt: at, transcript, recordingUrl } }),
      db.auditEvent.create({
        data: {
          businessId: call.customer.businessId, caseId: call.caseId, customerId: call.customerId, invoiceId: call.invoiceId, at,
          actor: "Vapi", type: "call_ended", summary: "Call ended · transcript + recording stored", detail: msg.endedReason ?? null,
        },
      }),
    ]);
    const outcome = await extractOutcome(call.id, "live").catch((e) => ({ error: String(e) }));
    return { ended: true, outcome };
  }
  return { ignored: type };
}

// ---------------------------------------------------------------- outcome

/** extract_call_outcome on the stored transcript (cached by input). The date it returns is confirmed by Sarah before use. */
export async function extractOutcome(callId: string, source: "live" | "rehearsal") {
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { customer: true, invoice: true } });
  const turns = asTurns(call.transcript);
  const input = {
    call_date: source === "rehearsal" ? REHEARSAL_CALL_DATE : sydneyYmd(call.startedAt ?? now()),
    customer: call.customer.name,
    invoice: call.invoice.number,
    transcript: turns.map((t) => `${t.speaker === "agent" ? "Assistant" : "Customer"}: ${t.text}`).join("\n"),
  };
  let outcome: StoredOutcome;
  try {
    const r = await runTool("extract_call_outcome", input);
    outcome = { ...r.output, cached: r.cached, source };
  } catch (e) {
    // Demo fallback only: the rehearsal has a pre-filled outcome. A live call without AI stays unextracted.
    if (source !== "rehearsal" || !(e instanceof AiUnavailableError)) throw e;
    outcome = { ...REHEARSAL_OUTCOME, quotes: [...REHEARSAL_OUTCOME.quotes], cached: true, source };
  }
  await db.call.update({ where: { id: callId }, data: { outcome: outcome as unknown as Prisma.InputJsonValue } });
  return outcome;
}

/** Demo fallback: load the rehearsal recording + transcript and extract the outcome from it. */
export async function loadRehearsal(callId: string) {
  const call = await db.call.findUniqueOrThrow({ where: { id: callId }, include: { customer: true } });
  if (call.status === "in_progress") throw new CallError("A live call is in progress.");
  if (call.outcomeConfirmedAt) throw new CallError("The outcome of this call is already confirmed.");
  const at = now();
  await db.$transaction([
    db.call.update({
      where: { id: call.id },
      data: { status: "ended", source: "rehearsal", startedAt: call.startedAt ?? at, endedAt: at, transcript: REHEARSAL_TURNS, recordingUrl: rehearsalRecordingUrl() },
    }),
    db.auditEvent.create({
      data: {
        businessId: call.customer.businessId, caseId: call.caseId, customerId: call.customerId, invoiceId: call.invoiceId, at,
        actor: "Sarah", type: "call_rehearsal_loaded", summary: "Rehearsal recording loaded", detail: "demo fallback · not a live call",
      },
    }),
  ]);
  return extractOutcome(call.id, "rehearsal");
}
