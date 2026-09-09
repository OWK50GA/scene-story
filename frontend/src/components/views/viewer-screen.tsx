"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FolderKanban, Info, LockKeyhole, Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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
import { Slider } from "@/components/ui/slider";
import {
  type ApiAskAnswer,
  askUnit,
  getProject,
  getUnitClaims,
  getUnitScenes,
  listStoryUnits,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export function ViewerScreen() {
  const { workspace, hydrated } = useWorkspace();
  const { storyUnitId, projectId } = workspace;

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

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId as string),
    enabled: Boolean(projectId),
  });

  const unitsQuery = useQuery({
    queryKey: ["project-units", projectId],
    queryFn: () => listStoryUnits(projectId as string),
    enabled: Boolean(projectId),
  });

  const claims = claimsQuery.data ?? [];
  const claimById = new Map(claims.map((c) => [c.claimId, c]));
  const scenes = scenesQuery.data ?? [];
  const maxScene = scenes.length;

  const title =
    unitsQuery.data?.find((u) => u.storyUnitId === storyUnitId)?.title ??
    undefined;
  const projectName = projectQuery.data?.name;

  const examples = useMemo(() => {
    const candidates: string[] = [];
    for (const claim of claims) {
      if (claim.property.toLowerCase() === "location") {
        const name = claim.entity.trim();
        if (name && !candidates.includes(name)) {
          candidates.push(name);
          if (candidates.length === 4) break;
        }
      }
    }
    const prompts = candidates.map((name) => `Where is ${name}?`);
    if (prompts.length === 0) prompts.push("What is the story about so far?");
    return prompts;
  }, [claims]);

  const [scene, setScene] = useState(5);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ApiAskAnswer | null>(null);
  const [asked, setAsked] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxSceneBound = Math.max(1, maxScene);
  const boundedScene = Math.min(Math.max(1, scene), maxSceneBound);

  if (!hydrated) {
    return (
      <Card className="flex items-center justify-center gap-2 px-6 py-14 text-muted-foreground">
        <Info className="h-4 w-4 animate-pulse" aria-hidden />
        <span className="text-sm">Loading your studio</span>
      </Card>
    );
  }

  if (!storyUnitId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audience Companion</CardTitle>
          <CardDescription>
            Open a screenplay from a project, then ask questions about what you
            have watched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/projects">
              <FolderKanban className="mr-2 h-4 w-4" aria-hidden />
              Browse projects
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const unitId = storyUnitId;
  const loading =
    scenesQuery.isLoading ||
    claimsQuery.isLoading ||
    (projectId ? projectQuery.isLoading || unitsQuery.isLoading : false);

  async function ask(text: string) {
    const q = text.trim();
    if (q === "" || asking) return;
    setAsked(q);
    setAsking(true);
    setError(null);
    try {
      const result = await askUnit(unitId, boundedScene, q);
      setAnswer(result);
    } catch (err) {
      setAnswer(null);
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  const facts = (answer?.factsUsed ?? [])
    .map((id) => claimById.get(id))
    .filter((claim) => claim !== undefined);

  return (
    <div className="flex flex-col gap-4">
      {projectId ? (
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {projectName ?? "Project"}
        </Link>
      ) : null}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">
                {loading ? "You're watching" : (title ?? "This screenplay")}
              </CardTitle>
              <CardDescription>
                {loading
                  ? "Loading story…"
                  : projectName
                    ? `${projectName} · ${scenes.length} scenes`
                    : `${scenes.length} scenes`}
              </CardDescription>
            </div>
            <Badge className="bg-accent font-medium text-accent-foreground">
              Scene {boundedScene} of {maxScene}
            </Badge>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="scene-slider">Spoiler boundary</Label>
              <span className="text-sm text-muted-foreground">
                answer using scenes 1 to {boundedScene} only
              </span>
            </div>
            <Slider
              id="scene-slider"
              min={1}
              max={maxSceneBound}
              step={1}
              value={[boundedScene]}
              onValueChange={([value]) =>
                setScene(Math.min(Math.max(1, value ?? 1), maxSceneBound))
              }
              disabled={loading}
            />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ask about the story</CardTitle>
          <CardDescription>
            The Audience Companion answers only from what you have already
            watched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") ask(question);
              }}
              placeholder="Ask about a character, object, or place…"
              aria-label="Your question"
            />
            <Button onClick={() => ask(question)} disabled={asking}>
              <Send className="mr-2 h-4 w-4" aria-hidden />
              {asking ? "Asking…" : "Ask"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuestion(example);
                  ask(example);
                }}
                className="border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>

          {error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {answer ? (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
                <span>
                  Asked: “{asked}” · boundary enforced at scene {boundedScene}
                </span>
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] tracking-widest uppercase"
                >
                  {answer.epistemicState}
                </Badge>
              </div>

              <div
                className={
                  answer.epistemicState === "unknown"
                    ? "rounded-lg border border-yellow-200 bg-warning px-4 py-3 text-sm text-warning-foreground"
                    : "rounded-lg border border-border bg-background px-4 py-3 text-sm"
                }
              >
                {answer.epistemicState === "unknown" ? (
                  <Info className="mr-2 inline h-4 w-4" aria-hidden />
                ) : null}
                {answer.answer}
              </div>

              {answer.notKnownAspects.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Not yet established
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {answer.notKnownAspects.map((aspect) => (
                      <li key={aspect}>{aspect}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {facts.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Facts used to answer
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {facts.map((claim) => (
                      <Badge
                        key={claim.claimId}
                        variant="outline"
                        className="font-normal"
                      >
                        Scene {claim.scene} · {claim.entity} · {claim.property}:{" "}
                        {claim.value}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
