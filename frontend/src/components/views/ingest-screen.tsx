"use client";

import {
  ArrowRight,
  CircleCheckBig,
  Clapperboard,
  CloudUpload,
  FileText,
  LoaderCircle,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { filmA, simulateIngest } from "@/lib/mock";
import { cn } from "@/lib/utils";

type SceneState = { scene: number; status: "pending" | "done" };
type Phase = "idle" | "ingesting" | "done";

export function IngestScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sceneStates, setSceneStates] = useState<SceneState[]>([]);
  const [claimsWritten, setClaimsWritten] = useState(0);
  const [claimCount, setClaimCount] = useState(0);
  const [busy, setBusy] = useState(false);

  async function runIngest() {
    if (busy) return;
    setBusy(true);
    setPhase("ingesting");
    setClaimsWritten(0);
    setClaimCount(filmA.scenes.length);
    setSceneStates(
      filmA.scenes.map((s) => ({
        scene: s.number,
        status: "pending" as const,
      })),
    );

    let total = 0;
    for await (const event of simulateIngest(filmA)) {
      if (event.kind === "scene_complete") {
        total += event.claimsWritten;
        setClaimsWritten(total);
        setSceneStates((prev) =>
          prev.map((s) =>
            s.scene === event.scene ? { ...s, status: "done" } : s,
          ),
        );
      } else {
        setPhase("done");
      }
    }
    setBusy(false);
  }

  const pct =
    sceneStates.length === 0
      ? 0
      : (claimsWritten / Math.max(1, claimCount)) * 100;
  const doneCount = sceneStates.filter((s) => s.status === "done").length;

  return (
    <>
      {phase === "idle" ? (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
              <Clapperboard className="h-6 w-6" aria-hidden />
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <CardTitle className="text-xl">Ingest a screenplay</CardTitle>
              <CardDescription className="mx-auto max-w-md">
                Upload a screenplay and the Story Analyst reads it scene by
                scene, extracting every entity, claim, and event into a
                structured story state.
              </CardDescription>
            </div>
            <div className="flex flex-col items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.fountain"
                className="hidden"
                onChange={() => runIngest()}
              />
              <Button size="lg" onClick={runIngest}>
                <CloudUpload className="mr-2 h-4 w-4" aria-hidden />
                Run demo ingest: The Voss Cipher
              </Button>
              <Button
                variant="ghost"
                onClick={() => fileInput.current?.click()}
              >
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                or choose a .txt screenplay
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {phase === "ingesting" || phase === "done" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {phase === "ingesting" ? (
                <LoaderCircle
                  className="h-5 w-5 animate-spin text-primary"
                  aria-hidden
                />
              ) : (
                <CircleCheckBig
                  className="h-5 w-5 text-success-foreground"
                  aria-hidden
                />
              )}
              <CardTitle className="text-lg">
                {phase === "ingesting"
                  ? "Story Analyst at work"
                  : "Ingestion complete"}
              </CardTitle>
            </div>
            <CardDescription>
              The Voss Cipher · film-a · {doneCount} of {filmA.scenes.length}{" "}
              scenes · {claimsWritten} claims written
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={pct} className="h-2" />
            <div className="flex flex-wrap gap-1.5">
              {sceneStates.map((s) => (
                <span
                  key={s.scene}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-medium",
                    s.status === "done"
                      ? "border-success-foreground/20 bg-success text-success-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {s.scene}
                </span>
              ))}
            </div>

            {phase === "done" ? (
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
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
