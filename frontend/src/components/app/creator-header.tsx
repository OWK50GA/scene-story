"use client";

import { useQuery } from "@tanstack/react-query";

import { CreatorTabs } from "@/components/app/creator-tabs";
import { Badge } from "@/components/ui/badge";
import { getUnitStatus, listStoryUnits } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export function CreatorHeader() {
  const { workspace } = useWorkspace();
  const { projectId, storyUnitId } = workspace;

  const unitsQuery = useQuery({
    queryKey: ["project-units", projectId],
    queryFn: () => listStoryUnits(projectId as string),
    enabled: Boolean(projectId),
  });

  const statusQuery = useQuery({
    queryKey: ["unit-status", storyUnitId],
    queryFn: () => getUnitStatus(storyUnitId as string),
    enabled: Boolean(storyUnitId),
    refetchInterval: (query) =>
      query.state.data?.ingestionStatus === "ingesting" ? 4000 : false,
  });

  const unit = unitsQuery.data?.find((u) => u.storyUnitId === storyUnitId);
  const status = statusQuery.data;

  const title = unit?.title ?? "No story selected";
  const subtitle = unit?.unitType ?? "—";
  const counts =
    status !== undefined
      ? `${status.sceneCount} scenes · ${status.claimCount} claims`
      : "—";

  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-5">
      <span className="text-sm font-semibold">{title}</span>
      <Badge
        variant="outline"
        className="hidden text-xs text-muted-foreground sm:inline-flex"
      >
        {subtitle}
      </Badge>
      <div className="ml-4 hidden h-6 w-px bg-border md:block" aria-hidden />
      <CreatorTabs />
      <div className="ml-auto hidden font-mono text-[11px] tracking-wide text-muted-foreground lg:block">
        {counts}
      </div>
    </div>
  );
}
