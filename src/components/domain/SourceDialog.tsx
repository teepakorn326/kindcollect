"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** A text link that opens the original source (email, returns record, invoice) in a dialog. */
export function SourceDialog({
  trigger,
  title,
  description,
  children,
  muted = false,
  asButton = false,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  muted?: boolean;
  /** render the trigger as an outline button instead of a link */
  asButton?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          "cursor-pointer",
          asButton
            ? "inline-flex h-9 items-center rounded-kc-input border border-kc-border bg-kc-surface px-3.5 text-sm font-medium text-kc-text hover:bg-kc-bg"
            : muted
              ? "text-kc-muted hover:text-kc-text"
              : "font-semibold text-kc-primary hover:text-kc-primary-hover"
        )}
      >
        {trigger}
      </DialogTrigger>
      <DialogContent className="rounded-kc-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto text-[13px]">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
