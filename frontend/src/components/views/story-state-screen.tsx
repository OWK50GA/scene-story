"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUnitClaims, getUnitScenes } from "@/lib/api";
import { SOURCE_TYPE_LABEL, type SourceType } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

const sourceBadge: Record<SourceType, string> = {
  explicit: "border-success-foreground/20 bg-success text-success-foreground",
  implied: "border-primary/30 bg-accent text-accent-foreground",
  inferred: "border-border bg-muted text-muted-foreground",
};

type Row = {
  id: string;
  entity: string;
  property: string;
  value: string;
  scene: number;
  sourceType: SourceType;
  confidence: number;
  sourceLine: string;
};

export function StoryStateScreen() {
  const { workspace } = useWorkspace();
  const storyUnitId = workspace.storyUnitId;
  const [scene, setScene] = useState("all");

  const scenesQuery = useQuery({
    queryKey: ["unit-scenes", storyUnitId],
    queryFn: () => getUnitScenes(storyUnitId as string),
    enabled: Boolean(storyUnitId),
  });

  const claimsQuery = useQuery({
    queryKey: ["unit-claims", storyUnitId],
    queryFn: () => getUnitClaims(storyUnitId as string),
    enabled: Boolean(storyUnitId),
  });

  const scenes = scenesQuery.data ?? [];
  const claims = claimsQuery.data ?? [];

  const rows = useMemo<Row[]>(
    () =>
      claims
        .filter((c) => scene === "all" || c.scene === Number(scene))
        .map((c) => ({
          id: c.claimId,
          entity: c.entity,
          property: c.property,
          value: c.value,
          scene: c.scene,
          sourceType: c.sourceType,
          confidence: c.confidence,
          sourceLine: c.sourceLine,
        }))
        .sort((a, b) => a.scene - b.scene || a.entity.localeCompare(b.entity)),
    [claims, scene],
  );

  const loading =
    !storyUnitId || scenesQuery.isLoading || claimsQuery.isLoading;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Story State</CardTitle>
          <CardDescription>
            {loading
              ? "Loading claims…"
              : `${rows.length} claims extracted from the screenplay`}
          </CardDescription>
        </div>
        <Select value={scene} onValueChange={setScene}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by scene">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scenes</SelectItem>
            {scenes.map((s) => (
              <SelectItem key={s.sceneId} value={String(s.sceneNumber)}>
                Scene {s.sceneNumber}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Fetching story state…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-20">Scene</TableHead>
                <TableHead className="w-28">Source</TableHead>
                <TableHead className="w-36">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="font-medium text-foreground">
                        No claims for{" "}
                        {scene === "all" ? "this story" : `scene ${scene}`}
                      </p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {scene === "all"
                          ? "Nothing was extracted from the screenplay yet."
                          : "This scene changes nothing about the story state, so no claims were extracted from it."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.entity}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.property}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {row.value}
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground italic">
                      {row.sourceLine}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border px-1 text-xs text-muted-foreground">
                      {row.scene}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn("font-medium", sourceBadge[row.sourceType])}
                    >
                      {SOURCE_TYPE_LABEL[row.sourceType]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={row.confidence * 100}
                        className="h-1.5 w-16"
                        aria-hidden
                      />
                      <span className="w-9 text-xs tabular-nums text-muted-foreground">
                        {row.confidence.toFixed(2)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
