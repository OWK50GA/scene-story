"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScreenplayViewer } from "@/components/views/screenplay-viewer";
import {
  getProjectEntityNames,
  getProjectFindings,
  getUnitScenes,
  listStoryUnits,
  patchFindingStatus,
} from "@/lib/api";
import { findingToDomain } from "@/lib/api/domain-adapters";
import type { FindingStatus } from "@/lib/domain";
import { parseScreenplay } from "@/lib/screenplay";
import { useWorkspace } from "@/lib/workspace-context";

export function ScreenplayScreen() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { projectId, storyUnitId } = workspace;

  const unitsQuery = useQuery({
    queryKey: ["project-units", projectId],
    queryFn: () => listStoryUnits(projectId as string),
    enabled: Boolean(projectId),
  });

  const scenesQuery = useQuery({
    queryKey: ["unit-scenes", storyUnitId],
    queryFn: () => getUnitScenes(storyUnitId as string),
    enabled: Boolean(storyUnitId),
  });

  const namesQuery = useQuery({
    queryKey: ["project-entity-names", projectId],
    queryFn: () => getProjectEntityNames(projectId as string),
    enabled: Boolean(projectId),
  });

  const findingsQuery = useQuery({
    queryKey: ["project-findings", projectId],
    queryFn: () => getProjectFindings(projectId as string),
    enabled: Boolean(projectId),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      findingId,
      status,
    }: {
      findingId: string;
      status: FindingStatus;
    }) => patchFindingStatus(projectId as string, findingId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["project-findings", projectId],
      });
    },
  });

  if (!storyUnitId) {
    return (
      <div className="flex flex-col items-center gap-2 border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm font-medium">No story loaded</p>
        <p className="text-sm text-muted-foreground">
          Ingest a screenplay first.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/creator/ingest">Go to Ingest</Link>
        </Button>
      </div>
    );
  }

  const scenes = scenesQuery.data ?? [];
  const loading =
    scenesQuery.isLoading || namesQuery.isLoading || findingsQuery.isLoading;

  const unit =
    unitsQuery.data?.find((u) => u.storyUnitId === storyUnitId)?.title ??
    "Story unit";

  if (loading) {
    return (
      <p className="py-10 text-sm text-muted-foreground">Loading screenplay…</p>
    );
  }

  const docText = scenes
    .map((scene) => `${scene.heading}\n${scene.rawText}`)
    .join("\n\n");
  const { lines, scenes: anchors } = parseScreenplay(docText);

  const names = namesQuery.data ?? new Map<string, string>();
  const findings = (findingsQuery.data ?? []).map((f) =>
    findingToDomain(f, names),
  );

  return (
    <ScreenplayViewer
      lines={lines}
      scenes={anchors}
      findings={findings}
      title={unit}
      unitId={storyUnitId}
      onStatusChange={(findingId, status) =>
        statusMutation.mutate({ findingId, status })
      }
    />
  );
}
