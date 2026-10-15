import type { Evidence, EvidenceType } from "@prisma/client";
import { FileText, History, Landmark, Mail, Phone, Undo2, type LucideIcon } from "lucide-react";
import { evidenceTypeLabel, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";

const icons: Record<EvidenceType, LucideIcon> = {
  email: Mail,
  returns: Undo2,
  bank: Landmark,
  document: FileText,
  call: Phone,
  history: History,
};

const barColour: Record<string, string> = {
  success: "border-l-kc-status-success",
  review: "border-l-kc-status-review",
  error: "border-l-kc-status-error",
  info: "border-l-kc-status-info",
  neutral: "border-l-kc-muted",
};

/** Render text with the first occurrence of `highlight` wrapped in <mark>. */
export function Highlighted({ text, highlight }: { text: string; highlight?: string | null }) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-kc-status-info-bg px-0.5 text-kc-text">{highlight}</mark>
      {text.slice(at + highlight.length)}
    </>
  );
}

/** Source evidence beside every suggestion: excerpt + where it came from + a link to the original. */
export function EvidenceCard({
  evidence,
  meta,
  children,
}: {
  evidence: Pick<Evidence, "id" | "type" | "title" | "excerpt" | "highlight">;
  /** "Hana Kim · 8 Oct, 2:15 PM" */
  meta?: string;
  /** links / dialogs to the original source */
  children?: React.ReactNode;
}) {
  const Icon = icons[evidence.type];
  const tone = evidenceTypeLabel[evidence.type].tone;
  const quoted = evidence.type === "email" || evidence.type === "call";
  const mono = evidence.type === "returns" || evidence.type === "bank";

  return (
    <article
      id={evidence.id}
      className={cn(
        "flex scroll-mt-6 flex-col gap-2 rounded-[10px] border border-l-[3px] border-kc-border px-4 py-3.5",
        barColour[tone]
      )}
    >
      <div className="flex items-center gap-2 text-xs text-kc-muted">
        <Icon className={cn("size-4", toneClasses[tone].text)} aria-hidden />
        <span className="font-semibold text-kc-text">{evidence.title}</span>
        {meta && (
          <>
            <span>·</span>
            <span>{meta}</span>
          </>
        )}
      </div>
      {quoted ? (
        <blockquote className="rounded-kc-input bg-kc-bg px-3 py-2.5 text-[13px] italic">
          “<Highlighted text={evidence.excerpt} highlight={evidence.highlight} />”
        </blockquote>
      ) : (
        <div
          className={cn(
            "rounded-kc-input bg-kc-bg px-3 py-2.5 text-[13px] whitespace-pre-line",
            mono && "font-mono text-kc-text/80"
          )}
        >
          <Highlighted text={evidence.excerpt} highlight={evidence.highlight} />
        </div>
      )}
      {children && <div className="flex gap-3 text-xs">{children}</div>}
    </article>
  );
}
