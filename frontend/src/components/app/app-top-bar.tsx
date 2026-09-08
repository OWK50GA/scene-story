"use client";

import { ThemeSwitcher } from "@/components/app/theme-switcher";
import { TopBarContext } from "@/components/app/top-bar-context";

export function AppTopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-5">
      <TopBarContext />
      <div className="ml-auto flex items-center gap-3">
        <ThemeSwitcher />
        <div
          aria-hidden
          className="flex h-8 w-8 items-center justify-center border border-border bg-muted font-mono text-[11px] font-medium text-muted-foreground"
        >
          YOU
        </div>
      </div>
    </header>
  );
}
