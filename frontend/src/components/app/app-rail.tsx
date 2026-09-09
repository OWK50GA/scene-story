"use client";

import {
  Clapperboard,
  type LucideIcon,
  MessageCircleQuestionMark,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  activePrefix: string;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  {
    href: "/creator/ingest",
    activePrefix: "/creator",
    label: "Creator",
    icon: Clapperboard,
  },
  {
    href: "/viewer",
    activePrefix: "/viewer",
    label: "Viewer",
    icon: MessageCircleQuestionMark,
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  const base = item.activePrefix ?? item.href;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function AppRail() {
  const pathname = usePathname();

  return (
    <aside className="flex w-[76px] shrink-0 flex-col items-center overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <Link
        href="/creator/ingest"
        aria-label="SceneStory home"
        className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
      >
        <Clapperboard className="h-5 w-5" />
      </Link>

      <nav
        aria-label="Primary"
        className="mt-8 flex w-full flex-1 flex-col items-center gap-2"
      >
        {NAV.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex w-[64px] flex-col items-center gap-1 rounded-lg px-2 py-3 text-xs transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {active ? (
                <span className="absolute top-1/2 left-0 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
              ) : null}
              <Icon className="h-5 w-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="pb-4 font-mono text-[10px] tracking-widest text-sidebar-foreground/40 uppercase">
        v1
      </div>
    </aside>
  );
}
