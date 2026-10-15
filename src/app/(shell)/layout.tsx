import { TopBar } from "@/components/shell/TopBar";
import { Sidebar } from "@/components/shell/Sidebar";

// Phase 4 replaces this with the count of open cases from the DB.
const PLACEHOLDER_QUEUE_COUNT = 5;

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-kc-bg text-kc-text">
      <TopBar />
      <div className="flex flex-1">
        <Sidebar queueCount={PLACEHOLDER_QUEUE_COUNT} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 pt-6 pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
