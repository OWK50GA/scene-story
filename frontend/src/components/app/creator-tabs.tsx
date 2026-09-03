"use client";

import { FileSearch, ScanSearch, UploadCloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/creator/ingest", label: "Ingest", icon: UploadCloud },
  { href: "/creator/state", label: "Story State", icon: ScanSearch },
  { href: "/creator/findings", label: "Findings", icon: FileSearch },
] as const;

export function CreatorTabs() {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.href)) ?? TABS[0];

  return (
    <nav aria-label="Creator" className="flex h-full items-center gap-1">
      {TABS.map((tab) => {
        const isActive = tab.href === active.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex h-full items-center gap-1.5 px-3 text-sm transition-colors",
              isActive
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              className={cn("h-4 w-4", isActive && "text-primary")}
              aria-hidden
            />
            {tab.label}
            {isActive ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
