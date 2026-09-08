import {
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  payload,
} from "@/lib/api/client";

export type IngestionStatus = "pending" | "ingesting" | "complete" | "failed";

export type Universe = {
  universeId: string;
  name: string;
  description: string;
  createdAt: string;
};

export type Project = {
  projectId: string;
  universeId: string;
  name: string;
  type: "film" | "series" | "crossover" | "other";
  canonTier: 1 | 2 | 3;
  createdAt: string;
};

export type StoryUnit = {
  storyUnitId: string;
  projectId: string;
  universeId: string;
  title: string;
  unitType: string;
  ingestionStatus: IngestionStatus;
  sceneCount: number;
  claimCount: number;
};

export type UnitStatus = {
  storyUnitId: string;
  ingestionStatus: IngestionStatus;
  sceneCount: number;
  claimCount: number;
  failedScenes: number[];
};

export type IngestReceipt = {
  storyUnitId: string;
  sceneCount: number;
  ingestionStatus: string;
};

type RawUniverse = {
  universe_id: string;
  name: string;
  description: string;
  created_at: string;
};

type RawProject = {
  project_id: string;
  universe_id: string;
  name: string;
  type: Project["type"];
  canon_tier: Project["canonTier"];
  created_at: string;
};

type RawStoryUnit = {
  story_unit_id: string;
  project_id: string;
  universe_id: string;
  title: string;
  unit_type: string;
  ingestion_status: IngestionStatus;
  scene_count: number;
  claim_count: number;
};

type RawUnitStatus = {
  story_unit_id: string;
  ingestion_status: IngestionStatus;
  scene_count: number;
  claim_count: number;
  failed_scenes: number[];
};

function toUniverse(raw: RawUniverse): Universe {
  return {
    universeId: raw.universe_id,
    name: raw.name,
    description: raw.description,
    createdAt: raw.created_at,
  };
}

function toProject(raw: RawProject): Project {
  return {
    projectId: raw.project_id,
    universeId: raw.universe_id,
    name: raw.name,
    type: raw.type,
    canonTier: raw.canon_tier,
    createdAt: raw.created_at,
  };
}

function toStoryUnit(raw: RawStoryUnit): StoryUnit {
  return {
    storyUnitId: raw.story_unit_id,
    projectId: raw.project_id,
    universeId: raw.universe_id,
    title: raw.title,
    unitType: raw.unit_type,
    ingestionStatus: raw.ingestion_status,
    sceneCount: raw.scene_count,
    claimCount: raw.claim_count,
  };
}

export async function listUniverses(): Promise<Universe[]> {
  const raw = await apiGet<{ universes: RawUniverse[] }>("/universes");
  return payload<{ universes: RawUniverse[] }>(raw).universes.map(toUniverse);
}

export async function createUniverse(
  name: string,
  description: string,
): Promise<Universe> {
  const raw = await apiPost<RawUniverse>("/universes", { name, description });
  return toUniverse(payload<RawUniverse>(raw));
}

export async function createProject(
  universeId: string,
  name: string,
): Promise<Project> {
  const raw = await apiPost<RawProject>(`/universes/${universeId}/projects`, {
    name,
    type: "film",
    canonTier: 1,
  });
  return toProject(payload<RawProject>(raw));
}

export async function createStoryUnit(
  projectId: string,
  universeId: string,
  title: string,
): Promise<StoryUnit> {
  const raw = await apiPost<{ story_unit: RawStoryUnit }>(
    `/projects/${projectId}/units`,
    {
      projectId,
      universeId,
      title,
      unitType: "film",
      inUniversePeriod: "Winter 1943",
      releaseOrder: 1,
    },
  );
  return toStoryUnit(raw.story_unit);
}

export async function listStoryUnits(projectId: string): Promise<StoryUnit[]> {
  const raw = await apiGet<{ story_units: RawStoryUnit[] }>(
    `/projects/${projectId}/units`,
  );
  return payload<{ story_units: RawStoryUnit[] }>(raw).story_units.map(
    toStoryUnit,
  );
}

export async function getUnitStatus(storyUnitId: string): Promise<UnitStatus> {
  const raw = await apiGet<RawUnitStatus>(`/units/${storyUnitId}/status`);
  return toUnitStatus(payload<RawUnitStatus>(raw));
}

export async function ingestStoryUnit(
  storyUnitId: string,
  file: File,
): Promise<IngestReceipt> {
  const form = new FormData();
  form.append("file", file);
  const raw = await apiPostForm<IngestReceipt>(
    `/units/${storyUnitId}/ingest`,
    form,
  );
  return payload(raw);
}

function toUnitStatus(raw: RawUnitStatus): UnitStatus {
  return {
    storyUnitId: raw.story_unit_id,
    ingestionStatus: raw.ingestion_status,
    sceneCount: raw.scene_count,
    claimCount: raw.claim_count,
    failedScenes: raw.failed_scenes,
  };
}

export async function patchFindingStatus(
  projectId: string,
  findingId: string,
  status: "open" | "marked_intentional" | "resolved",
): Promise<void> {
  await apiPatch(`/projects/${projectId}/findings/${findingId}`, { status });
}
