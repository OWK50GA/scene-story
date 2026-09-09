"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, LoaderCircle, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
import {
  createProject,
  createStoryUnit,
  createUniverse,
  ingestStoryUnit,
  listProjects,
  listUniverses,
} from "@/lib/api";

const DEFAULT_STUDIO = "My Studio";

export function ProjectsHome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const studioIdRef = useRef<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  async function ensureStudio(): Promise<string> {
    if (studioIdRef.current) return studioIdRef.current;
    const universes = await listUniverses();
    const existing =
      universes.find((u) => u.name === DEFAULT_STUDIO) ?? universes[0];
    if (existing) {
      studioIdRef.current = existing.universeId;
      return existing.universeId;
    }
    const created = await createUniverse(
      DEFAULT_STUDIO,
      "Default workspace for SceneStory projects.",
    );
    studioIdRef.current = created.universeId;
    return created.universeId;
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const universeId = await ensureStudio();
      const project = await createProject(
        universeId,
        name.trim() || "Untitled project",
      );
      return project;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowCreate(false);
      setName("");
      router.push(`/projects/${project.projectId}`);
    },
  });

  const sampleMutation = useMutation({
    mutationFn: async () => {
      const universeId = await ensureStudio();
      const project = await createProject(universeId, "The Voss Cipher");
      const response = await fetch("/samples/the-voss-cipher.txt");
      if (!response.ok) {
        throw new Error("Could not load the sample screenplay");
      }
      const text = await response.text();
      const unit = await createStoryUnit(
        project.projectId,
        universeId,
        "The Voss Cipher",
      );
      const file = new File([text], "the-voss-cipher.txt", {
        type: "text/plain",
      });
      await ingestStoryUnit(unit.storyUnitId, file);
      return project;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.projectId}`);
    },
  });

  const projects = projectsQuery.data ?? [];
  const loading = projectsQuery.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Film and series productions in your studio.
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? (
            <Plus className="mr-2 h-4 w-4 rotate-45" aria-hidden />
          ) : (
            <Plus className="mr-2 h-4 w-4" aria-hidden />
          )}
          {showCreate ? "Close" : "New project"}
        </Button>
      </div>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a project</CardTitle>
            <CardDescription>
              A project groups screenplays, their story state, and continuity
              findings. You add screenplays to it next.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. The Voss Cipher"
                autoFocus
              />
            </div>
            {createMutation.isError ? (
              <p className="text-sm text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "Could not create project"}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCreate(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || name.trim().length === 0}
              >
                {createMutation.isPending ? (
                  <LoaderCircle
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden
                  />
                ) : null}
                Create project
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="flex flex-col gap-3 p-6">
                <div className="h-5 w-3/5 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted/60" />
              </div>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center bg-accent text-primary">
              <FolderKanban className="h-6 w-6" aria-hidden />
            </div>
            <div className="flex flex-col items-center gap-1">
              <CardTitle>No projects yet</CardTitle>
              <CardDescription className="mx-auto max-w-md">
                Create a project to start building a story state, or explore the
                product instantly with a ready-made screenplay.
              </CardDescription>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Button size="lg" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Create your first project
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={sampleMutation.isPending}
                onClick={() => sampleMutation.mutate()}
              >
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {sampleMutation.isPending
                  ? "Preparing sample"
                  : "Start with a sample screenplay instead"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.projectId}
              href={`/projects/${project.projectId}`}
            >
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant="outline" className="shrink-0">
                      {project.universeName || "Studio"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {project.unitCount} screenplay
                    {project.unitCount === 1 ? "" : "s"} · {project.claimCount}{" "}
                    claims
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
