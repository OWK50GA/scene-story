/**
 * dossier.ts
 *
 * Assembles the EntityDossier — the bounded evidence package the Guardian
 * reasons over for each candidate transition.
 *
 * This module is entirely deterministic: no Gemini calls, no writes,
 * no side effects. It fetches structured data from ClickHouse and
 * organises it. It can be tested independently of the reasoner.
 *
 * The dossier answers: "Given a pair of conflicting claims about the same
 * entity+property, what is the full evidence context around that conflict?"
 */

import {
  getClaim,
  getEntity,
  getStoryUnit,
  getEntityHistory,
  getEventsBetweenScenes,
  type WithinUnitConflictRow,
  type CrossUnitConflictRow,
} from "../../mcp/clickhouse/operations.js";
import type {
  Claim,
  Event,
  UniverseEntity,
  StoryUnit,
  TemporalRelationType,
} from "../../types/index.js";

// ---------------------------------------------------------------------------
// ResolvedEvent
//
// Like Event, but with canonical names substituted for entity IDs.
// The prompt renderer works entirely with names — IDs are useless to Gemini.
// ---------------------------------------------------------------------------

export type ResolvedEvent = Omit<Event, "subjectEntityId" | "objectEntityId"> & {
  subjectName: string;
  objectName: string | null;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The complete evidence package passed to the Guardian reasoner.
 *
 * Within-unit dossiers leave temporalRelation undefined.
 * Cross-unit dossiers populate it after temporal resolution (Task 11).
 */
export type EntityDossier = {
  /** The entity being investigated. */
  focusEntity: UniverseEntity;

  /** The property whose state transition is suspicious. */
  candidateProperty: string;

  /**
   * The two claims that triggered this investigation.
   * claimA.validFromScene < claimB.validFromScene (earlier scene first).
   */
  candidateTransition: {
    claimA: Claim;
    claimB: Claim;
  };

  /**
   * Every claim for (focusEntity, candidateProperty) within this story unit,
   * ordered by validFromScene ascending.
   *
   * This gives the Guardian the full trajectory for the property —
   * not just the two candidate claims but every state the property has
   * been observed in, including claims outside the candidate window.
   * Seeing the full arc lets it reason about whether the transition is
   * part of a coherent sequence rather than an isolated jump.
   */
  propertyHistory: Claim[];

  /**
   * All claims for focusEntity between the two candidate scenes (inclusive),
   * across every property — not just the candidate property.
   *
   * This enables cross-property reasoning. For example: if the Cipher Device's
   * location changes, a simultaneous change in its lock_state or key_count in
   * the same scene window may explain the transition without an explicit event.
   *
   * Inclusion policy: coarse — all properties, all claims in the window.
   * See GAP-005 in ARCHITECTURAL_GAPS.md for the deferred relevance-scoring
   * improvement.
   */
  entityClaimsInWindow: Claim[];

  /**
   * Events where focusEntity is the subject or object, between the two
   * candidate scenes (inclusive), with entity IDs resolved to canonical names.
   *
   * These are the causal/explanatory layer. A transfer event here is what
   * turns a suspicious location change into a normal_transition.
   */
  relevantEvents: ResolvedEvent[];

  /** Metadata about the story unit — title, period, canon tier. */
  storyUnit: StoryUnit;

  /**
   * Temporal relation between the two story units involved.
   * Always undefined for within-unit dossiers.
   * Populated by cross-unit.ts before passing the dossier to the reasoner (Task 11).
   */
  temporalRelation?: TemporalRelationType;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * buildEntityDossier
 *
 * Constructs a complete evidence dossier for a single within-unit candidate
 * transition. All ClickHouse reads are performed here; the caller (within-unit.ts)
 * receives a ready-to-reason-over package.
 *
 * Throws MCPOperationError if any required record is not found in ClickHouse.
 * The caller is responsible for catching and logging these errors per-candidate.
 */
export async function buildEntityDossier(
  candidate: WithinUnitConflictRow,
  storyUnitId: string,
): Promise<EntityDossier> {
  // ------------------------------------------------------------------
  // Step 1 — Hydrate both candidate claims and fetch entity + story
  //          unit metadata in parallel. These four calls are independent.
  // ------------------------------------------------------------------
  const [claimA, claimB, focusEntity, storyUnit] = await Promise.all([
    getClaim(candidate.claimAId),
    getClaim(candidate.claimBId),
    getEntity(candidate.universeEntityId),
    getStoryUnit(storyUnitId),
  ]);

  // Ensure claimA is always the earlier scene. The SQL guarantees
  // claim_a_id < claim_b_id by string comparison, not by scene number.
  // Re-sort here so the dossier contract (earlier first) is reliable.
  const [earlier, later] =
    claimA.validFromScene <= claimB.validFromScene
      ? [claimA, claimB]
      : [claimB, claimA];

  const sceneA = earlier.validFromScene;
  const sceneB = later.validFromScene;

  // ------------------------------------------------------------------
  // Step 2 — Fetch the full entity history for focusEntity.
  //          One network call; we filter it in memory for both
  //          propertyHistory and entityClaimsInWindow.
  // ------------------------------------------------------------------
  const allEntityClaims = await getEntityHistory(candidate.universeEntityId);

  // Filter to this story unit only (getEntityHistory spans all units).
  const claimsForUnit = allEntityClaims.filter(
    (c) => c.storyUnitId === storyUnitId,
  );

  // Full chronological trajectory for the candidate property.
  const propertyHistory = claimsForUnit
    .filter((c) => c.property === candidate.property)
    .sort((a, b) => a.validFromScene - b.validFromScene);

  // All claims for the entity within the candidate scene window, all properties.
  const entityClaimsInWindow = claimsForUnit
    .filter((c) => c.validFromScene >= sceneA && c.validFromScene <= sceneB)
    .sort((a, b) => a.validFromScene - b.validFromScene);

  // ------------------------------------------------------------------
  // Step 3 — Fetch events involving the focus entity between the two
  //          candidate scenes, then resolve all entity IDs to canonical
  //          names so the prompt renderer never sees a UUID.
  //
  //          Strategy: collect the unique set of entity IDs referenced
  //          across all filtered events, fetch them in parallel, build
  //          a lookup map, then map each Event to a ResolvedEvent.
  //
  //          getEntity() is used per-ID. There is no bulk-by-IDs
  //          operation in operations.ts. For a typical scene window
  //          this is 2–6 unique entities — acceptable.
  // ------------------------------------------------------------------
  const allEventsInWindow = await getEventsBetweenScenes(
    storyUnitId,
    sceneA,
    sceneB,
  );

  const filteredEvents = allEventsInWindow.filter(
    (e) =>
      e.subjectEntityId === candidate.universeEntityId ||
      e.objectEntityId === candidate.universeEntityId,
  );

  // Collect unique entity IDs that need name resolution.
  const entityIdsToResolve = new Set<string>();
  for (const e of filteredEvents) {
    entityIdsToResolve.add(e.subjectEntityId);
    if (e.objectEntityId !== null) entityIdsToResolve.add(e.objectEntityId);
  }

  // Fetch all unique entities in parallel.
  const entityEntries = await Promise.all(
    [...entityIdsToResolve].map(async (id) => {
      try {
        const entity = await getEntity(id);
        return [id, entity.canonicalName] as const;
      } catch {
        // If an entity record is missing (data integrity issue), fall back
        // to a truncated ID so the event is still readable rather than crashing.
        return [id, `unknown(${id.slice(0, 8)})`] as const;
      }
    }),
  );

  const nameById = new Map<string, string>(entityEntries);

  const relevantEvents: ResolvedEvent[] = filteredEvents.map((e) => ({
    eventId: e.eventId,
    storyUnitId: e.storyUnitId,
    projectId: e.projectId,
    universeId: e.universeId,
    sceneNumber: e.sceneNumber,
    action: e.action,
    objectEntityId: e.objectEntityId,
    description: e.description,
    inUniversePeriod: e.inUniversePeriod,
    subjectName: nameById.get(e.subjectEntityId) ?? `unknown(${e.subjectEntityId.slice(0, 8)})`,
    objectName: e.objectEntityId !== null
      ? (nameById.get(e.objectEntityId) ?? `unknown(${e.objectEntityId.slice(0, 8)})`)
      : null,
  }));

  // ------------------------------------------------------------------
  // Assemble
  // ------------------------------------------------------------------
  return {
    focusEntity,
    candidateProperty: candidate.property,
    candidateTransition: {
      claimA: earlier,
      claimB: later,
    },
    propertyHistory,
    entityClaimsInWindow,
    relevantEvents,
    storyUnit,
    // temporalRelation left undefined — within-unit dossiers do not need it.
    // cross-unit.ts (Task 11) will set this field before passing the dossier
    // to the reasoner.
  };
}

// ---------------------------------------------------------------------------
// Cross-unit dossier assembly
// ---------------------------------------------------------------------------

/**
 * buildCrossUnitDossier
 *
 * Variant of buildEntityDossier for cross-unit candidates.
 *
 * Differences from within-unit:
 *
 *  - Property history spans both story units (all claims for the entity
 *    across the entire universe, ordered chronologically).
 *
 *  - entityClaimsInWindow covers both units: all properties for the entity
 *    from sceneA to the end of unitA, plus from the start of unitB to sceneB.
 *    There is no single "window" — we take the relevant tail of unitA and
 *    the relevant head of unitB.
 *
 *  - Events come from both units with the same logic: end of unitA and
 *    start of unitB, filtered to events involving the focus entity.
 *
 *  - storyUnit is set to the story unit that contains claimA (the earlier
 *    claim by in-universe time). The prompt renders both unit titles
 *    from the dossier's candidateTransition claim metadata.
 *
 *  - temporalRelation is injected by the caller (cross-unit.ts) after
 *    resolveTemporalOrder returns. It is NOT set here.
 *
 * Throws MCPOperationError if any required record is not found.
 */
export async function buildCrossUnitDossier(
  candidate: CrossUnitConflictRow,
): Promise<EntityDossier> {
  // ------------------------------------------------------------------
  // Step 1 — Hydrate both claims, entity, and both story units.
  // ------------------------------------------------------------------
  const [claimA, claimB, focusEntity, unitA, unitB] = await Promise.all([
    getClaim(candidate.claimAId),
    getClaim(candidate.claimBId),
    getEntity(candidate.universeEntityId),
    getStoryUnit(candidate.unitAId),
    getStoryUnit(candidate.unitBId),
  ]);

  // Order by in-universe time: the claim from the earlier unit is "earlier".
  // candidate.dateA/dateB from the SQL tell us which unit comes first.
  // If dates are equal or both null, fall back to the SQL's own ordering
  // (claim_a_id < claim_b_id — arbitrary but consistent).
  const aIsEarlier =
    candidate.dateA !== null && candidate.dateB !== null
      ? candidate.dateA <= candidate.dateB
      : true; // SQL already picked an ordering; respect it

  const [earlier, later, earlierUnit, laterUnit] = aIsEarlier
    ? [claimA, claimB, unitA, unitB]
    : [claimB, claimA, unitB, unitA];

  // ------------------------------------------------------------------
  // Step 2 — Full property history across both units.
  //          getEntityHistory returns all claims across all units,
  //          ordered by in-universe date + release_order + scene.
  // ------------------------------------------------------------------
  const allEntityClaims = await getEntityHistory(candidate.universeEntityId);

  const propertyHistory = allEntityClaims
    .filter((c) => c.property === candidate.property)
    .sort((a, b) => {
      // Sort by in-universe date start (nulls last), then by validFromScene.
      if (a.inUniverseDateStart !== b.inUniverseDateStart) {
        if (a.inUniverseDateStart === null) return 1;
        if (b.inUniverseDateStart === null) return -1;
        return a.inUniverseDateStart - b.inUniverseDateStart;
      }
      return a.validFromScene - b.validFromScene;
    });

  // All-property claims in window: tail of earlierUnit (from sceneA onward)
  // + head of laterUnit (up to sceneB).
  const earlierUnitClaims = allEntityClaims.filter(
    (c) =>
      c.storyUnitId === earlierUnit.storyUnitId &&
      c.validFromScene >= earlier.validFromScene,
  );

  const laterUnitClaims = allEntityClaims.filter(
    (c) =>
      c.storyUnitId === laterUnit.storyUnitId &&
      c.validFromScene <= later.validFromScene,
  );

  const entityClaimsInWindow = [
    ...earlierUnitClaims,
    ...laterUnitClaims,
  ].sort((a, b) => {
    // Group by unit first (earlier unit before later), then by scene.
    if (a.storyUnitId !== b.storyUnitId) {
      return a.storyUnitId === earlierUnit.storyUnitId ? -1 : 1;
    }
    return a.validFromScene - b.validFromScene;
  });

  // ------------------------------------------------------------------
  // Step 3 — Events from both units, resolved to canonical names.
  //          earlierUnit: from sceneA to end (use a large sentinel for "end")
  //          laterUnit: from start (scene 0) to sceneB
  // ------------------------------------------------------------------
  const SCENE_END_SENTINEL = 99999;

  const [earlierUnitEvents, laterUnitEvents] = await Promise.all([
    getEventsBetweenScenes(
      earlierUnit.storyUnitId,
      earlier.validFromScene,
      SCENE_END_SENTINEL,
    ),
    getEventsBetweenScenes(
      laterUnit.storyUnitId,
      0,
      later.validFromScene,
    ),
  ]);

  const focusId = candidate.universeEntityId;

  const filteredEvents = [
    ...earlierUnitEvents.filter(
      (e) => e.subjectEntityId === focusId || e.objectEntityId === focusId,
    ),
    ...laterUnitEvents.filter(
      (e) => e.subjectEntityId === focusId || e.objectEntityId === focusId,
    ),
  ];

  // Resolve entity IDs → canonical names.
  const entityIdsToResolve = new Set<string>();
  for (const e of filteredEvents) {
    entityIdsToResolve.add(e.subjectEntityId);
    if (e.objectEntityId !== null) entityIdsToResolve.add(e.objectEntityId);
  }

  const entityEntries = await Promise.all(
    [...entityIdsToResolve].map(async (id) => {
      try {
        const entity = await getEntity(id);
        return [id, entity.canonicalName] as const;
      } catch {
        return [id, `unknown(${id.slice(0, 8)})`] as const;
      }
    }),
  );

  const nameById = new Map<string, string>(entityEntries);

  const relevantEvents: ResolvedEvent[] = filteredEvents.map((e) => ({
    eventId: e.eventId,
    storyUnitId: e.storyUnitId,
    projectId: e.projectId,
    universeId: e.universeId,
    sceneNumber: e.sceneNumber,
    action: e.action,
    objectEntityId: e.objectEntityId,
    description: e.description,
    inUniversePeriod: e.inUniversePeriod,
    subjectName:
      nameById.get(e.subjectEntityId) ??
      `unknown(${e.subjectEntityId.slice(0, 8)})`,
    objectName:
      e.objectEntityId !== null
        ? (nameById.get(e.objectEntityId) ??
          `unknown(${e.objectEntityId.slice(0, 8)})`)
        : null,
  }));

  // ------------------------------------------------------------------
  // Assemble — storyUnit set to the earlier unit.
  // temporalRelation is left undefined; cross-unit.ts sets it.
  // ------------------------------------------------------------------
  return {
    focusEntity,
    candidateProperty: candidate.property,
    candidateTransition: {
      claimA: earlier,
      claimB: later,
    },
    propertyHistory,
    entityClaimsInWindow,
    relevantEvents,
    storyUnit: earlierUnit,
    // temporalRelation injected by cross-unit.ts after resolveTemporalOrder
  };
}
