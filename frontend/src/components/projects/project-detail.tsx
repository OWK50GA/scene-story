"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CloudUpload,
  FilePlus2,
  FileText,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IngestionStatus } from "@/lib/api";
import {
  createStoryUnit,
  getProject,
  ingestStoryUnit,
  listStoryUnits,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

const SAMPLE_URL = "/samples/the-voss-cipher.txt";
const SAMPLE_TITLE = "The Voss Cipher";

type AddMode = "upload" | "sample";

const STATUS_LABEL: Record<IngestionStatus, string> = {
  pending: "Pending",
  ingesting: "Ingesting",
  complete: "Complete",
  failed: "Failed",
};

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { select } = useWorkspace();

  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("upload");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
    enabled: Boolean(projectId),
  });
  const unitsQuery = useQuery({
    queryKey: ["project-units", projectId],
    queryFn: () => listStoryUnits(projectId),
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;
  const units = unitsQuery.data ?? [];
  const unitsLoading = unitsQuery.isLoading;

  async function createAndIngest(input: {
    title: string;
    file?: File;
    sample?: boolean;
  }) {
    if (!project) {
      throw new Error("Project is not loaded yet");
    }
    const universeId = project.universeId;
    const unit = await createStoryUnit(
      projectId,
      universeId,
      input.sample ? SAMPLE_TITLE : input.title,
    );
    let fileToUpload = input.file;
    if (input.sample) {
      const text = await fetch(SAMPLE_URL).then((r) => r.text());
      fileToUpload = new File([text], "the-voss-cipher.txt", {
        type: "text/plain",
      });
    }
    if (fileToUpload) {
      await ingestStoryUnit(unit.storyUnitId, fileToUpload);
    }
    select({ universeId, projectId, storyUnitId: unit.storyUnitId });
    queryClient.invalidateQueries({ queryKey: ["project-units", projectId] });
    router.push("/creator/ingest");
  }

  const addMutation = useMutation({
    mutationFn: () => createAndIngest({ title, file: file ?? undefined }),
    onSuccess: () => {
      setShowAdd(false);
      setTitle("");
      setFile(null);
    },
  });

  const sampleMutation = useMutation({
    mutationFn: () => createAndIngest({ title: SAMPLE_TITLE, sample: true }),
    onSuccess: () => setShowAdd(false),
  });

  function openUnit(unitId: string) {
    select({
      universeId: project?.universeId,
      projectId,
      storyUnitId: unitId,
    });
    router.push("/creator/ingest");
  }

  const busy = addMutation.isPending || sampleMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/projects"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Projects
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project?.name ?? "Project"}
            </h1>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {project ? (
                <>
                  <span>{project.universeName || "Studio"}</span>
                  <span aria-hidden>·</span>
                  <span className="capitalize">{project.type}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {unitsLoading
                      ? "…"
                      : `${units.length} screenplay${units.length === 1 ? "" : "s"}`}
                  </span>
                </>
              ) : (
                <span>Loading project details</span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy || !project}
            onClick={() => setShowAdd((v) => !v)}
          >
            <FilePlus2 className="mr-2 h-4 w-4" aria-hidden />
            New screenplay
          </Button>
        </div>
      </div>

      {showAdd ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a screenplay</CardTitle>
            <CardDescription>
              Upload a screenplay to parse and ingest, or start from the ready
              made sample.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={addMode === "upload" ? "default" : "outline"}
                onClick={() => setAddMode("upload")}
              >
                <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
                Upload
              </Button>
              <Button
                type="button"
                variant={addMode === "sample" ? "default" : "outline"}
                onClick={() => setAddMode("sample")}
              >
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                Start from a sample
              </Button>
            </div>

            {addMode === "upload" ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="screenplay-title">Screenplay title</Label>
                  <Input
                    id="screenplay-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. The Glasshouse"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="screenplay-file">Screenplay file</Label>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="screenplay-file"
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:border-primary/50",
                        file ? "border-primary/50" : "border-border",
                      )}
                    >
                      {file ? (
                        <FileText
                          className="h-6 w-6 text-primary"
                          aria-hidden
                        />
                      ) : (
                        <CloudUpload
                          className="h-6 w-6 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <span className="text-sm font-medium">
                        {file ? file.name : "Choose a screenplay file"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        .txt, .fountain or .pdf, up to 10 MB
                      </span>
                    </label>
                    <input
                      id="screenplay-file"
                      type="file"
                      accept=".txt,.fountain,.pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
                {addMutation.isError ? (
                  <p className="text-sm text-destructive">
                    {addMutation.error instanceof Error
                      ? addMutation.error.message
                      : "Could not start ingest"}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAdd(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy || !file || title.trim().length === 0}
                    onClick={() => addMutation.mutate()}
                  >
                    {busy ? (
                      <LoaderCircle
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
                    )}
                    Upload and ingest
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                  <span className="font-medium">{SAMPLE_TITLE}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  A ready made wartime espionage screenplay. Creates a project
                  unit and runs the full ingest pipeline so you can explore
                  story state, findings, and the viewer instantly.
                </p>
                <div className="flex justify-end gap-2 self-stretch">
                  <Button
                    variant="outline"
                    onClick={() => setShowAdd(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => sampleMutation.mutate()}
                  >
                    {busy ? (
                      <LoaderCircle
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    Start sample
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {unitsLoading ? (
        <div className="flex flex-col gap-4">
          <div className="h-4 w-24 rounded bg-muted/70" aria-hidden />
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="animate-pulse" aria-hidden>
                <div className="flex flex-col gap-3 p-6">
                  <div className="h-5 w-2/5 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted/60" />
                  <div className="h-9 w-32 self-end rounded bg-muted/60" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {!unitsLoading && units.length === 0 && !showAdd ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
              <FilePlus2 className="h-6 w-6" aria-hidden />
            </div>
            <div className="flex flex-col items-center gap-1">
              <CardTitle>No screenplays yet</CardTitle>
              <CardDescription className="mx-auto max-w-md">
                Every screenplay is read scene by scene into a structured story
                state. Upload your own, or try the sample to see the full flow.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="lg"
                disabled={busy}
                onClick={() => {
                  setAddMode("upload");
                  setShowAdd(true);
                }}
              >
                <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
                Upload a screenplay
              </Button>
              <Button
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => sampleMutation.mutate()}
              >
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {busy
                  ? "Starting sample..."
                  : "Start with the sample screenplay"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {units.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Screenplays
          </h2>
          {units.map((unit) => (
            <Card key={unit.storyUnitId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">{unit.title}</CardTitle>
                    <CardDescription className="capitalize">
                      {unit.unitType} · {unit.sceneCount} scenes ·{" "}
                      {unit.claimCount} claims
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      unit.ingestionStatus === "complete"
                        ? "default"
                        : unit.ingestionStatus === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {STATUS_LABEL[unit.ingestionStatus] ?? unit.ingestionStatus}
                  </Badge>
                </div>
                {unit.ingestionStatus === "failed" ? (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    Some scenes failed during ingestion.
                  </p>
                ) : null}
              </CardHeader>
              <CardContent>
                <div className="flex justify-end gap-2 border-t border-border pt-4">
                  <Button onClick={() => openUnit(unit.storyUnitId)}>
                    Open screenplay
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
