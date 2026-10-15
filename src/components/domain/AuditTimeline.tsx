import type { AuditEvent } from "@prisma/client";
import { formatDay, formatRelative } from "@/lib/format";
import { auditTone, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

type TimelineEvent = Pick<AuditEvent, "id" | "at" | "actor" | "type" | "summary" | "detail">;

/**
 * Audit trail, oldest → newest (newest last). "row" = Case Detail strip, "list" = vertical feed.
 * Sub-line: "<date> · <detail or actor>".
 */
export function AuditTimeline({
  events,
  layout = "row",
  pending,
  relative = false,
}: {
  events: TimelineEvent[];
  layout?: "row" | "list";
  /** hollow last step, e.g. { label: "Awaiting Sarah's approval", sub: "Now" } */
  pending?: { label: string; sub: string };
  relative?: boolean;
}) {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const when = (d: Date) => (relative ? formatRelative(d) : formatDay(d));

  return (
    <ol className={cn("text-[13px]", layout === "row" ? "flex flex-wrap gap-6" : "flex flex-col gap-2.5")}>
      {sorted.map((e) => (
        <li key={e.id} className={cn("flex items-start gap-2.5", layout === "row" && "flex-[1_1_180px]")}>
          <span className={cn("mt-[5px] size-2.5 shrink-0 rounded-full", toneClasses[auditTone(e.type)].dot)} aria-hidden />
          <div>
            <div className="font-semibold">{e.summary}</div>
            <div className="text-kc-muted">
              {when(e.at)} · {e.detail ?? e.actor}
            </div>
          </div>
        </li>
      ))}
      {pending && (
        <li className={cn("flex items-start gap-2.5", layout === "row" && "flex-[1_1_180px]")}>
          <span className="mt-[5px] size-2.5 shrink-0 rounded-full border-2 border-kc-muted/60 bg-kc-surface" aria-hidden />
          <div>
            <div className="font-semibold text-kc-muted">{pending.label}</div>
            <div className="text-kc-muted">{pending.sub}</div>
          </div>
        </li>
      )}
    </ol>
  );
}
