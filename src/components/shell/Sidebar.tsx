"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, FileText, LayoutGrid, ListChecks, Settings, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; match: string; label: string; icon: LucideIcon };

const mainNav: NavItem[] = [
  { href: "/overview", match: "/overview", label: "Overview", icon: LayoutGrid },
  { href: "/queue", match: "/queue", label: "Action Queue", icon: ListChecks },
  { href: "/invoices/new", match: "/invoices", label: "Invoices", icon: FileText },
  { href: "/payments", match: "/payments", label: "Payments", icon: Banknote },
  { href: "/customers", match: "/customers", label: "Customers", icon: Users },
];
const settingsNav: NavItem = { href: "/settings", match: "/settings", label: "Settings", icon: Settings };

export function Sidebar({ queueCount }: { queueCount: number }) {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-kc-input px-3 py-[9px]",
          active ? "bg-kc-primary-soft font-semibold text-kc-primary" : "font-medium text-kc-text hover:bg-kc-bg"
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
        {item.label}
        {item.match === "/queue" && queueCount > 0 && (
          <span
            className="ml-auto rounded-kc-badge bg-kc-primary px-2 py-px text-[11px] font-semibold text-kc-surface"
            aria-label={`${queueCount} actions`}
          >
            {queueCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-kc-border bg-kc-surface px-3 py-4"
    >
      {mainNav.map(renderItem)}
      <div className="flex-1" />
      {renderItem(settingsNav)}
    </nav>
  );
}
