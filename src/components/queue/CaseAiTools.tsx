"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/** "Re-diagnose with AI" (classify_case) and, for demo cases, "Simulate reply" (mock inbound email). */
export function CaseAiTools({ caseId, simulate }: { caseId: string; simulate?: { customer: string; label: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const call = (kind: "classify" | "simulate") =>
    start(async () => {
      setBusy(kind);
      const res = await fetch(kind === "classify" ? "/api/ai/classify" : "/api/demo/simulate-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "classify" ? { caseId, fresh: true } : { customer: simulate!.customer }),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(null);
      if (!json.ok) {
        toast({ variant: "destructive", title: kind === "classify" ? "Diagnosis not updated" : "Reply not simulated", description: json.error });
        router.refresh();
        return;
      }
      toast({
        title: kind === "classify" ? "Diagnosis updated" : "Reply received and re-diagnosed",
        description: `Suggested cause: ${String(json.classification.cause).replaceAll("_", " ")}${json.cached ? " (cached)" : ""}${json.planId ? " · plan drafted for Tony" : ""}`,
      });
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() => call("classify")}
        className="inline-flex cursor-pointer items-center gap-1 font-semibold text-kc-primary hover:text-kc-primary-hover disabled:cursor-wait disabled:opacity-60"
      >
        <Sparkles className="size-3.5" aria-hidden />
        {busy === "classify" ? "Re-diagnosing…" : "Re-diagnose with AI"}
      </button>
      {simulate && (
        <button
          type="button"
          disabled={pending}
          onClick={() => call("simulate")}
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-kc-muted hover:text-kc-text disabled:cursor-wait disabled:opacity-60"
          title="Demo data: inserts a seeded customer email"
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
          {busy === "simulate" ? "Receiving…" : simulate.label}
        </button>
      )}
    </div>
  );
}
