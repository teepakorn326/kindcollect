import { TopBar } from "@/components/shell/TopBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { getOpenCaseCount } from "@/lib/cases";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const queueCount = await getOpenCaseCount();
  return (
    <div className="flex min-h-screen flex-col bg-kc-bg text-kc-text">
      <TopBar />
      <div className="flex flex-1">
        <Sidebar queueCount={queueCount} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-8 pt-6 pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
