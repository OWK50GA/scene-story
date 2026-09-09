"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheckBig,
  CloudUpload,
  FileSearch,
  FileText,
  FolderKanban,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getUnitStatus, ingestStoryUnit, listStoryUnits } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

type Step =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ingesting" }
  | { kind: "failed"; message: string };

export function IngestScreen() {
  const { workspace, hydrated } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "ready" });

  const { storyUnitId, projectId } = workspace;

  const unitsQuery = useQuery({
    queryKey: ["project-units", projectId],
    queryFn: () => listStoryUnits(projectId as string),
    enabled: Boolean(projectId),
  });

  const statusQuery = useQuery({
    queryKey: ["unit-status", storyUnitId],
    queryFn: () => getUnitStatus(storyUnitId as string),
    enabled: Boolean(storyUnitId),
    refetchInterval: (query) => {
      const status = query.state.data?.ingestionStatus;
      const active =
        status === "ingesting" ||
        (step.kind === "ingesting" &&
          status !== "complete" &&
          status !== "failed");
      return active ? 4000 : false;
    },
  });

  const title =
    unitsQuery.data?.find((u) => u.storyUnitId === storyUnitId)?.title ??
    "this screenplay";

  function chooseFile() {
    fileInput.current?.click();
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && storyUnitId) {
      setStep({ kind: "submitting" });
      ingestStoryUnit(storyUnitId, file)
        .then(() => {
          setStep({ kind: "ingesting" });
          statusQuery.refetch();
        })
        .catch((err: unknown) =>
          setStep({
            kind: "failed",
            message:
              err instanceof Error ? err.message : "Could not start ingest",
          }),
        );
    }
    event.target.value = "";
  }

  if (!hydrated) {
    return (
      <Card className="flex items-center justify-center gap-2 px-6 py-14 text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-sm">Loading your studio</span>
      </Card>
    );
  }

  if (!storyUnitId && step.kind !== "failed") {
    return (
      <Card className="border-dashed">
        <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
            <FolderKanban className="h-6 w-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <CardTitle className="text-xl">No screenplay selected</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              Open a project and add a screenplay to ingest. The Story Analyst
              reads it scene by scene, extracting every entity, claim, and event
              into a structured story state.
            </CardDescription>
          </div>
          <Button asChild size="lg">
            <Link href="/projects">
              <FolderKanban className="mr-2 h-4 w-4" aria-hidden />
              Go to projects
            </Link>
          </Button>
        </div>
      </Card>
    );
  }

  if (step.kind === "failed") {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden />
            <CardTitle className="text-lg">Ingest did not start</CardTitle>
          </div>
          <CardDescription>{step.message}</CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.fountain,.pdf"
              className="hidden"
              onChange={onFileSelected}
            />
            <Button onClick={chooseFile}>
              <FileText className="mr-2 h-4 w-4" aria-hidden />
              Try another screenplay file
            </Button>
            <Button asChild variant="outline">
              <Link href="/projects">Back to projects</Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const status = statusQuery.data;
  const isComplete =
    status?.ingestionStatus === "complete" && (status.claimCount ?? 0) > 0;
  const isUnitFailed = status?.ingestionStatus === "failed";
  const isBusy = step.kind === "submitting" || step.kind === "ingesting";

  let body: React.ReactNode;

  if (isComplete) {
    const failedScenes = status?.failedScenes ?? [];
    body = (
      <Card>
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <CircleCheckBig
              className="h-5 w-5 text-success-foreground"
              aria-hidden
            />
            <CardTitle className="text-lg">Ingestion complete</CardTitle>
          </div>
          <CardDescription>
            {title} · {status?.sceneCount ?? "?"} scenes ·{" "}
            {status?.claimCount ?? 0} claims written
            {failedScenes.length > 0
              ? ` · ${failedScenes.length} scene(s) failed`
              : ""}
          </CardDescription>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button asChild>
              <Link href="/creator/state">
                View Story State
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/creator/findings">
                <FileSearch className="mr-2 h-4 w-4" aria-hidden />
                Review Findings
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  } else if (isBusy || status?.ingestionStatus === "ingesting") {
    body = (
      <Card>
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <LoaderCircle
              className="h-5 w-5 animate-spin text-primary"
              aria-hidden
            />
            <CardTitle className="text-lg">Story Analyst at work</CardTitle>
          </div>
          <CardDescription>
            Reading scenes and extracting claims from {title}. This can take a
            few minutes.
          </CardDescription>
        </div>
      </Card>
    );
  } else if (isUnitFailed) {
    body = (
      <Card>
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden />
            <CardTitle className="text-lg">Ingestion failed</CardTitle>
          </div>
          <CardDescription>
            Some scenes could not be processed. Upload the screenplay again to
            retry ingestion.
          </CardDescription>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.fountain,.pdf"
              className="hidden"
              onChange={onFileSelected}
            />
            <Button onClick={chooseFile}>
              <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
              Retry with a screenplay file
            </Button>
            <Button asChild variant="outline">
              <Link href="/projects">Back to projects</Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  } else if (status?.ingestionStatus === "pending") {
    body = (
      <Card className="border-dashed">
        <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
            <FileText className="h-6 w-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <CardTitle className="text-xl">Ingest {title}</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              The Story Analyst extracts every entity, claim, and event into a
              structured story state. It takes a few minutes.
            </CardDescription>
          </div>
          <div className="flex flex-col items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.fountain,.pdf"
              className="hidden"
              onChange={onFileSelected}
            />
            <Button size="lg" onClick={chooseFile} disabled={isBusy}>
              {isBusy ? (
                <LoaderCircle
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden
                />
              ) : (
                <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
              )}
              Upload screenplay
            </Button>
          </div>
        </div>
      </Card>
    );
  } else {
    body = (
      <Card className="flex items-center justify-center gap-2 px-6 py-14 text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-sm">Loading screenplay state</span>
      </Card>
    );
  }

  return <>{body}</>;
}
