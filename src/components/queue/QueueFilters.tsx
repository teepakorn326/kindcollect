"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type FilterOption = { value: string; label: string };
export type FilterDef = { key: string; label: string; options: FilterOption[]; defaultValue: string };

/** Filter bar for the Action Queue. State lives in the URL so the server does the filtering. */
export function QueueFilters({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    startTransition(() => router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {filters.map((f) => {
        const value = params.get(f.key) ?? f.defaultValue;
        const id = `filter-${f.key}`;
        return (
          <div
            key={f.key}
            className="flex h-9 items-center gap-1.5 rounded-kc-input border border-kc-border bg-kc-surface pl-2.5 text-[13px] text-kc-muted"
          >
            <span id={id}>{f.label}</span>
            <Select value={value} onValueChange={(v) => set(f.key, v, f.defaultValue)}>
              <SelectTrigger
                aria-labelledby={id}
                className="h-8 border-0 bg-transparent pl-0 font-medium text-kc-text shadow-none focus-visible:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="md"
        className="text-[13px] text-kc-muted"
        onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
      >
        Clear
      </Button>
    </div>
  );
}
