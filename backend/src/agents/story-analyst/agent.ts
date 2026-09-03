import {
  ExtractionError,
  type Scene,
  type StoryUnit,
  type Project,
  type UniverseEntity,
  type SourceType,
} from "../../types/index.js";
import {
  findEntityByName,
  getEntitiesForUniverse,
  createEntity,
  getCurrentState,
  writeClaim,
  writeEvent,
  updateSceneStatus,
} from "../../mcp/clickhouse/operations.js";
import { extractScene } from "./extractor.js";
import { log } from "../../observability/logger.js";
import {
  recordSceneIngestionDuration,
  recordClaimWritten,
  recordConfidence,
  recordExtractionFailure,
  flushMetrics,
} from "../../observability/metrics.js";

// =============================================================================
// Story Analyst — Scene Processor
//
// processScene is the single public export. It owns the complete lifecycle of
// processing one scene from a story unit:
//
//   Step 1 — Scan scene text for known entity names → build entity ID list
//   Step 2 — Fetch current known state for those entities → context summary
//   Step 3 — Call extractScene (Gemini extraction + Zod validation)
//   Step 4 — Resolve every entity name in the extraction to a universe_entity_id
//   Step 5 — Write all claims to ClickHouse
//   Step 6 — Write all events to ClickHouse
//   Step 7 — Mark scene complete, emit observability
//
// The Director (Task 9) calls processScene per scene inside the pipeline loop.
// processScene never throws — it returns a result object with status "failed"
// when extraction or a fatal write error occurs, so the pipeline can continue.
// =============================================================================

// -----------------------------------------------------------------------------
// Return type
// -----------------------------------------------------------------------------

export type ProcessSceneResult = {
  status: "complete" | "failed";
  claimsWritten: number;
  entitiesResolved: number;
  eventsWritten: number;
  durationMs: number;
  error?: string;
};

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * processScene
 *
 * Processes a single scene: extract facts, resolve entities, write to ClickHouse.
 * Never throws. Returns a result object the Director uses for progress tracking.
 *
 * @param scene       The scene to process. Must already exist in ClickHouse
 *                    (inserted by the Director before calling this).
 * @param unit        The story unit the scene belongs to.
 * @param project     The project — used for canonTier on every claim.
 * @param sceneTotal  Total scene count in this unit, for prompt context.
 */
export async function processScene(
  scene: Scene,
  unit: StoryUnit,
  project: Project,
  sceneTotal: number
): Promise<ProcessSceneResult> {
  const start = Date.now();

  // ── Step 1: Scan scene text for known entity names ────────────────────────
  // Fetch the full universe entity list once, then test each canonical name
  // against the scene text. This is a fast string scan — no LLM involved.
  // The result is the list of entity IDs whose current state should be injected
  // into the prompt as context for this scene.

  let allUniverseEntities: UniverseEntity[] = [];
  try {
    allUniverseEntities = await getEntitiesForUniverse(unit.universeId);
  } catch {
    // Non-fatal — proceed with empty context if the entity registry is unreachable.
    // The extractor will still run; it will treat all entities as new.
  }

  const mentionedEntityIds = scanForMentionedEntities(
    scene.rawText,
    allUniverseEntities
  );

  // ── Step 2: Fetch current known state → context summary ───────────────────
  // get_current_state returns active claims for the mentioned entities as of
  // the scene before this one (sceneNumber - 1). Includes inherited parent claims.

  let contextSummary = "";
  if (mentionedEntityIds.length > 0) {
    try {
      const stateRows = await getCurrentState(
        unit.storyUnitId,
        mentionedEntityIds,
        scene.sceneNumber - 1
      );
      contextSummary = formatContextSummary(stateRows, allUniverseEntities);
    } catch {
      // Non-fatal — run without context rather than failing the scene.
    }
  }

  // ── Step 3: Extract ───────────────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractScene(scene, unit, contextSummary, sceneTotal);
  } catch (err) {
    const message =
      err instanceof ExtractionError
        ? err.message
        : err instanceof Error
        ? err.message
        : String(err);

    await updateSceneStatus(unit.storyUnitId, scene.sceneNumber, "failed")
      .catch(() => {}); // best-effort

    recordExtractionFailure(unit.storyUnitId);
    await flushMetrics().catch(() => {});

    log({
      agent: "story-analyst",
      universeId: unit.universeId,
      storyUnitId: unit.storyUnitId,
      sceneNumber: scene.sceneNumber,
      eventType: "scene_extraction_failed",
      durationMs: Date.now() - start,
      status: "failure",
      detail: { error: message },
    });

    return {
      status: "failed",
      claimsWritten: 0,
      entitiesResolved: 0,
      eventsWritten: 0,
      durationMs: Date.now() - start,
      error: message,
    };
  }

  // ── Step 4: Entity resolution ─────────────────────────────────────────────
  // For every entity name the extractor returned, find or create a
  // universe_entity_id. We build a map: canonicalName → entityId.
  //
  // Resolution order (per spec):
  //   1. Exact match       — findEntityByName handles this
  //   2. Case-insensitive  — findEntityByName handles this
  //   3. Levenshtein ≤ 2   — computed locally against allUniverseEntities
  //   4. Create new        — createEntity with firstAppearanceUnitId = storyUnitId

  // Refresh the entity list to include anything created mid-scene by parallel
  // callers — though scenes are sequential, be defensive here.
  try {
    allUniverseEntities = await getEntitiesForUniverse(unit.universeId);
  } catch {
    // Use the list we already have.
  }

  const nameToEntityId = new Map<string, string>();

  for (const extractedEntity of extraction.entities) {
    const { canonicalName, entityType, description, parentEntityName } =
      extractedEntity;

    // Skip if we already resolved this name earlier in the loop (dedup).
    if (nameToEntityId.has(canonicalName)) continue;

    let resolved = await resolveEntityName(
      canonicalName,
      unit.universeId,
      allUniverseEntities
    );

    if (!resolved) {
      // Resolve parent first if provided, so we can set parentEntityId.
      let parentEntityId: string | null = null;
      if (parentEntityName) {
        const parentResolved = await resolveEntityName(
          parentEntityName,
          unit.universeId,
          allUniverseEntities
        );
        if (parentResolved) {
          parentEntityId = parentResolved.entityId;
        }
      }

      try {
        resolved = await createEntity({
          universeId: unit.universeId,
          canonicalName,
          entityType,
          description,
          parentEntityId,
          firstAppearanceUnitId: unit.storyUnitId,
        });
        // Keep the local list current so subsequent resolution attempts in this
        // scene can find entities created earlier in this loop.
        allUniverseEntities.push(resolved);
      } catch {
        // If creation fails, skip this entity — its claims will be skipped too.
        continue;
      }
    }

    nameToEntityId.set(canonicalName, resolved.entityId);

    // Also map any aliases or surface forms that might appear in claims
    // (e.g. "Clara" → same ID as "Clara Voss"). We do this lazily in Step 5
    // by also trying to resolve the claim's entityName if it isn't in the map.
  }

  // ── Step 5: Write claims ──────────────────────────────────────────────────
  let claimsWritten = 0;
  const rawExtractionJson = JSON.stringify(extraction);

  for (const claim of extraction.claims) {
    // Resolve entity name — may differ slightly from the canonicalName in
    // entities[] (e.g. extraction returns "Clara" in claims but "Clara Voss"
    // in entities). Try the map first, then resolve on the fly.
    let entityId = nameToEntityId.get(claim.entityName);

    if (!entityId) {
      const resolved = await resolveEntityName(
        claim.entityName,
        unit.universeId,
        allUniverseEntities
      );
      if (resolved) {
        entityId = resolved.entityId;
        nameToEntityId.set(claim.entityName, entityId);
      }
    }

    if (!entityId) {
      // Can't write a claim with no entity — skip silently.
      // The entity may have failed creation above.
      continue;
    }

    try {
      await writeClaim({
        universeEntityId: entityId,
        universeId: unit.universeId,
        projectId: unit.projectId,
        storyUnitId: unit.storyUnitId,
        sourceSceneNumber: scene.sceneNumber,
        property: claim.property,
        value: claim.value,
        inUniversePeriod: unit.inUniversePeriod,
        inUniverseDateStart: unit.inUniverseDateStart ?? undefined,
        inUniverseDateEnd: unit.inUniverseDateEnd ?? undefined,
        validFromScene: scene.sceneNumber,
        sourceType: claim.sourceType,
        confidence: claim.confidence,
        confidenceRationale: claim.confidenceRationale,
        rawExtraction: rawExtractionJson,
        sourceLine: claim.sourceLine,
        canonTier: project.canonTier,
      });

      claimsWritten++;
      recordClaimWritten(unit.storyUnitId, claim.sourceType as SourceType);
      recordConfidence(claim.sourceType as SourceType, claim.confidence);
    } catch {
      // A single bad claim (confidence out of range, network blip) does not
      // fail the scene. Log and continue.
    }
  }

  // ── Step 6: Write events ──────────────────────────────────────────────────
  let eventsWritten = 0;

  for (const event of extraction.events) {
    // Subject is required — skip if we can't resolve it.
    let subjectId = nameToEntityId.get(event.subject);
    if (!subjectId) {
      const resolved = await resolveEntityName(
        event.subject,
        unit.universeId,
        allUniverseEntities
      );
      if (resolved) {
        subjectId = resolved.entityId;
        nameToEntityId.set(event.subject, subjectId);
      }
    }
    if (!subjectId) continue;

    // Object is optional.
    let objectId: string | null = null;
    if (event.object) {
      objectId = nameToEntityId.get(event.object) ?? null;
      if (!objectId) {
        const resolved = await resolveEntityName(
          event.object,
          unit.universeId,
          allUniverseEntities
        );
        if (resolved) {
          objectId = resolved.entityId;
          nameToEntityId.set(event.object, objectId);
        }
      }
    }

    try {
      await writeEvent({
        storyUnitId: unit.storyUnitId,
        projectId: unit.projectId,
        universeId: unit.universeId,
        sceneNumber: scene.sceneNumber,
        subjectEntityId: subjectId,
        action: event.action,
        objectEntityId: objectId,
        description: event.description,
        inUniversePeriod: unit.inUniversePeriod,
      });
      eventsWritten++;
    } catch {
      // Non-fatal — skip this event.
    }
  }

  // ── Step 7: Mark complete, emit observability ─────────────────────────────
  const durationMs = Date.now() - start;

  await updateSceneStatus(unit.storyUnitId, scene.sceneNumber, "complete")
    .catch(() => {});

  recordSceneIngestionDuration(unit.storyUnitId, durationMs);
  await flushMetrics().catch(() => {});

  log({
    agent: "story-analyst",
    universeId: unit.universeId,
    storyUnitId: unit.storyUnitId,
    sceneNumber: scene.sceneNumber,
    eventType: "scene_processed",
    durationMs,
    status: "success",
    detail: {
      claimsWritten,
      entitiesResolved: nameToEntityId.size,
      eventsWritten,
    },
  });

  return {
    status: "complete",
    claimsWritten,
    entitiesResolved: nameToEntityId.size,
    eventsWritten,
    durationMs,
  };
}

// =============================================================================
// Private helpers
// =============================================================================

// -----------------------------------------------------------------------------
// scanForMentionedEntities
//
// Fast string scan: returns the IDs of all universe entities whose canonical
// name appears (case-insensitive) in the scene raw text. Used to build the
// entity ID list for getCurrentState before extraction runs.
// -----------------------------------------------------------------------------

function scanForMentionedEntities(
  rawText: string,
  entities: UniverseEntity[]
): string[] {
  const lowerText = rawText.toLowerCase();
  const found: string[] = [];

  for (const entity of entities) {
    if (lowerText.includes(entity.canonicalName.toLowerCase())) {
      found.push(entity.entityId);
    }
  }

  return found;
}

// -----------------------------------------------------------------------------
// resolveEntityName
//
// Resolution order:
//   1. Exact match via findEntityByName (which also does case-insensitive)
//   2. Levenshtein ≤ 2 against the local entity list
//   3. null — caller creates a new entity
// -----------------------------------------------------------------------------

async function resolveEntityName(
  name: string,
  universeId: string,
  localEntities: UniverseEntity[]
): Promise<UniverseEntity | null> {
  // Steps 1 + 2 (exact + case-insensitive) via DB lookup.
  try {
    const dbResult = await findEntityByName(universeId, name);
    if (dbResult) return dbResult;
  } catch {
    // Fall through to local fuzzy match.
  }

  // Step 3: Levenshtein ≤ 2 against the local cache.
  const lowerName = name.toLowerCase();
  for (const entity of localEntities) {
    if (levenshtein(lowerName, entity.canonicalName.toLowerCase()) <= 2) {
      return entity;
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// levenshtein
//
// Standard DP implementation. Operates on the full strings — callers should
// lowercase both inputs before calling if case-insensitive comparison is needed.
// Returns early when the distance already exceeds 2 to avoid unnecessary work.
//
// Exported for unit testing.
// -----------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  // Quick exits.
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // If length difference alone exceeds threshold, skip full DP.
  if (Math.abs(a.length - b.length) > 2) return 3;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,       // insertion
        prev[j]! + 1,            // deletion
        prev[j - 1]! + cost      // substitution
      );
      rowMin = Math.min(rowMin, curr[j]!);
    }

    // If the minimum value in this row already exceeds 2, bail early.
    if (rowMin > 2) return 3;

    prev.splice(0, prev.length, ...curr);
  }

  return curr[b.length]!;
}

// -----------------------------------------------------------------------------
// formatContextSummary
//
// Converts the result of getCurrentState into the human-readable string that
// gets injected into Part 3 of the extraction prompt. Groups claims by entity
// name. Inherited parent claims are visually distinguished with [inherited].
//
// Output example:
//   - Cipher Device: location = "locked in Meinhardt's safe" (scene 4, conf 1.00)
//   - Clara Voss: possession = "Signal Watch" (scene 3, conf 1.00)
//     [inherited from Satchel]: contents = "encoded documents" (scene 1, conf 0.90)
//
// Exported for unit testing.
// -----------------------------------------------------------------------------

export function formatContextSummary(
  stateRows: Array<{
    entityName?: string;
    universeEntityId: string;
    parentEntityId: string | null;
    property: string;
    value: string;
    sourceSceneNumber: number;
    confidence: number;
  }>,
  allEntities: UniverseEntity[]
): string {
  if (stateRows.length === 0) return "";

  // Build a map entityId → canonicalName for display.
  const idToName = new Map<string, string>(
    allEntities.map((e) => [e.entityId, e.canonicalName])
  );

  // Group by entity, separating direct claims from inherited ones.
  type EntityGroup = {
    directClaims: typeof stateRows;
    inheritedClaims: typeof stateRows;
  };
  const groups = new Map<string, EntityGroup>();

  for (const row of stateRows) {
    const eid = row.universeEntityId;
    if (!groups.has(eid)) {
      groups.set(eid, { directClaims: [], inheritedClaims: [] });
    }
    const g = groups.get(eid)!;

    // A row is "inherited" when the entity it belongs to is a parent of
    // one of the originally requested entities (i.e. parentEntityId points
    // to it). Since getCurrentState returns both direct and parent claims
    // in the same flat list, we distinguish them by whether the entity's
    // own parentEntityId was what put it in scope.
    // Simpler heuristic: if the entity isn't in idToName at the original
    // entity scope, treat as inherited. We just check parentEntityId field.
    if (row.parentEntityId !== null) {
      g.inheritedClaims.push(row);
    } else {
      g.directClaims.push(row);
    }
  }

  const lines: string[] = [];

  for (const [entityId, group] of groups) {
    const entityName =
      (stateRows.find((r) => r.universeEntityId === entityId)?.entityName) ??
      idToName.get(entityId) ??
      entityId;

    for (const c of group.directClaims) {
      lines.push(
        `- ${entityName}: ${c.property} = "${c.value}" ` +
          `(established scene ${c.sourceSceneNumber}, confidence ${c.confidence.toFixed(2)})`
      );
    }

    for (const c of group.inheritedClaims) {
      const parentName = (c.parentEntityId ? idToName.get(c.parentEntityId) : undefined) ?? idToName.get(c.universeEntityId) ?? c.universeEntityId;
      lines.push(
        `  [inherited from ${parentName}]: ${c.property} = "${c.value}" ` +
          `(established scene ${c.sourceSceneNumber}, confidence ${c.confidence.toFixed(2)})`
      );
    }
  }

  return lines.join("\n");
}
