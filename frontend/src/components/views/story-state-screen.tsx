"use client";

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
import { SOURCE_TYPE_LABEL, type SourceType } from "@/lib/domain";
import { filmA } from "@/lib/mock";
import { cn } from "@/lib/utils";

const sourceBadge: Record<SourceType, string> = {
  explicit: "border-success-foreground/20 bg-success text-success-foreground",
  implied: "border-primary/30 bg-accent text-accent-foreground",
  inferred: "border-border bg-muted text-muted-foreground",
};

export function StoryStateScreen() {
  const [scene, setScene] = useState("all");

  const visible = useMemo(() => {
    const claims =
      scene === "all"
        ? filmA.claims
        : filmA.claims.filter((c) => c.scene === Number(scene));
    return [...claims].sort(
      (a, b) => a.scene - b.scene || a.entity.localeCompare(b.entity),
    );
  }, [scene]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Story State</CardTitle>
          <CardDescription>
            {visible.length} active claims extracted from the screenplay
          </CardDescription>
        </div>
        <Select value={scene} onValueChange={setScene}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by scene">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scenes</SelectItem>
            {filmA.scenes.map((s) => (
              <SelectItem key={s.number} value={String(s.number)}>
                Scene {s.number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
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
            {visible.length === 0 ? (
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
            {visible.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell className="font-medium">
                  {claim.entity}
                  <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">
                    {claim.entityType}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {claim.property}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  {claim.value}
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground italic">
                    {claim.sourceLine}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border px-1 text-xs text-muted-foreground">
                    {claim.scene}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("font-medium", sourceBadge[claim.sourceType])}
                  >
                    {SOURCE_TYPE_LABEL[claim.sourceType]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={claim.confidence * 100}
                      className="h-1.5 w-16"
                      aria-hidden
                    />
                    <span className="w-9 text-xs tabular-nums text-muted-foreground">
                      {claim.confidence.toFixed(2)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
