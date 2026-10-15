// Claude wrapper — tool use only, cached fallback (CLAUDE.md §6):
// hash input → check AiResult → call Claude (8 s timeout) → validate → store; on timeout/error use the cached row.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { promptFile, toolDefs, validators, type ToolName, type ToolOutputs } from "./tools";

// 8 s per CLAUDE.md §0; overridable only to test the cached fallback
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 8_000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 0, timeout: AI_TIMEOUT_MS }));

const promptCache = new Map<string, string>();
function systemPrompt(tool: ToolName): string {
  const file = promptFile[tool];
  if (!promptCache.has(file)) {
    promptCache.set(file, readFileSync(path.join(process.cwd(), "src/lib/ai/prompts", file), "utf8"));
  }
  return promptCache.get(file)!;
}

/** Deterministic JSON (sorted keys) so identical inputs hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function inputHash(tool: ToolName, input: unknown): string {
  // prompt text is part of the key: editing a prompt invalidates its cache
  return createHash("sha256").update(`${tool}\n${systemPrompt(tool)}\n${stableStringify(input)}`).digest("hex");
}

export type AiOutcome<T> = {
  output: T;
  /** true when the result came from the AiResult cache rather than a live call */
  cached: boolean;
  /** why the live call was skipped or failed (shown in logs, not to customers) */
  reason?: "cache_hit" | "timeout" | "error" | "no_api_key";
  latencyMs?: number;
  model: string;
};

export class AiUnavailableError extends Error {}

/**
 * Run one tool call. `preferCache`: return a stored result for the same input without calling Claude
 * (stable demo, zero cost); set false to force a fresh call (e.g. "Re-diagnose").
 */
export async function runTool<K extends ToolName>(
  tool: K,
  input: unknown,
  opts: { preferCache?: boolean } = {}
): Promise<AiOutcome<ToolOutputs[K]>> {
  type Out = ToolOutputs[K];
  const hash = inputHash(tool, input);
  const cachedRow = await db.aiResult.findUnique({ where: { inputHash: hash } });
  const fromCache = (reason: AiOutcome<Out>["reason"]): AiOutcome<Out> => ({
    output: validators[tool].parse(cachedRow!.output) as Out,
    cached: true,
    reason,
    model: cachedRow!.model,
  });

  if (cachedRow && (opts.preferCache ?? true)) return fromCache("cache_hit");
  if (!process.env.ANTHROPIC_API_KEY) {
    if (cachedRow) return fromCache("no_api_key");
    throw new AiUnavailableError("AI is not configured (ANTHROPIC_API_KEY missing) and no cached result exists.");
  }

  const started = Date.now();
  try {
    const response = await getClient().beta.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        // refusal → server re-runs on a fallback model inside the same call
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: systemPrompt(tool), cache_control: { type: "ephemeral" } }],
        tools: [toolDefs[tool]],
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: `${stableStringify(input)}\n\nCall the ${tool} tool exactly once with your answer.`,
          },
        ],
      },
      { timeout: AI_TIMEOUT_MS, maxRetries: 0 }
    );
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const block = response.content.find((b) => b.type === "tool_use" && b.name === tool);
    if (!block || block.type !== "tool_use") throw new Error(`no ${tool} tool call in response (stop: ${response.stop_reason})`);
    const output = validators[tool].parse(block.input) as Out;
    const latencyMs = Date.now() - started;

    await db.aiResult.upsert({
      where: { inputHash: hash },
      create: { tool, inputHash: hash, input: input as Prisma.InputJsonValue, output: output as Prisma.InputJsonValue, model: response.model, latencyMs },
      update: { output: output as Prisma.InputJsonValue, model: response.model, latencyMs },
    });
    return { output, cached: false, latencyMs, model: response.model };
  } catch (e) {
    const timeout = e instanceof Anthropic.APIConnectionTimeoutError;
    console.warn(`[ai] ${tool} ${timeout ? "timed out" : "failed"} after ${Date.now() - started}ms:`, e instanceof Error ? e.message : e);
    if (cachedRow) return fromCache(timeout ? "timeout" : "error");
    throw new AiUnavailableError(timeout ? "Claude took longer than 8 s and there is no cached result yet." : "Claude could not complete this request and there is no cached result yet.");
  }
}
