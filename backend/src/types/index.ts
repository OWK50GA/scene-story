import { z } from "zod";

// =============================================================================
// Enums and literal unions
// =============================================================================

export type ProjectType = "film" | "series" | "crossover" | "other";

export type StoryUnitType = "film" | "episode" | "short" | "other";

export type EntityType =
  | "character"
  | "object"
  | "location"
  | "faction"
  | "concept";

export type SourceType = "explicit" | "implied" | "inferred";

export type ConflictType = "confirmed" | "normal_transition" | "ambiguous";

export type FindingSeverity = "high" | "medium" | "low";

export type FindingScope = "within_unit" | "cross_unit";

export type FindingStatus = "open" | "marked_intentional" | "resolved";

export type IngestionStatus = "pending" | "ingesting" | "complete" | "failed";

export type SceneIngestionStatus = "pending" | "complete" | "failed";

/**
 * Temporal relation between two story units, resolved either by precise dates
 * or by Gemini semantic reasoning over fuzzy period labels.
 */
export type TemporalRelationType =
  | "before"
  | "after"
  | "overlapping"
  | "indeterminate";

// =============================================================================
// Confidence range constants — enforced by write_claim MCP operation
// =============================================================================

export const CONFIDENCE_RANGES: Record<
  SourceType,
  { min: number; max: number }
> = {
  explicit: { min: 0.9, max: 1.0 },
  implied: { min: 0.75, max: 0.89 },
  inferred: { min: 0.0, max: 0.6 },
};

// =============================================================================
// Data layer — mirrors the 9 ClickHouse tables exactly
// =============================================================================

/** Root container. Everything belongs to a universe. */
export type Universe = {
  universeId: string;
  name: string;
  description: string;
  createdAt: Date;
};

/**
 * A creative work within a universe: a single film, a film series,
 * a TV series, or a crossover. canon_tier controls conflict resolution:
 * 1 = primary canon, 2 = secondary, 3 = non-canon.
 */
export type Project = {
  projectId: string;
  universeId: string;
  name: string;
  type: ProjectType;
  canonTier: 1 | 2 | 3;
  createdAt: Date;
};

/**
 * A single self-contained narrative: one film or one episode.
 * This is the unit of ingestion.
 *
 * inUniversePeriod is always required.
 * inUniverseDateStart / inUniverseDateEnd are year integers (e.g. 1943),
 * null when only a fuzzy period label is available.
 * releaseOrder is the global release position within the universe —
 * used as a temporal ordering fallback when precise dates are absent.
 */
export type StoryUnit = {
  storyUnitId: string;
  projectId: string;
  universeId: string;
  title: string;
  unitType: StoryUnitType;
  seasonNumber: number | null;
  episodeNumber: number | null;
  inUniversePeriod: string;
  inUniverseDateStart: number | null;
  inUniverseDateEnd: number | null;
  releaseOrder: number;
  ingestionStatus: IngestionStatus;
  sceneCount: number;
  claimCount: number;
};

/**
 * A universe-scoped entity: character, object, location, faction, or concept.
 * Entities are never owned by a project or story unit — they participate in them.
 *
 * parentEntityId links to a broader entity type (e.g. Tesseract → Infinity Stone).
 * Inheritance is resolved lazily at query time.
 */
export type UniverseEntity = {
  entityId: string;
  universeId: string;
  canonicalName: string;
  entityType: EntityType;
  parentEntityId: string | null;
  description: string;
  firstAppearanceUnitId: string | null;
  createdAt: Date;
};

/**
 * A resolved temporal ordering between two story units.
 * unitAId is always lexicographically less than unitBId to avoid duplicate pairs.
 * reasoning stores Gemini's explanation for auditability.
 */
export type TemporalRelation = {
  unitAId: string;
  unitBId: string;
  universeId: string;
  relation: TemporalRelationType;
  reasoning: string;
  createdAt: Date;
};

/** A numbered scene within a story unit, parsed from a screenplay. */
export type Scene = {
  sceneId: string;
  storyUnitId: string;
  projectId: string;
  universeId: string;
  sceneNumber: number;
  heading: string;
  rawText: string;
  summary: string;
  ingestionStatus: SceneIngestionStatus;
};

/**
 * A single structured fact about a universe entity.
 *
 * validToScene is null for active (current) claims; set by the Guardian when
 * a later claim supersedes this one. Claims are never deleted.
 *
 * supersededByCanon is true when a higher canon-tier claim from another project
 * overrides this one. The claim is preserved for auditability.
 *
 * Temporal fields (inUniversePeriod, inUniverseDateStart, inUniverseDateEnd)
 * are inherited from the source story unit at write time.
 */
export type Claim = {
  claimId: string;
  universeEntityId: string;
  universeId: string;
  projectId: string;
  storyUnitId: string;
  sourceSceneNumber: number;
  property: string;
  value: string;
  inUniversePeriod: string;
  inUniverseDateStart: number | null;
  inUniverseDateEnd: number | null;
  validFromScene: number;
  validToScene: number | null;
  sourceType: SourceType;
  confidence: number;
  confidenceRationale: string;
  rawExtraction: string;
  sourceLine: string;
  canonTier: 1 | 2 | 3;
  supersededByCanon: boolean;
  supersedingClaimId: string | null;
};

/** An action that occurs in a scene, connecting a subject entity to an optional object. */
export type Event = {
  eventId: string;
  storyUnitId: string;
  projectId: string;
  universeId: string;
  sceneNumber: number;
  subjectEntityId: string;
  action: string;
  objectEntityId: string | null;
  description: string;
  inUniversePeriod: string;
};

/**
 * A continuity conflict detected by the Guardian.
 *
 * scope distinguishes within-unit findings (storyUnitIdA === storyUnitIdB)
 * from cross-unit findings (different story units).
 * status is mutable — only field that changes after creation.
 */
export type ContinuityFinding = {
  findingId: string;
  universeId: string;
  projectId: string;
  storyUnitIdA: string;
  storyUnitIdB: string;
  claimAId: string;
  claimBId: string;
  conflictType: Exclude<ConflictType, "normal_transition">;
  severity: FindingSeverity;
  scope: FindingScope;
  explanation: string;
  resolutionSuggestion: string;
  status: FindingStatus;
};

// =============================================================================
// Agent layer — Zod schemas for Gemini outputs
// =============================================================================

/**
 * The JSON structure the Story Analyst expects Gemini to return for each scene.
 * Validated with Zod before any writes are attempted.
 */
export const SceneExtractionSchema = z.object({
  entities: z.array(
    z.object({
      canonicalName: z.string().min(1),
      entityType: z.enum([
        "character",
        "object",
        "location",
        "faction",
        "concept",
      ]),
      description: z.string(),
      /**
       * Non-null when the scene text explicitly identifies this entity as
       * belonging to a broader type (e.g. "the Tesseract, one of the Infinity Stones").
       * The system looks up this name in the universe entity registry and sets
       * parentEntityId if a match is found.
       */
      parentEntityName: z.string().nullable(),
    })
  ),
  claims: z.array(
    z.discriminatedUnion("sourceType", [
      z.object({
        entityName: z.string().min(1),
        property: z.string().min(1),
        value: z.string().min(1),
        sourceType: z.literal("explicit"),
        confidence: z.number().min(0.9).max(1.0),
        confidenceRationale: z.string(),
        sourceLine: z.string(),
      }),
      z.object({
        entityName: z.string().min(1),
        property: z.string().min(1),
        value: z.string().min(1),
        sourceType: z.literal("implied"),
        confidence: z.number().min(0.75).max(0.89),
        confidenceRationale: z.string(),
        sourceLine: z.string(),
      }),
      z.object({
        entityName: z.string().min(1),
        property: z.string().min(1),
        value: z.string().min(1),
        sourceType: z.literal("inferred"),
        confidence: z.number().min(0.0).max(0.6),
        confidenceRationale: z.string(),
        sourceLine: z.string(),
      }),
    ])
  ),
  events: z.array(
    z.object({
      subject: z.string().min(1),
      action: z.string().min(1),
      object: z.string().nullable(),
      description: z.string(),
    })
  ),
});

export type SceneExtraction = z.infer<typeof SceneExtractionSchema>;

/**
 * The JSON structure the Guardian expects Gemini to return for each claim pair.
 */
export const GuardianVerdictSchema = z.object({
  conflictType: z.enum(["confirmed", "normal_transition", "ambiguous"]),
  severity: z.enum(["high", "medium", "low"]),
  explanation: z.string(),
  resolutionSuggestion: z.string(),
});

export type GuardianVerdict = z.infer<typeof GuardianVerdictSchema>;

/**
 * The JSON structure expected from Gemini when resolving temporal ordering
 * between two story units with fuzzy period labels.
 */
export const TemporalResolutionSchema = z.object({
  relation: z.enum(["before", "after", "overlapping", "indeterminate"]),
  reasoning: z.string(),
});

export type TemporalResolution = z.infer<typeof TemporalResolutionSchema>;

// =============================================================================
// Observability
// =============================================================================

export type AgentName =
  | "director"
  | "story-analyst"
  | "guardian"
  | "companion";

export type LogEvent = {
  agent: AgentName;
  universeId: string;
  projectId?: string;
  storyUnitId?: string;
  sceneNumber?: number;
  eventType: string;
  durationMs?: number;
  status: "success" | "failure" | "retry";
  scope?: FindingScope;
  detail?: Record<string, unknown>;
};

// =============================================================================
// MCP errors
// =============================================================================

export class MCPOperationError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "MCPOperationError";
  }
}

export class ExtractionError extends Error {
  constructor(
    public readonly sceneId: string,
    public readonly rawResponse: string,
    message: string
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

// =============================================================================
// API request / response shapes
// =============================================================================

// --- Universes ---

export type CreateUniverseRequest = {
  name: string;
  description: string;
};

export type CreateUniverseResponse = {
  universe_id: string;
  name: string;
  created_at: Date;
};

// --- Projects ---

export type CreateProjectRequest = {
  name: string;
  type: ProjectType;
  canonTier: 1 | 2 | 3;
};

export type CreateProjectResponse = {
  projectId: string;
  universeId: string;
  name: string;
  type: ProjectType;
  canonTier: 1 | 2 | 3;
  createdAt: Date;
};

// --- Story Units ---

export type CreateStoryUnitRequest = {
  title: string;
  unitType: StoryUnitType;
  seasonNumber?: number;
  episodeNumber?: number;
  inUniversePeriod: string;
  inUniverseDateStart?: number;
  inUniverseDateEnd?: number;
  releaseOrder: number;
};

export type CreateStoryUnitResponse = StoryUnit;

export type StoryUnitStatusResponse = {
  storyUnitId: string;
  ingestionStatus: IngestionStatus;
  sceneCount: number;
  claimCount: number;
  failedScenes: number[];
};

// --- Ingestion ---

export type IngestResponse = {
  storyUnitId: string;
  status: "ingesting";
};

// SSE event payloads — emitted on GET /api/units/:id/ingest-stream
export type SSESceneComplete = {
  event: "scene_complete";
  data: { sceneNumber: number; claimsWritten: number; status: "complete" };
};

export type SSESceneFailed = {
  event: "scene_failed";
  data: { sceneNumber: number; reason: string };
};

export type SSEIngestionComplete = {
  event: "ingestion_complete";
  data: {
    sceneCount: number;
    claimCount: number;
    failedScenes: number[];
  };
};

export type SSEEvent = SSESceneComplete | SSESceneFailed | SSEIngestionComplete;

// --- Analysis (Guardian) ---

export type AnalyzeResponse = {
  findingsCount: number;
  findings: ContinuityFinding[];
};

// --- Audience Companion ---

export type SpoilerBoundaryEntry = {
  storyUnitId: string;
  upToScene: number;
};

export type AskRequest = {
  question: string;
  boundary: SpoilerBoundaryEntry[];
};

export type AskResponse = {
  answer: string;
  claimsUsed: Array<{
    entityName: string;
    property: string;
    value: string;
    sourceUnitTitle: string;
    sceneNumber: number;
  }>;
  boundaryEnforced: true;
  boundarySummary: string;
};

// --- World State ---

export type WorldStateEntry = {
  entityId: string;
  entityName: string;
  property: string;
  value: string;
  sourceUnitTitle: string;
  inUniversePeriod: string;
  canonTier: 1 | 2 | 3;
};

export type WorldStateResponse = {
  universeId: string;
  asOf?: string;
  entries: WorldStateEntry[];
};

// --- Findings ---

export type FindingsResponse = {
  findings: ContinuityFinding[];
};

// --- Errors ---

export type ApiErrorResponse = {
  error: string;
  code: string;
};
