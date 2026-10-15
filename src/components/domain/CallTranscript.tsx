import { cn } from "@/lib/utils";

export type TranscriptTurn = { speaker: "agent" | "customer"; text: string; name?: string };

/** Agent turns teal, customer turns grey. `live` shows a typing indicator after the last turn. */
export function CallTranscript({ turns, live = false, customerName = "Customer" }: { turns: TranscriptTurn[]; live?: boolean; customerName?: string }) {
  return (
    <ol className="flex flex-col gap-3 text-[13px]" aria-live={live ? "polite" : undefined}>
      {turns.map((t, i) => (
        <li key={i} className={cn("flex flex-col gap-1", t.speaker === "customer" && "items-end")}>
          <span className="text-[11px] font-semibold text-kc-muted">
            {t.speaker === "agent" ? "KindCollect" : (t.name ?? customerName)}
          </span>
          <p
            className={cn(
              "max-w-[85%] rounded-[10px] px-3 py-2",
              t.speaker === "agent" ? "bg-kc-primary-tint text-kc-text ring-1 ring-kc-primary-line" : "bg-kc-bg ring-1 ring-kc-border"
            )}
          >
            {t.text}
          </p>
        </li>
      ))}
      {live && (
        <li className="text-xs text-kc-muted" aria-label="Call in progress">
          Speaking…
        </li>
      )}
    </ol>
  );
}
