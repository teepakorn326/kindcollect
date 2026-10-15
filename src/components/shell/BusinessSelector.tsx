"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Only Fresh Harvest Produce has data; the others show Sarah manages ~40 businesses.
const businesses = ["Fresh Harvest Produce", "Parramatta Plumbing", "Lane Cove Dental"];

export function BusinessSelector() {
  return (
    <div className="flex h-9 items-center gap-2 rounded-kc-input border border-kc-border bg-kc-bg pl-3 text-[13px] text-kc-muted">
      <span id="business-label">Business</span>
      <Select defaultValue={businesses[0]}>
        <SelectTrigger
          aria-labelledby="business-label"
          className="h-8 border-0 bg-transparent pl-0 font-semibold text-kc-text shadow-none focus-visible:ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {businesses.map((b) => (
            <SelectItem key={b} value={b} disabled={b !== businesses[0]}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
