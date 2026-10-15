import type { Confidence } from "@prisma/client";
import { confidenceLabel, suggestionLabels } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Teal-tint panel for an AI/rule suggestion. Always labelled "Suggested", never "verified". */
export function SuggestionPanel({
  title,
  body,
  confidence,
  evidenceIds = [],
  chip = suggestionLabels.suggested,
  cached = false,
  id,
  className,
  children,
}: {
  title: string;
  body?: React.ReactNode;
  confidence?: Confidence;
  evidenceIds?: string[];
  chip?: string;
  cached?: boolean;
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn(
        "flex flex-col gap-3 rounded-[10px] border border-kc-primary-line bg-kc-primary-tint p-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-[0.06em] text-kc-primary uppercase">{title}</h2>
        <div className="flex items-center gap-2 text-[11px] text-kc-muted">
          {confidence && <span>{confidenceLabel[confidence]} confidence</span>}
          {cached && (
            <span className="rounded-kc-badge border border-kc-border bg-kc-surface px-1.5 py-px">
              {suggestionLabels.cached}
            </span>
          )}
          <span className="rounded-kc-badge border border-kc-primary-line bg-kc-surface px-2 py-0.5 font-semibold text-kc-primary">
            {chip}
          </span>
        </div>
      </div>
      {body && <div className="text-[15px] font-medium">{body}</div>}
      {children}
      {evidenceIds.length > 0 && (
        <p className="text-xs text-kc-muted">
          Based on{" "}
          {evidenceIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <a href={`#${id}`} className="font-medium">
                source {i + 1}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
