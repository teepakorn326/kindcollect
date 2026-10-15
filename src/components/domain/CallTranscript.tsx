import { cn } from "@/lib/utils";

export type TranscriptTurn = { speaker: "agent" | "customer"; text: string };

/** Agent turns teal (left), customer turns grey (right). `live` adds a "Speaking…" bubble. Phrases in `marks` get <mark>. */
export function CallTranscript({
  turns,
  live = false,
  customerLabel = "Customer",
  marks = [],
}: {
  turns: TranscriptTurn[];
  live?: boolean;
  customerLabel?: string;
  marks?: string[];
}) {
  const render = (text: string) => {
    const hits = marks.filter((m) => m && text.toLowerCase().includes(m.toLowerCase()));
    if (!hits.length) return text;
    const re = new RegExp(`(${hits.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re).map((part, i) =>
      i % 2 ? (
        <mark key={i} className="rounded-sm bg-kc-status-review-bg px-0.5 text-kc-text">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <ol className="flex flex-col gap-3.5 text-sm" aria-live={live ? "polite" : undefined}>
      {turns.map((t, i) => (
        <li key={i} className={cn("flex gap-2.5", t.speaker === "customer" && "justify-end")}>
          {t.speaker === "agent" && <span className="w-16 shrink-0 pt-[3px] text-xs font-semibold text-kc-primary">KindCollect</span>}
          <p
            className={cn(
              "max-w-[520px] px-3.5 py-2.5",
              t.speaker === "agent" ? "rounded-[10px_10px_10px_2px] bg-kc-primary-tint" : "rounded-[10px_10px_2px_10px] bg-kc-border/50"
            )}
          >
            {render(t.text)}
          </p>
          {t.speaker === "customer" && <span className="w-16 shrink-0 pt-[3px] text-xs font-semibold text-kc-muted">{customerLabel}</span>}
        </li>
      ))}
      {live && (
        <li className="flex justify-end gap-2.5" aria-label="Call in progress">
          <p className="rounded-[10px_10px_2px_10px] bg-kc-border/50 px-3.5 py-2.5 text-kc-muted italic">Speaking…</p>
          <span className="w-16 shrink-0 pt-[3px] text-xs font-semibold text-kc-muted">{customerLabel}</span>
        </li>
      )}
      {turns.length === 0 && !live && <li className="text-[13px] text-kc-muted">No transcript yet.</li>}
    </ol>
  );
}
