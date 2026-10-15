import { CircleCheckBig, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DemoBadge } from "@/components/domain/DemoBadge";
import { BusinessSelector } from "@/components/shell/BusinessSelector";
import { currentUser } from "@/lib/current-user";

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-kc-border bg-kc-surface px-6">
      <div className="flex w-[216px] items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-kc-input bg-kc-primary">
          <CircleCheckBig className="size-4 text-kc-surface" strokeWidth={2.2} aria-hidden />
        </div>
        <span className="text-base font-bold tracking-[-0.01em]">KindCollect</span>
      </div>
      <BusinessSelector />
      <label className="flex h-9 min-w-[160px] max-w-[420px] flex-[1_1_240px] items-center gap-2 rounded-kc-input border border-kc-border bg-kc-bg px-3 text-kc-muted">
        <Search className="size-4" aria-hidden />
        <Input
          type="search"
          placeholder="Search invoices, customers, references…"
          aria-label="Search invoices, customers, references"
          className="h-8 border-0 bg-transparent px-0 text-kc-text shadow-none focus-visible:ring-0"
        />
      </label>
      <div className="flex-1" />
      <DemoBadge />
      <button
        type="button"
        aria-label={`Account menu — ${currentUser.name}`}
        className="size-8 cursor-pointer rounded-kc-badge border border-kc-border bg-kc-primary-soft text-xs font-semibold text-kc-primary"
      >
        {currentUser.initials}
      </button>
    </header>
  );
}
