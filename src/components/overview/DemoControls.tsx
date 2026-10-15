"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { formatAud } from "@/lib/money";

/** Demo-data controls: pull the next seeded bank line; reset the scenario (confirm first). */
export function SyncBankButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await fetch("/api/demo/sync-bank", { method: "POST" }).then((x) => x.json());
          if (!r.inserted) {
            toast({ title: "Bank feed is up to date", description: "No new lines." });
          } else {
            toast({
              title: `New bank line · ${formatAud(r.inserted.amountCents)}`,
              description:
                r.match.kind === "possible_match"
                  ? `Possible match to ${r.match.invoiceNumber} — confirmation required.${r.heldDrafts ? " Reminder held." : ""}`
                  : "No safe match by rule — left in suspense.",
            });
          }
          router.refresh();
        })
      }
      className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-kc-primary hover:text-kc-primary-hover disabled:cursor-wait disabled:opacity-60"
    >
      <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
      {pending ? "Syncing…" : "Sync bank feed"}
    </button>
  );
}

export function ResetDemoButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="md" className="text-kc-muted" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden />
        Reset demo data
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="rounded-kc-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>
              Restores Fresh Harvest Produce to Monday morning: every match, credit note, email and plan made since is removed. The AI
              cache is kept. Takes about 15 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="md" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await fetch("/api/demo/reset", { method: "POST" }).then((x) => x.json());
                  toast(r.ok ? { title: "Demo data reset" } : { variant: "destructive", title: "Reset failed" });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Resetting…" : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
