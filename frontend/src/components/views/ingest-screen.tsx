"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheckBig,
  Clapperboard,
  CloudUpload,
  FileText,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createProject,
  createStoryUnit,
  createUniverse,
  getUnitStatus,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const DEMO_UNIVERSE_NAME = "Voss Espionage World";
const DEMO_FILM_TITLE = "The Voss Cipher";

type Step =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "ingesting" }
  | { kind: "failed"; message: string };

export function IngestScreen() {
  const { workspace, select } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "ready" });

  const statusQuery = useQuery({
    queryKey: ["unit-status", workspace.storyUnitId],
    queryFn: () => getUnitStatus(workspace.storyUnitId as string),
    enabled: Boolean(workspace.storyUnitId),
    refetchInterval: (query) =>
      query.state.data?.ingestionStatus === "ingesting" ? 4000 : false,
  });

  async function createDemoWorld() {
    setStep({ kind: "submitting" });
    try {
      const universe = await createUniverse(
        DEMO_UNIVERSE_NAME,
        "A world of wartime espionage.",
      );
      const project = await createProject(universe.universeId, DEMO_FILM_TITLE);
      const unit = await createStoryUnit(
        project.projectId,
        universe.universeId,
        DEMO_FILM_TITLE,
      );
      select({
        universeId: universe.universeId,
        projectId: project.projectId,
        storyUnitId: unit.storyUnitId,
      });
      setStep({ kind: "ready" });
    } catch (err) {
      setStep({
        kind: "failed",
        message: err instanceof Error ? err.message : "Could not create world",
      });
    }
  }

  async function runDemoIngest() {
    if (!workspace.storyUnitId) return;
    setStep({ kind: "submitting" });
    try {
      const response = await fetch("/internal/demo-ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyUnitId: workspace.storyUnitId }),
      });
      const json = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(json.message ?? "Ingest failed to start");
      }
      setStep({ kind: "ingesting" });
    } catch (err) {
      setStep({
        kind: "failed",
        message: err instanceof Error ? err.message : "Could not start ingest",
      });
    }
  }

  function chooseFile() {
    fileInput.current?.click();
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && workspace.storyUnitId) {
      setStep({ kind: "submitting" });
      const form = new FormData();
      form.append("file", file);
      fetch(`/api/units/${workspace.storyUnitId}/ingest`, {
        method: "POST",
        body: form,
      })
        .then(async (response) => {
          const json = (await response.json()) as { message?: string };
          if (!response.ok) throw new Error(json.message ?? "Ingest failed");
          setStep({ kind: "ingesting" });
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

  const creating = step.kind === "submitting";

  if (!workspace.storyUnitId && step.kind !== "failed") {
    return (
      <Card className="border-dashed">
        <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
            <Clapperboard className="h-6 w-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <CardTitle className="text-xl">Ingest a screenplay</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              Set up a demo world, then the Story Analyst reads the screenplay
              scene by scene, extracting every entity, claim, and event into a
              structured story state.
            </CardDescription>
          </div>
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" onClick={createDemoWorld}>
              {creating ? (
                <LoaderCircle
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden
                />
              ) : (
                <Clapperboard className="mr-2 h-4 w-4" aria-hidden />
              )}
              Create demo world
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const isBusy = step.kind === "submitting" || step.kind === "ingesting";

  if (step.kind === "failed") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden />
            <CardTitle className="text-lg">Something went wrong</CardTitle>
          </div>
          <CardDescription>{step.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setStep({ kind: "ready" });
                statusQuery.refetch();
              }}
            >
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/creator/state">View Story State</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isComplete =
    statusQuery.data?.ingestionStatus === "complete" &&
    statusQuery.data.claimCount > 0;
  const isUnitFailed = statusQuery.data?.ingestionStatus === "failed";

  let body: ReactNode;
  if (!isComplete && !isUnitFailed) {
    body = (
      <Card className="border-dashed">
        <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
            <Clapperboard className="h-6 w-6" aria-hidden />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <CardTitle className="text-xl">Ingest {DEMO_FILM_TITLE}</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              The Story Analyst extracts every entity, claim, and event into a
              structured story state. It takes a few minutes.
            </CardDescription>
          </div>
          <div className="flex flex-col items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.fountain"
              className="hidden"
              onChange={onFileSelected}
            />
            <Button size="lg" disabled={isBusy} onClick={runDemoIngest}>
              {isBusy ? (
                <LoaderCircle
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden
                />
              ) : (
                <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
              )}
              Run demo ingest: {DEMO_FILM_TITLE}
            </Button>
            <Button variant="ghost" onClick={chooseFile} disabled={isBusy}>
              <FileText className="mr-2 h-4 w-4" aria-hidden />
              or choose a .txt screenplay
            </Button>
          </div>
        </div>
      </Card>
    );
  } else if (isUnitFailed) {
    body = (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden />
            <CardTitle className="text-lg">Ingestion failed</CardTitle>
          </div>
          <CardDescription>
            Some scenes could not be processed. Retry by re-running the ingest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runDemoIngest} disabled={isBusy}>
            Retry ingest
          </Button>
        </CardContent>
      </Card>
    );
  } else if (isBusy) {
    body = (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LoaderCircle
              className="h-5 w-5 animate-spin text-primary"
              aria-hidden
            />
            <CardTitle className="text-lg">Story Analyst at work</CardTitle>
          </div>
          <CardDescription>
            Reading scenes and extracting claims. This can take a few minutes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  } else {
    const failedScenes = statusQuery.data?.failedScenes ?? [];
    body = (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CircleCheckBig
              className="h-5 w-5 text-success-foreground"
              aria-hidden
            />
            <CardTitle className="text-lg">Ingestion complete</CardTitle>
          </div>
          <CardDescription>
            {DEMO_FILM_TITLE} · {statusQuery.data?.sceneCount ?? "?"} scenes ·{" "}
            {statusQuery.data?.claimCount ?? 0} claims written
            {failedScenes.length > 0
              ? ` · ${failedScenes.length} scene(s) failed`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button asChild variant="default">
              <Link href="/creator/state">
                View Story State
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/creator/findings">Review Findings</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <>{body}</>;
}
