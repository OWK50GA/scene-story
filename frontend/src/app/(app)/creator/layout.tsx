import type { ReactNode } from "react";

import { CreatorTabs } from "@/components/app/creator-tabs";
import { Badge } from "@/components/ui/badge";

export default function CreatorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-5">
        <span className="text-sm font-semibold">The Voss Cipher</span>
        <Badge
          variant="outline"
          className="hidden text-xs text-muted-foreground sm:inline-flex"
        >
          film-a
        </Badge>
        <div className="ml-4 hidden h-6 w-px bg-border md:block" aria-hidden />
        <CreatorTabs />
        <div className="ml-auto hidden font-mono text-[11px] tracking-wide text-muted-foreground lg:block">
          13 scenes · 28 claims
        </div>
      </div>
      <div className="scroll-stable min-h-0 flex-1 overflow-y-auto bg-surface p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}
