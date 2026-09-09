"use client";

import { usePathname } from "next/navigation";

function useContextLabel(): string {
  const pathname = usePathname();
  if (pathname.startsWith("/creator")) {
    if (pathname.endsWith("/findings")) return "Findings";
    if (pathname.endsWith("/state")) return "Story State";
    return "Ingest";
  }
  if (pathname.startsWith("/viewer")) return "Audience Companion";
  return "SceneStory";
}

export function TopBarContext() {
  const label = useContextLabel();
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="hidden text-sm font-semibold text-foreground sm:block">
        SceneStory
      </span>
    </div>
  );
}
