import { currentUser } from "@/lib/current-user";

// Phase 7 builds the full Overview from docs/mockups/Overview.html.
export default function OverviewPage() {
  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]">Good morning, {currentUser.name}</h1>
      <p className="mt-1 text-[13px] text-kc-muted">Fresh Harvest Produce</p>
    </div>
  );
}
