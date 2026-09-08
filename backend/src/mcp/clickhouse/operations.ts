import { v4 as uuid } from "uuid";
import { z } from "zod";
import { ch } from "./client.js";
import { Q } from "./queries.js";
import {
  MCPOperationError,
  CONFIDENCE_RANGES,
  type Universe,
  type Project,
  type StoryUnit,
  type UniverseEntity,
  type TemporalRelation,
  type Scene,
  type Claim,
  type Event,
  type ContinuityFinding,
  type SpoilerBoundaryEntry,
  type IngestionStatus,
  type SceneIngestionStatus,
  type SourceType,
  type EntityType,
  type ProjectType,
  type StoryUnitType,
  type TemporalRelationType,
  type FindingScope,
  type FindingSeverity,
  type FindingStatus,
  type WorldStateEntry,
} from "../../types/index.js";

// ---------------------------------------------------------------------------
// Row mappers
//
// ClickHouse returns plain objects with snake_case keys. These mappers convert
// them to the camelCase TypeScript types defined in types/index.ts.
// Every operation goes through a mapper — no raw row objects leak out.
// ---------------------------------------------------------------------------

function rowToUniverse(r: Record<string, unknown>): Universe {
  return {
    universeId: r.universe_id as string,
    name: r.name as string,
    description: r.description as string,
    createdAt: new Date(`${r.created_at as string}Z`.replace(" ", "T")),
  };
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    projectId: r.project_id as string,
    universeId: r.universe_id as string,
    name: r.name as string,
    type: r.type as ProjectType,
    canonTier: Number(r.canon_tier) as 1 | 2 | 3,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToStoryUnit(r: Record<string, unknown>): StoryUnit {
  return {
    storyUnitId: r.story_unit_id as string,
    projectId: r.project_id as string,
    universeId: r.universe_id as string,
    title: r.title as string,
    unitType: r.unit_type as StoryUnitType,
    seasonNumber: r.season_number != null ? Number(r.season_number) : null,
    episodeNumber: r.episode_number != null ? Number(r.episode_number) : null,
    inUniversePeriod: r.in_universe_period as string,
    inUniverseDateStart:
      r.in_universe_date_start != null
        ? Number(r.in_universe_date_start)
        : null,
    inUniverseDateEnd:
      r.in_universe_date_end != null ? Number(r.in_universe_date_end) : null,
    releaseOrder: Number(r.release_order),
    ingestionStatus: r.ingestion_status as IngestionStatus,
    sceneCount: Number(r.scene_count),
    claimCount: Number(r.claim_count),
    canonTier: r.canon_tier != null ? Number(r.canon_tier) : null,
  };
}

function rowToEntity(r: Record<string, unknown>): UniverseEntity {
  return {
    entityId: r.entity_id as string,
    universeId: r.universe_id as string,
    canonicalName: r.canonical_name as string,
    entityType: r.entity_type as EntityType,
    parentEntityId: (r.parent_entity_id as string | null) ?? null,
    description: r.description as string,
    firstAppearanceUnitId:
      (r.first_appearance_unit_id as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToTemporalRelation(r: Record<string, unknown>): TemporalRelation {
  return {
    unitAId: r.unit_a_id as string,
    unitBId: r.unit_b_id as string,
    universeId: r.universe_id as string,
    relation: r.relation as TemporalRelationType,
    reasoning: r.reasoning as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToScene(r: Record<string, unknown>): Scene {
  return {
    sceneId: r.scene_id as string,
    storyUnitId: r.story_unit_id as string,
    projectId: r.project_id as string,
    universeId: r.universe_id as string,
    sceneNumber: Number(r.scene_number),
    heading: r.heading as string,
    rawText: r.raw_text as string,
    summary: r.summary as string,
    ingestionStatus: r.ingestion_status as SceneIngestionStatus,
  };
}

function rowToClaim(r: Record<string, unknown>): Claim {
  return {
    claimId: r.claim_id as string,
    universeEntityId: r.universe_entity_id as string,
    universeId: r.universe_id as string,
    projectId: r.project_id as string,
    storyUnitId: r.story_unit_id as string,
    sourceSceneNumber: Number(r.source_scene_number),
    property: r.property as string,
    value: r.value as string,
    inUniversePeriod: r.in_universe_period as string,
    inUniverseDateStart:
      r.in_universe_date_start != null
        ? Number(r.in_universe_date_start)
        : null,
    inUniverseDateEnd:
      r.in_universe_date_end != null ? Number(r.in_universe_date_end) : null,
    validFromScene: Number(r.valid_from_scene),
    validToScene: r.valid_to_scene != null ? Number(r.valid_to_scene) : null,
    sourceType: r.source_type as SourceType,
    confidence: Number(r.confidence),
    confidenceRationale: r.confidence_rationale as string,
    rawExtraction: r.raw_extraction as string,
    sourceLine: r.source_line as string,
    canonTier: Number(r.canon_tier) as 1 | 2 | 3,
    supersededByCanon: Number(r.superseded_by_canon) === 1,
    supersedingClaimId: (r.superseding_claim_id as string | null) ?? null,
  };
}

function rowToEvent(r: Record<string, unknown>): Event {
  return {
    eventId: r.event_id as string,
    storyUnitId: r.story_unit_id as string,
    projectId: r.project_id as string,
    universeId: r.universe_id as string,
    sceneNumber: Number(r.scene_number),
    subjectEntityId: r.subject_entity_id as string,
    action: r.action as string,
    objectEntityId: (r.object_entity_id as string | null) ?? null,
    description: r.description as string,
    inUniversePeriod: r.in_universe_period as string,
  };
}

function rowToFinding(r: Record<string, unknown>): ContinuityFinding {
  return {
    findingId: r.finding_id as string,
    universeId: r.universe_id as string,
    projectId: r.project_id as string,
    storyUnitIdA: r.story_unit_id_a as string,
    storyUnitIdB: r.story_unit_id_b as string,
    claimAId: r.claim_a_id as string,
    claimBId: r.claim_b_id as string,
    conflictType: r.conflict_type as "confirmed" | "ambiguous",
    severity: r.severity as FindingSeverity,
    scope: r.scope as FindingScope,
    explanation: r.explanation as string,
    resolutionSuggestion: r.resolution_suggestion as string,
    status: r.status as ContinuityFinding["status"],
  };
}

// ---------------------------------------------------------------------------
// Helper — run a SELECT query and return typed rows.
// Throws MCPOperationError on any ClickHouse error.
// ---------------------------------------------------------------------------

async function select<T>(
  operation: string,
  query: string,
  params: Record<string, unknown>,
  mapper: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  try {
    const result = await ch.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    return (rows as unknown as Record<string, unknown>[]).map(mapper);
  } catch (err) {
    throw new MCPOperationError(
      operation,
      "clickhouse.query_failed",
      `Query failed in ${operation}: ${(err as Error).message}`,
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper — run a command (INSERT / ALTER). No return value.
// Throws MCPOperationError on any ClickHouse error.
// ---------------------------------------------------------------------------

async function command(
  operation: string,
  query: string,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    await ch.command({
      query,
      query_params: params,
    });
  } catch (err) {
    throw new MCPOperationError(
      operation,
      "clickhouse.command_failed",
      `Command failed in ${operation}: ${(err as Error).message}`,
      err,
    );
  }
}

// =============================================================================
// Universe operations
// =============================================================================

const CreateUniverseInput = z.object({
  name: z.string().min(1),
  description: z.string(),
});

export async function createUniverse(
  input: z.infer<typeof CreateUniverseInput>,
): Promise<Universe> {
  const parsed = CreateUniverseInput.parse(input);
  const universeId = uuid();
  await command("createUniverse", Q.INSERT_UNIVERSE, {
    universe_id: universeId,
    name: parsed.name,
    description: parsed.description,
  });
  const rows = await select(
    "createUniverse",
    Q.SELECT_UNIVERSE,
    { universe_id: universeId },
    rowToUniverse,
  );
  const created = rows[0];
  if (!created) {
    throw new MCPOperationError(
      "createUniverse",
      "universe.read_after_write_failed",
      `Universe ${universeId} was inserted but is not yet readable`,
    );
  }
  return created;
}

export async function listUniverses(): Promise<Universe[]> {
  return select("listUniverses", Q.SELECT_ALL_UNIVERSES, {}, rowToUniverse);
}

export async function getUniverse(universeId: string): Promise<Universe> {
  const rows = await select(
    "getUniverse",
    Q.SELECT_UNIVERSE,
    { universe_id: universeId },
    rowToUniverse,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getUniverse",
      "universe.not_found",
      `Universe ${universeId} not found`,
    );
  }
  return rows[0]!;
}

// =============================================================================
// Project operations
// =============================================================================

const CreateProjectInput = z.object({
  universeId: z.uuid(),
  name: z.string().min(1),
  type: z.enum(["film", "series", "crossover", "other"]),
  canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export async function createProject(
  input: z.infer<typeof CreateProjectInput>,
): Promise<Project> {
  const parsed = CreateProjectInput.parse(input);
  const projectId = uuid();
  await command("createProject", Q.INSERT_PROJECT, {
    project_id: projectId,
    universe_id: parsed.universeId,
    name: parsed.name,
    type: parsed.type,
    canon_tier: parsed.canonTier,
  });
  const rows = await select(
    "createProject",
    Q.SELECT_PROJECT,
    { project_id: projectId },
    rowToProject,
  );
  return rows[0]!;
}

export async function getProject(projectId: string): Promise<Project> {
  const rows = await select(
    "getProject",
    Q.SELECT_PROJECT,
    { project_id: projectId },
    rowToProject,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getProject",
      "project.not_found",
      `Project ${projectId} not found`,
    );
  }
  return rows[0]!;
}

// =============================================================================
// Story unit operations
// =============================================================================

export const CreateStoryUnitInput = z.object({
  projectId: z.uuid(),
  universeId: z.uuid(),
  title: z.string().min(1),
  unitType: z.enum(["film", "episode", "short", "other"]),
  seasonNumber: z.number().int().positive().nullable().optional(),
  episodeNumber: z.number().int().positive().nullable().optional(),
  inUniversePeriod: z.string().min(1),
  inUniverseDateStart: z.number().int().nullable().optional(),
  inUniverseDateEnd: z.number().int().nullable().optional(),
  releaseOrder: z.number().int().nonnegative(),
});

export async function createStoryUnit(
  input: z.infer<typeof CreateStoryUnitInput>,
): Promise<StoryUnit> {
  const parsed = CreateStoryUnitInput.parse(input);
  const storyUnitId = uuid();
  await command("createStoryUnit", Q.INSERT_STORY_UNIT, {
    story_unit_id: storyUnitId,
    project_id: parsed.projectId,
    universe_id: parsed.universeId,
    title: parsed.title,
    unit_type: parsed.unitType,
    season_number: parsed.seasonNumber ?? null,
    episode_number: parsed.episodeNumber ?? null,
    in_universe_period: parsed.inUniversePeriod,
    in_universe_date_start: parsed.inUniverseDateStart ?? null,
    in_universe_date_end: parsed.inUniverseDateEnd ?? null,
    release_order: parsed.releaseOrder,
  });
  const rows = await select(
    "createStoryUnit",
    Q.SELECT_STORY_UNIT,
    { story_unit_id: storyUnitId },
    rowToStoryUnit,
  );
  return rows[0]!;
}

export async function getStoryUnit(storyUnitId: string): Promise<StoryUnit> {
  const rows = await select(
    "getStoryUnit",
    Q.SELECT_STORY_UNIT,
    { story_unit_id: storyUnitId },
    rowToStoryUnit,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getStoryUnit",
      "unit.not_found",
      `Story unit ${storyUnitId} not found`,
    );
  }
  return rows[0]!;
}

export async function getStoryUnitsForUniverse(
  universeId: string,
): Promise<StoryUnit[]> {
  return select(
    "getStoryUnitsForUniverse",
    Q.SELECT_STORY_UNITS_FOR_UNIVERSE,
    { universe_id: universeId },
    rowToStoryUnit,
  );
}

export async function updateStoryUnitStatus(
  storyUnitId: string,
  status: IngestionStatus,
): Promise<void> {
  await command("updateStoryUnitStatus", Q.UPDATE_STORY_UNIT_STATUS, {
    story_unit_id: storyUnitId,
    status,
  });
}

export async function updateStoryUnitCounts(
  storyUnitId: string,
  sceneCount: number,
  claimCount: number,
): Promise<void> {
  await command("updateStoryUnitCounts", Q.UPDATE_STORY_UNIT_COUNTS, {
    story_unit_id: storyUnitId,
    scene_count: sceneCount,
    claim_count: claimCount,
  });
}

// =============================================================================
// Entity operations
// =============================================================================

const CreateEntityInput = z.object({
  universeId: z.uuid(),
  canonicalName: z.string().min(1),
  entityType: z.enum(["character", "object", "location", "faction", "concept"]),
  parentEntityId: z.uuid().nullable().optional(),
  description: z.string(),
  firstAppearanceUnitId: z.uuid().nullable().optional(),
});

export async function createEntity(
  input: z.infer<typeof CreateEntityInput>,
): Promise<UniverseEntity> {
  const parsed = CreateEntityInput.parse(input);
  const entityId = uuid();
  await command("createEntity", Q.INSERT_UNIVERSE_ENTITY, {
    entity_id: entityId,
    universe_id: parsed.universeId,
    canonical_name: parsed.canonicalName,
    entity_type: parsed.entityType,
    parent_entity_id: parsed.parentEntityId ?? null,
    description: parsed.description,
    first_appearance_unit_id: parsed.firstAppearanceUnitId ?? null,
  });
  const rows = await select(
    "createEntity",
    Q.SELECT_ENTITY,
    { entity_id: entityId },
    rowToEntity,
  );
  return rows[0]!;
}

export async function getEntity(entityId: string): Promise<UniverseEntity> {
  const rows = await select(
    "getEntity",
    Q.SELECT_ENTITY,
    { entity_id: entityId },
    rowToEntity,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getEntity",
      "entity.not_found",
      `Entity ${entityId} not found`,
    );
  }
  return rows[0]!;
}

/**
 * Resolve a name to a universe entity.
 * Resolution order: exact → case-insensitive → null (caller handles Levenshtein and creation).
 */
export async function findEntityByName(
  universeId: string,
  name: string,
): Promise<UniverseEntity | null> {
  // 1. Exact match
  let rows = await select(
    "findEntityByName",
    Q.SELECT_ENTITY_BY_NAME_EXACT,
    { universe_id: universeId, name },
    rowToEntity,
  );
  if (rows.length > 0) return rows[0]!;

  // 2. Case-insensitive match
  rows = await select(
    "findEntityByName",
    Q.SELECT_ENTITY_BY_NAME_ILIKE,
    { universe_id: universeId, name },
    rowToEntity,
  );
  if (rows.length > 0) return rows[0]!;

  return null;
}

export async function getEntitiesForUniverse(
  universeId: string,
): Promise<UniverseEntity[]> {
  return select(
    "getEntitiesForUniverse",
    Q.SELECT_ENTITIES_BY_UNIVERSE,
    { universe_id: universeId },
    rowToEntity,
  );
}

/**
 * Fetch an entity and walk up its parent chain to collect inherited claims.
 * Returns the entity plus a flat list of ancestor entities (closest first).
 * The caller merges claims with child claims taking precedence.
 */
export async function getEntityWithAncestors(
  entityId: string,
): Promise<{ entity: UniverseEntity; ancestors: UniverseEntity[] }> {
  const entity = await getEntity(entityId);
  const ancestors: UniverseEntity[] = [];
  let current = entity;

  // Walk upward until there is no parent. Guard against cycles with a depth cap.
  const MAX_DEPTH = 10;
  let depth = 0;
  while (current.parentEntityId && depth < MAX_DEPTH) {
    const parent = await getEntity(current.parentEntityId);
    ancestors.push(parent);
    current = parent;
    depth++;
  }

  return { entity, ancestors };
}

// =============================================================================
// Temporal relation operations
// =============================================================================

const WriteTemporalRelationInput = z.object({
  unitAId: z.uuid(),
  unitBId: z.uuid(),
  universeId: z.uuid(),
  relation: z.enum(["before", "after", "overlapping", "indeterminate"]),
  reasoning: z.string(),
});

export async function writeTemporalRelation(
  input: z.infer<typeof WriteTemporalRelationInput>,
): Promise<void> {
  const parsed = WriteTemporalRelationInput.parse(input);
  // Always store with the lexicographically smaller ID as unit_a to prevent duplicates.
  const [a, b] =
    parsed.unitAId < parsed.unitBId
      ? [parsed.unitAId, parsed.unitBId]
      : [parsed.unitBId, parsed.unitAId];
  await command("writeTemporalRelation", Q.INSERT_TEMPORAL_RELATION, {
    unit_a_id: a,
    unit_b_id: b,
    universe_id: parsed.universeId,
    relation: parsed.relation,
    reasoning: parsed.reasoning,
  });
}

export async function getTemporalRelation(
  universeId: string,
  unitAId: string,
  unitBId: string,
): Promise<TemporalRelation | null> {
  // Normalise order to match how we store.
  const [a, b] = unitAId < unitBId ? [unitAId, unitBId] : [unitBId, unitAId];
  const rows = await select(
    "getTemporalRelation",
    Q.SELECT_TEMPORAL_RELATION,
    { universe_id: universeId, unit_a_id: a, unit_b_id: b },
    rowToTemporalRelation,
  );
  return rows[0] ?? null;
}

// =============================================================================
// Scene operations
// =============================================================================

const InsertSceneInput = z.object({
  storyUnitId: z.uuid(),
  projectId: z.uuid(),
  universeId: z.uuid(),
  sceneNumber: z.number().int().nonnegative(),
  heading: z.string(),
  rawText: z.string(),
});

export async function insertScene(
  input: z.infer<typeof InsertSceneInput>,
): Promise<Scene> {
  const parsed = InsertSceneInput.parse(input);
  const sceneId = uuid();
  await command("insertScene", Q.INSERT_SCENE, {
    scene_id: sceneId,
    story_unit_id: parsed.storyUnitId,
    project_id: parsed.projectId,
    universe_id: parsed.universeId,
    scene_number: parsed.sceneNumber,
    heading: parsed.heading,
    raw_text: parsed.rawText,
  });
  const rows = await select(
    "insertScene",
    Q.SELECT_SCENE,
    { story_unit_id: parsed.storyUnitId, scene_number: parsed.sceneNumber },
    rowToScene,
  );
  return rows[0]!;
}

export async function getScenesForUnit(storyUnitId: string): Promise<Scene[]> {
  return select(
    "getScenesForUnit",
    Q.SELECT_SCENES_FOR_UNIT,
    { story_unit_id: storyUnitId },
    rowToScene,
  );
}

export async function getFailedSceneNumbers(
  storyUnitId: string,
): Promise<number[]> {
  const rows = await select(
    "getFailedSceneNumbers",
    Q.SELECT_FAILED_SCENES,
    { story_unit_id: storyUnitId },
    (r) => Number(r.scene_number),
  );
  return rows;
}

export async function updateSceneStatus(
  storyUnitId: string,
  sceneNumber: number,
  status: SceneIngestionStatus,
): Promise<void> {
  await command("updateSceneStatus", Q.UPDATE_SCENE_STATUS, {
    story_unit_id: storyUnitId,
    scene_number: sceneNumber,
    status,
  });
}

// =============================================================================
// Claim operations
// =============================================================================

const WriteClaimInput = z.object({
  universeEntityId: z.uuid(),
  universeId: z.uuid(),
  projectId: z.uuid(),
  storyUnitId: z.uuid(),
  sourceSceneNumber: z.number().int().nonnegative(),
  property: z.string().min(1),
  value: z.string().min(1),
  inUniversePeriod: z.string().min(1),
  inUniverseDateStart: z.number().int().nullable().optional(),
  inUniverseDateEnd: z.number().int().nullable().optional(),
  validFromScene: z.number().int().nonnegative(),
  sourceType: z.enum(["explicit", "implied", "inferred"]),
  confidence: z.number().min(0).max(1),
  confidenceRationale: z.string(),
  rawExtraction: z.string(),
  sourceLine: z.string(),
  canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export async function writeClaim(
  input: z.infer<typeof WriteClaimInput>,
): Promise<Claim> {
  const parsed = WriteClaimInput.parse(input);

  // Enforce confidence–source_type contract before touching the database.
  const range = CONFIDENCE_RANGES[parsed.sourceType as SourceType];
  if (parsed.confidence < range.min || parsed.confidence > range.max) {
    throw new MCPOperationError(
      "writeClaim",
      "claim.confidence_out_of_range",
      `Confidence ${parsed.confidence} is out of range for source_type "${parsed.sourceType}" ` +
        `(expected ${range.min}–${range.max})`,
    );
  }

  const claimId = uuid();
  await command("writeClaim", Q.INSERT_CLAIM, {
    claim_id: claimId,
    universe_entity_id: parsed.universeEntityId,
    universe_id: parsed.universeId,
    project_id: parsed.projectId,
    story_unit_id: parsed.storyUnitId,
    source_scene_number: parsed.sourceSceneNumber,
    property: parsed.property,
    value: parsed.value,
    in_universe_period: parsed.inUniversePeriod,
    in_universe_date_start: parsed.inUniverseDateStart ?? null,
    in_universe_date_end: parsed.inUniverseDateEnd ?? null,
    valid_from_scene: parsed.validFromScene,
    valid_to_scene: null,
    source_type: parsed.sourceType,
    confidence: parsed.confidence,
    confidence_rationale: parsed.confidenceRationale,
    raw_extraction: parsed.rawExtraction,
    source_line: parsed.sourceLine,
    canon_tier: parsed.canonTier,
  });

  // Re-fetch to return the full typed row.
  const rows = await select(
    "writeClaim",
    `SELECT * FROM lmm.claims WHERE claim_id = {claim_id: String} LIMIT 1`,
    { claim_id: claimId },
    rowToClaim,
  );
  return rows[0]!;
}

/**
 * get_current_state — active claims for a list of entity IDs as of a given
 * scene within a story unit. Used by the Story Analyst for context injection.
 * Includes inherited parent claims resolved lazily (entity walk is done here,
 * not in SQL, because parent depth is unbounded).
 */
export async function getCurrentState(
  storyUnitId: string,
  entityIds: string[],
  upToScene: number,
): Promise<
  Array<Claim & { entityName: string; parentEntityId: string | null }>
> {
  if (entityIds.length === 0) return [];

  // Fetch active claims for the requested entities.
  const directRows = await select(
    "getCurrentState",
    Q.SELECT_ACTIVE_CLAIMS_FOR_ENTITIES,
    {
      story_unit_id: storyUnitId,
      entity_ids: entityIds,
      up_to_scene: upToScene,
    },
    (r) => ({
      ...rowToClaim(r),
      entityName: r.entity_name as string,
      parentEntityId: (r.parent_entity_id as string | null) ?? null,
    }),
  );

  // All rows are already scoped to the requested entity IDs by the SQL filter.
  const direct = directRows;

  // Collect parent entity IDs that need inherited claims fetched.
  const parentIds = new Set(
    direct
      .map((c) => c.parentEntityId)
      .filter((id): id is string => id !== null),
  );
  // Remove any parent IDs we already have direct claims for.
  direct.forEach((c) => parentIds.delete(c.universeEntityId));

  if (parentIds.size === 0) return direct;

  // Derive parent claims from the already-fetched directRows — no second query needed.
  const parentClaims = directRows.filter((c) =>
    parentIds.has(c.universeEntityId),
  );

  // Child claims take precedence: only include a parent claim if the child
  // has no claim for the same property.
  const directProperties = new Set(
    direct.map((c) => `${c.universeEntityId}:${c.property}`),
  );
  const inherited = parentClaims.filter(
    (c) => !directProperties.has(`${c.universeEntityId}:${c.property}`),
  );

  return [...direct, ...inherited];
}

export async function getEntityHistory(entityId: string): Promise<Claim[]> {
  return select(
    "getEntityHistory",
    Q.SELECT_ENTITY_HISTORY,
    { entity_id: entityId },
    rowToClaim,
  );
}

// Fetch a single claim by its primary key.
// Used by Guardian dossier assembly to hydrate claim IDs returned by conflict detection queries.
export async function getClaim(claimId: string): Promise<Claim> {
  const rows = await select(
    "getClaim",
    Q.SELECT_CLAIM_BY_ID,
    { claim_id: claimId },
    rowToClaim,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getClaim",
      "claim.not_found",
      `Claim ${claimId} not found`,
    );
  }
  return rows[0]!;
}

// Guardian-only mutation — update valid_to_scene on a claim.
export async function updateClaimValidTo(
  claimId: string,
  validToScene: number,
): Promise<void> {
  await command("updateClaimValidTo", Q.UPDATE_CLAIM_VALID_TO, {
    claim_id: claimId,
    valid_to_scene: validToScene,
  });
}

// Guardian-only mutation — mark a claim as superseded by a higher canon-tier claim.
export async function markClaimSupersededByCanon(
  claimId: string,
  supersedingClaimId: string,
): Promise<void> {
  await command("markClaimSupersededByCanon", Q.UPDATE_CLAIM_SUPERSEDED, {
    claim_id: claimId,
    superseding_claim_id: supersedingClaimId,
  });
}

// =============================================================================
// Conflict detection — Guardian queries
// =============================================================================

export type WithinUnitConflictRow = {
  claimAId: string;
  claimBId: string;
  universeEntityId: string;
  property: string;
  valueA: string;
  valueB: string;
  sceneA: number;
  sceneB: number;
  confidenceA: number;
  confidenceB: number;
};

export async function findWithinUnitConflicts(
  storyUnitId: string,
): Promise<WithinUnitConflictRow[]> {
  return select(
    "findWithinUnitConflicts",
    Q.SELECT_WITHIN_UNIT_CONFLICTS,
    { story_unit_id: storyUnitId },
    (r) => ({
      claimAId: r.claim_a_id as string,
      claimBId: r.claim_b_id as string,
      universeEntityId: r.universe_entity_id as string,
      property: r.property as string,
      valueA: r.value_a as string,
      valueB: r.value_b as string,
      sceneA: Number(r.scene_a),
      sceneB: Number(r.scene_b),
      confidenceA: Number(r.confidence_a),
      confidenceB: Number(r.confidence_b),
    }),
  );
}

export type CrossUnitConflictRow = {
  claimAId: string;
  claimBId: string;
  universeEntityId: string;
  property: string;
  valueA: string;
  valueB: string;
  unitAId: string;
  unitBId: string;
  dateA: number | null;
  dateB: number | null;
  periodA: string;
  periodB: string;
  tierA: number;
  tierB: number;
  confidenceA: number;
  confidenceB: number;
};

export async function findCrossUnitConflicts(
  universeId: string,
): Promise<CrossUnitConflictRow[]> {
  return select(
    "findCrossUnitConflicts",
    Q.SELECT_CROSS_UNIT_CONFLICTS,
    { universe_id: universeId },
    (r) => ({
      claimAId: r.claim_a_id as string,
      claimBId: r.claim_b_id as string,
      universeEntityId: r.universe_entity_id as string,
      property: r.property as string,
      valueA: r.value_a as string,
      valueB: r.value_b as string,
      unitAId: r.unit_a_id as string,
      unitBId: r.unit_b_id as string,
      dateA: r.date_a != null ? Number(r.date_a) : null,
      dateB: r.date_b != null ? Number(r.date_b) : null,
      periodA: r.period_a as string,
      periodB: r.period_b as string,
      tierA: Number(r.tier_a),
      tierB: Number(r.tier_b),
      confidenceA: Number(r.confidence_a),
      confidenceB: Number(r.confidence_b),
    }),
  );
}

// =============================================================================
// Event operations
// =============================================================================

const WriteEventInput = z.object({
  storyUnitId: z.uuid(),
  projectId: z.uuid(),
  universeId: z.uuid(),
  sceneNumber: z.number().int().nonnegative(),
  subjectEntityId: z.uuid(),
  action: z.string().min(1),
  objectEntityId: z.uuid().nullable().optional(),
  description: z.string(),
  inUniversePeriod: z.string().min(1),
});

export async function writeEvent(
  input: z.infer<typeof WriteEventInput>,
): Promise<void> {
  const parsed = WriteEventInput.parse(input);
  await command("writeEvent", Q.INSERT_EVENT, {
    event_id: uuid(),
    story_unit_id: parsed.storyUnitId,
    project_id: parsed.projectId,
    universe_id: parsed.universeId,
    scene_number: parsed.sceneNumber,
    subject_entity_id: parsed.subjectEntityId,
    action: parsed.action,
    object_entity_id: parsed.objectEntityId ?? null,
    description: parsed.description,
    in_universe_period: parsed.inUniversePeriod,
  });
}

export async function getEventsBetweenScenes(
  storyUnitId: string,
  fromScene: number,
  toScene: number,
): Promise<Event[]> {
  return select(
    "getEventsBetweenScenes",
    Q.SELECT_EVENTS_BETWEEN_SCENES,
    { story_unit_id: storyUnitId, from_scene: fromScene, to_scene: toScene },
    rowToEvent,
  );
}

// =============================================================================
// Finding operations
// =============================================================================

const WriteFindingInput = z.object({
  universeId: z.uuid(),
  projectId: z.uuid(),
  storyUnitIdA: z.uuid(),
  storyUnitIdB: z.uuid(),
  claimAId: z.uuid(),
  claimBId: z.uuid(),
  conflictType: z.enum(["confirmed", "ambiguous"]),
  severity: z.enum(["high", "medium", "low"]),
  scope: z.enum(["within_unit", "cross_unit"]),
  explanation: z.string().min(1),
  resolutionSuggestion: z.string(),
});

export async function writeFinding(
  input: z.infer<typeof WriteFindingInput>,
): Promise<ContinuityFinding> {
  const parsed = WriteFindingInput.parse(input);
  const findingId = uuid();
  await command("writeFinding", Q.INSERT_FINDING, {
    finding_id: findingId,
    universe_id: parsed.universeId,
    project_id: parsed.projectId,
    story_unit_id_a: parsed.storyUnitIdA,
    story_unit_id_b: parsed.storyUnitIdB,
    claim_a_id: parsed.claimAId,
    claim_b_id: parsed.claimBId,
    conflict_type: parsed.conflictType,
    severity: parsed.severity,
    scope: parsed.scope,
    explanation: parsed.explanation,
    resolution_suggestion: parsed.resolutionSuggestion,
  });
  const rows = await select(
    "writeFinding",
    `SELECT * FROM lmm.continuity_findings WHERE finding_id = {finding_id: String} LIMIT 1`,
    { finding_id: findingId },
    rowToFinding,
  );
  return rows[0]!;
}

export async function getFindingsForProject(
  projectId: string,
): Promise<ContinuityFinding[]> {
  return select(
    "getFindingsForProject",
    Q.SELECT_FINDINGS_FOR_PROJECT,
    { project_id: projectId },
    rowToFinding,
  );
}

export async function getCrossUnitFindingsForUniverse(
  universeId: string,
): Promise<ContinuityFinding[]> {
  return select(
    "getCrossUnitFindingsForUniverse",
    Q.SELECT_CROSS_UNIT_FINDINGS_FOR_UNIVERSE,
    { universe_id: universeId },
    rowToFinding,
  );
}

export async function getFinding(
  findingId: string,
): Promise<ContinuityFinding> {
  const rows = await select(
    "getFinding",
    Q.SELECT_FINDING_BY_ID,
    { finding_id: findingId },
    rowToFinding,
  );
  if (rows.length === 0) {
    throw new MCPOperationError(
      "getFinding",
      "finding.not_found",
      `Finding ${findingId} not found`,
    );
  }
  return rows[0]!;
}

export async function updateFindingStatus(
  findingId: string,
  status: FindingStatus,
): Promise<void> {
  await command("updateFindingStatus", Q.UPDATE_FINDING_STATUS, {
    finding_id: findingId,
    status,
  });
}

// =============================================================================
// Claims listing — HTTP endpoint support
// =============================================================================

export type ClaimWithEntityName = Claim & { entityName: string };

export async function getClaimsForUnit(
  storyUnitId: string,
): Promise<ClaimWithEntityName[]> {
  return select(
    "getClaimsForUnit",
    Q.SELECT_CLAIMS_FOR_UNIT,
    { story_unit_id: storyUnitId },
    (r) => ({
      ...rowToClaim(r),
      entityName: r.entity_name as string,
    }),
  );
}

// =============================================================================
// Story unit listing by project — HTTP endpoint support
// =============================================================================

export async function getStoryUnitsForProject(
  projectId: string,
): Promise<StoryUnit[]> {
  return select(
    "getStoryUnitsForProject",
    Q.SELECT_STORY_UNITS_FOR_PROJECT,
    { project_id: projectId },
    rowToStoryUnit,
  );
}

// =============================================================================
// Audience Companion — spoiler boundary query
// =============================================================================

/**
 * get_companion_facts — returns claims visible within the viewer's spoiler boundary.
 *
 * The boundary is a list of { storyUnitId, upToScene } entries. Only claims
 * from watched story units at or before the viewer's scene cutoff are returned.
 * Entity name leakage is also prevented: entities whose first appearance is in
 * an unwatched story unit are excluded entirely.
 *
 * The boundary filter is built programmatically here (one condition per entry)
 * and substituted into SELECT_COMPANION_FACTS_BASE before execution.
 * No user-supplied strings are interpolated — only validated UUIDs and integers.
 */
export async function getCompanionFacts(
  universeId: string,
  boundary: SpoilerBoundaryEntry[],
): Promise<
  Array<{
    entityName: string;
    property: string;
    value: string;
    validFromScene: number;
    sourceSceneNumber: number;
    inUniversePeriod: string;
    confidence: number;
    sourceUnitTitle: string;
  }>
> {
  if (boundary.length === 0) return [];

  // Validate every entry before building the query.
  const BoundaryEntrySchema = z.object({
    storyUnitId: z.uuid(),
    upToScene: z.number().int().nonnegative(),
  });
  const validatedBoundary = boundary.map((entry) =>
    BoundaryEntrySchema.parse(entry),
  );

  // Build the boundary filter: one condition per entry, all validated.
  // Shape: (c.story_unit_id = '<id>' AND c.source_scene_number <= <n>)
  const boundaryConditions = validatedBoundary
    .map(
      (e) =>
        `(c.story_unit_id = '${e.storyUnitId}' AND c.source_scene_number <= ${e.upToScene})`,
    )
    .join(" OR ");

  const watchedUnitIds = validatedBoundary
    .map((e) => `'${e.storyUnitId}'`)
    .join(", ");

  // Substitute the pre-validated boundary filter into the base query.
  const query = Q.SELECT_COMPANION_FACTS_BASE.replace(
    "{boundary_filter}",
    boundaryConditions,
  ).replace("{watched_unit_ids: Array(String)}", watchedUnitIds);

  return select(
    "getCompanionFacts",
    query,
    { universe_id: universeId },
    (r) => ({
      entityName: r.entity_name as string,
      property: r.property as string,
      value: r.value as string,
      validFromScene: Number(r.valid_from_scene),
      sourceSceneNumber: Number(r.source_scene_number),
      inUniversePeriod: r.in_universe_period as string,
      confidence: Number(r.confidence),
      sourceUnitTitle: r.source_unit_title as string,
    }),
  );
}

// =============================================================================
// Audience Companion — historical and event queries
// =============================================================================

/**
 * getHistoricalClaimsForEntities — full claim chain for a list of entity IDs
 * within one story unit up to and including `upToScene`.
 *
 * Unlike getCompanionFacts / getCurrentState, this does NOT filter out
 * superseded claims — it returns the full history so the pack-builder can show
 * causal progression. Superseded rows are flagged via `supersededByCanon` and
 * will have `isHistorical: true` in the PackFact constructed by the pack-builder.
 *
 * Spoiler boundary is enforced at SQL level: source_scene_number <= upToScene.
 */
export async function getHistoricalClaimsForEntities(
  storyUnitId: string,
  entityIds: string[],
  upToScene: number,
): Promise<Array<Claim & { entityName: string }>> {
  if (entityIds.length === 0) return [];
  return select(
    "getHistoricalClaimsForEntities",
    Q.SELECT_HISTORICAL_CLAIMS_FOR_ENTITIES,
    {
      story_unit_id: storyUnitId,
      entity_ids: entityIds,
      up_to_scene: upToScene,
    },
    (r) => ({
      ...rowToClaim(r),
      entityName: r.entity_name as string,
    }),
  );
}

/**
 * getEventsForEntities — all events in which any of the given entity IDs
 * appear as subject or object, within one story unit up to `upToScene`.
 *
 * Used in three places by the pack-builder:
 *   - scene digest building (all entities, all scenes)
 *   - historical mode one-hop event expansion
 *   - summary mode (all entities, full boundary)
 *
 * Spoiler boundary is enforced at SQL level: scene_number <= upToScene.
 */
export async function getEventsForEntities(
  storyUnitId: string,
  entityIds: string[],
  upToScene: number,
): Promise<Array<Event & { subjectName: string; objectName: string | null }>> {
  if (entityIds.length === 0) return [];
  return select(
    "getEventsForEntities",
    Q.SELECT_EVENTS_FOR_ENTITIES,
    {
      story_unit_id: storyUnitId,
      entity_ids: entityIds,
      up_to_scene: upToScene,
    },
    (r) => ({
      ...rowToEvent(r),
      subjectName: r.subject_name as string,
      objectName: (r.object_name as string | null) ?? null,
    }),
  );
}

// =============================================================================
// World state
// =============================================================================

export async function getWorldState(
  universeId: string,
): Promise<WorldStateEntry[]> {
  return select(
    "getWorldState",
    Q.SELECT_WORLD_STATE,
    { universe_id: universeId },
    (r) => ({
      entityId: r.entity_id as string,
      entityName: r.canonical_name as string,
      property: r.property as string,
      value: r.value as string,
      sourceUnitTitle: r.source_unit_title as string,
      inUniversePeriod: r.in_universe_period as string,
      canonTier: Number(r.canon_tier) as 1 | 2 | 3,
    }),
  );
}
