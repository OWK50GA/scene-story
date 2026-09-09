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

type RawIngestReceipt = {
  story_unit_id: string;
  scene_count: number;
  ingestion_status: string;
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
  const raw = await apiPostForm<RawIngestReceipt>(
    `/units/${storyUnitId}/ingest`,
    form,
  );
  return toIngestReceipt(payload<RawIngestReceipt>(raw));
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

function toIngestReceipt(raw: RawIngestReceipt): IngestReceipt {
  return {
    storyUnitId: raw.story_unit_id,
    sceneCount: raw.scene_count,
    ingestionStatus: raw.ingestion_status,
  };
}

export async function patchFindingStatus(
  projectId: string,
  findingId: string,
  status: "open" | "marked_intentional" | "resolved",
): Promise<void> {
  await apiPatch(`/projects/${projectId}/findings/${findingId}`, { status });
}

// =============================================================================
// Read models — scenes, claims, findings, companion ask
// =============================================================================

export type ApiScene = {
  sceneId: string;
  sceneNumber: number;
  heading: string;
  rawText: string;
  ingestionStatus: "pending" | "complete" | "failed";
};

export type ApiClaim = {
  claimId: string;
  entityId: string;
  entity: string;
  property: string;
  value: string;
  scene: number;
  sourceType: "explicit" | "implied" | "inferred";
  confidence: number;
  sourceLine: string;
};

export type ApiEmbeddedClaim = {
  claimId: string;
  entityId: string;
  property: string;
  value: string;
  scene: number;
  sourceType: "explicit" | "implied" | "inferred";
  confidence: number;
  sourceLine: string;
};

export type ApiFinding = {
  findingId: string;
  conflict: "confirmed" | "ambiguous";
  severity: "high" | "medium" | "low";
  scope: "within_unit" | "cross_unit";
  status: "open" | "marked_intentional" | "resolved";
  explanation: string;
  resolutionSuggestion: string;
  claimA: ApiEmbeddedClaim;
  claimB: ApiEmbeddedClaim;
};

export type ApiAskAnswer = {
  answer: string;
  epistemicState: "known" | "partial" | "unknown";
  factsUsed: string[];
  notKnownAspects: string[];
  boundary: { storyUnitId: string; upToScene: number };
  boundaryEnforced: boolean;
};

type RawScene = {
  scene_id: string;
  story_unit_id: string;
  scene_number: number;
  heading: string;
  raw_text: string;
  ingestion_status: "pending" | "complete" | "failed";
};

type RawClaim = {
  claim_id: string;
  universe_entity_id: string;
  entity_name: string;
  source_scene_number: number;
  property: string;
  value: string;
  source_type: "explicit" | "implied" | "inferred";
  confidence: number;
  source_line: string;
};

type RawEmbeddedClaim = {
  claim_id: string;
  universe_entity_id: string;
  source_scene_number: number;
  property: string;
  value: string;
  source_type: "explicit" | "implied" | "inferred";
  confidence: number;
  source_line: string;
};

type RawFinding = {
  finding_id: string;
  conflict_type: "confirmed" | "ambiguous";
  severity: "high" | "medium" | "low";
  scope: "within_unit" | "cross_unit";
  status: "open" | "marked_intentional" | "resolved";
  explanation: string;
  resolution_suggestion: string;
  claim_a: RawEmbeddedClaim;
  claim_b: RawEmbeddedClaim;
};

function toApiScene(raw: RawScene): ApiScene {
  return {
    sceneId: raw.scene_id,
    sceneNumber: raw.scene_number,
    heading: raw.heading,
    rawText: raw.raw_text,
    ingestionStatus: raw.ingestion_status,
  };
}

function toApiClaim(raw: RawClaim): ApiClaim {
  return {
    claimId: raw.claim_id,
    entityId: raw.universe_entity_id,
    entity: raw.entity_name,
    property: raw.property,
    value: raw.value,
    scene: raw.source_scene_number,
    sourceType: raw.source_type,
    confidence: raw.confidence,
    sourceLine: raw.source_line,
  };
}

function toEmbeddedClaim(raw: RawEmbeddedClaim): ApiEmbeddedClaim {
  return {
    claimId: raw.claim_id,
    entityId: raw.universe_entity_id,
    property: raw.property,
    value: raw.value,
    scene: raw.source_scene_number,
    sourceType: raw.source_type,
    confidence: raw.confidence,
    sourceLine: raw.source_line,
  };
}

function toApiFinding(raw: RawFinding): ApiFinding {
  return {
    findingId: raw.finding_id,
    conflict: raw.conflict_type,
    severity: raw.severity,
    scope: raw.scope,
    status: raw.status,
    explanation: raw.explanation,
    resolutionSuggestion: raw.resolution_suggestion,
    claimA: toEmbeddedClaim(raw.claim_a),
    claimB: toEmbeddedClaim(raw.claim_b),
  };
}

export async function getUnitScenes(storyUnitId: string): Promise<ApiScene[]> {
  const raw = await apiGet<{ scenes: RawScene[] }>(
    `/units/${storyUnitId}/scenes`,
  );
  return payload<{ scenes: RawScene[] }>(raw).scenes.map(toApiScene);
}

export async function getUnitClaims(storyUnitId: string): Promise<ApiClaim[]> {
  const raw = await apiGet<{ claims: RawClaim[] }>(
    `/units/${storyUnitId}/claims`,
  );
  return payload<{ claims: RawClaim[] }>(raw).claims.map(toApiClaim);
}

export async function getProjectFindings(
  projectId: string,
): Promise<ApiFinding[]> {
  const raw = await apiGet<{ findings: RawFinding[] }>(
    `/projects/${projectId}/findings`,
  );
  return payload<{ findings: RawFinding[] }>(raw).findings.map(toApiFinding);
}

/**
 * Builds an entityId to canonical entity name map across every story unit in
 * a project, so findings that span units can still resolve claim names.
 */
export async function getProjectEntityNames(
  projectId: string,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const units = await listStoryUnits(projectId);
  await Promise.all(
    units.map(async (unit) => {
      try {
        const claims = await getUnitClaims(unit.storyUnitId);
        for (const claim of claims) {
          if (!names.has(claim.entityId)) {
            names.set(claim.entityId, claim.entity);
          }
        }
      } catch {
        // ignore a unit that cannot be read; resolve what we can
      }
    }),
  );
  return names;
}

export async function askUnit(
  storyUnitId: string,
  upToScene: number,
  question: string,
): Promise<ApiAskAnswer> {
  const raw = await apiPost<{
    answer: string;
    epistemic_state: ApiAskAnswer["epistemicState"];
    facts_used: string[];
    not_known_aspects: string[];
    boundary: { story_unit_id: string; up_to_scene: number };
    boundary_enforced: boolean;
  }>(`/units/${storyUnitId}/ask`, {
    question,
    up_to_scene: upToScene,
  });
  return {
    answer: raw.answer,
    epistemicState: raw.epistemic_state,
    factsUsed: raw.facts_used ?? [],
    notKnownAspects: raw.not_known_aspects ?? [],
    boundary: {
      storyUnitId: raw.boundary.story_unit_id,
      upToScene: raw.boundary.up_to_scene,
    },
    boundaryEnforced: raw.boundary_enforced,
  };
}
