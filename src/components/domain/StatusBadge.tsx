import type { CaseCause } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  causeStatus,
  followupStatus,
  paymentStatus,
  toneClasses,
  type FollowupKey,
  type PaymentStatusKey,
  type StatusDef,
} from "@/lib/status";

type Props = (
  | { kind: "payment"; value: PaymentStatusKey }
  | { kind: "cause"; value: CaseCause }
  | { kind: "followup"; value: FollowupKey }
) & {
  /** muted prefix inside the pill, e.g. "Payment" → "Payment Unpaid" */
  prefix?: string;
  /** use the long cause label ("Invoice issue — our side") */
  long?: boolean;
  className?: string;
};

/** Status = label + colour, never colour alone. Labels come from lib/status.ts only. */
export function StatusBadge(props: Props) {
  let def: StatusDef;
  if (props.kind === "cause") {
    const c = causeStatus[props.value];
    def = { label: props.long ? c.long : c.label, tone: c.tone };
  } else if (props.kind === "payment") {
    def = paymentStatus[props.value];
  } else {
    def = followupStatus[props.value];
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-kc-badge text-xs font-semibold whitespace-nowrap",
        props.prefix ? "px-2.5 py-1" : "px-2.5 py-[3px]",
        toneClasses[def.tone].badge,
        props.className
      )}
    >
      {props.prefix && <span className="font-medium text-kc-muted">{props.prefix}</span>}
      {def.label}
    </span>
  );
}
