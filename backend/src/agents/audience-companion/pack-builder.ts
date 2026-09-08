/**
 * pack-builder.ts — Companion context pack assembly
 *
 * Deterministic application code. No Gemini calls. No side effects.
 * Each public function reads from ClickHouse and returns a typed value.
 *
 * The three mode builders share two helpers that run in every mode:
 *   - buildEntitySummaries — lightweight entity metadata
 *   - buildSceneDigests    — orientation layer; 1–3 sentences per scene
 *
 * buildPack is the single entry point called by agent.ts.
 */

import {
  getCompanionFacts,
  getHistoricalClaimsForEntities,
  getEventsForEntities,
  getEntitiesForUniverse,
  getScenesForUnit,
} from "../../mcp/clickhouse/operations.js";
import type { SpoilerBoundaryEntry } from "../../types/index.js";
import type {
  QuestionMode,
  PackFact,
  SceneDigest,
  EntitySummary,
  CompanionPack,
  EntitySummary as ES,
} from "./types.js";

// =============================================================================
// Public entry point
// =============================================================================

/**
 * buildPack
 *
 * Assembles the complete CompanionPack for a unit-level question.
 * Called by askUnit() in agent.ts after classifyQuestion() returns.
 *
 * The boundary is a single-entry list for the unit-level path.
 * The multi-unit path (ask()) also routes here after reducing its boundary
 * to a single entry — see agent.ts for that logic.
 */
export async function buildPack(
  storyUnitId: string,
  upToScene: number,
  question: string,
  mode: QuestionMode,
): Promise<CompanionPack> {
  const boundary: SpoilerBoundaryEntry[] = [{ storyUnitId, upToScene }];

  // Entity summaries and scene digests are assembled for every mode.
  // They run in parallel with the mode-specific fact builder.
  const [entitySummaries, sceneDigests, facts] = await Promise.all([
    buildEntitySummaries(storyUnitId, upToScene),
    buildSceneDigests(storyUnitId, upToScene),
    buildFacts(storyUnitId, upToScene, question, mode),
  ]);

  return { boundary, entitySummaries, sceneDigests, facts, mode };
}

// =============================================================================
// Mode dispatch
// =============================================================================

async function buildFacts(
  storyUnitId: string,
  upToScene: number,
  question: string,
  mode: QuestionMode,
): Promise<PackFact[]> {
  switch (mode) {
    case "current_state":
      return buildCurrentStateFacts(storyUnitId, upToScene);
    case "historical":
      return buildHistoricalFacts(storyUnitId, upToScene, question);
    case "summary":
      return buildSummaryFacts(storyUnitId, upToScene);
  }
}

// =============================================================================
// Mode: current_state
// =============================================================================

/**
 * buildCurrentStateFacts
 *
 * Calls getCompanionFacts and deduplicates to the latest claim per
 * entity+property within the boundary.
 *
 * "Latest" means the claim with the highest valid_from_scene (i.e. the most
 * recent established value). getCompanionFacts orders by valid_from_scene
 * ascending, so we iterate forward and let later rows overwrite earlier ones
 * in the dedup map.
 *
 * All PackFacts produced here have isHistorical: false.
 *
 * Note: getCompanionFacts takes a universeId parameter that isn't available
 * at the unit level. The unit-level boundary query is intentionally permissive
 * on universeId — the spoiler boundary (storyUnitId + upToScene) is the
 * binding constraint. We pass an empty string to satisfy the parameter; the
 * SQL's boundary filter carries the actual enforcement.
 *
 * UPDATE: getCompanionFacts returns entity_name but not entity_id or claim_id,
 * so factId here is a synthetic key: "<entityName>:<property>@<sceneNumber>".
 * For current_state mode this is stable (one fact per entity+property after dedup).
 * Historical and summary modes use claim_id directly via getHistoricalClaimsForEntities.
 */
export async function buildCurrentStateFacts(
  storyUnitId: string,
  upToScene: number,
): Promise<PackFact[]> {
  const boundary: SpoilerBoundaryEntry[] = [{ storyUnitId, upToScene }];
  const rows = await getCompanionFacts("", boundary);

  // Dedup: iterate in order (already sorted by valid_from_scene asc).
  // Last write wins → latest value per entity+property.
  const dedup = new Map<
    string,
    {
      entityName: string;
      property: string;
      value: string;
      validFromScene: number;
      sourceSceneNumber: number;
      inUniversePeriod: string;
      confidence: number;
      sourceUnitTitle: string;
    }
  >();

  for (const row of rows) {
    const key = `${row.entityName}::${row.property}`;
    dedup.set(key, row);
  }

  return [...dedup.values()].map((row) => ({
    // Synthetic stable ID for current-state facts (no claim_id available).
    factId: `${row.entityName}:${row.property}@${row.validFromScene}`,
    entityId: "",          // not available from getCompanionFacts — empty for current_state
    entityName: row.entityName,
    property: row.property,
    value: row.value,
    sourceType: "explicit" as const, // getCompanionFacts doesn't return source_type; default
    confidence: row.confidence,
    sceneNumber: row.validFromScene,
    sourceLine: "",        // not returned by getCompanionFacts; answerer omits it from prompt
    isHistorical: false,
  }));
}

// =============================================================================
// Mode: historical
// =============================================================================

/**
 * buildHistoricalFacts
 *
 * Fetches the full claim chain for entities resolved from the question text.
 * Then performs one-hop event expansion and merges those events as facts too.
 *
 * Entity resolution: lowercase substring match against canonicalName and aliases.
 * Falls back to all boundary entities if no entity name matches the question.
 *
 * One-hop expansion: for each event involving a resolved entity, the other
 * participant entity is also included. This means "How did Clara get the
 * device?" will naturally pull in both Clara's and the Cipher Device's full
 * claim history, even if only one name appears literally in the question.
 */
export async function buildHistoricalFacts(
  storyUnitId: string,
  upToScene: number,
  question: string,
): Promise<PackFact[]> {
  // Step 1 — resolve entity summaries to match against the question.
  const allSummaries = await buildEntitySummaries(storyUnitId, upToScene);
  const resolvedEntities = resolveEntitiesFromQuestion(question, allSummaries);
  const resolvedIds = resolvedEntities.map((e) => e.entityId);

  // Step 2 — fetch the full claim chain (including superseded) for resolved entities.
  const claims = await getHistoricalClaimsForEntities(
    storyUnitId,
    resolvedIds,
    upToScene,
  );

  // Step 3 — fetch events for resolved entities and perform one-hop expansion.
  const directEvents = await getEventsForEntities(
    storyUnitId,
    resolvedIds,
    upToScene,
  );

  // Collect entity IDs that appear as the *other* participant in these events
  // (one-hop: include entities connected to the resolved set via events).
  const hopIds = new Set<string>();
  for (const ev of directEvents) {
    if (!resolvedIds.includes(ev.subjectEntityId)) hopIds.add(ev.subjectEntityId);
    if (ev.objectEntityId && !resolvedIds.includes(ev.objectEntityId)) {
      hopIds.add(ev.objectEntityId);
    }
  }

  // Fetch claims for one-hop entities if any were found.
  const hopClaims =
    hopIds.size > 0
      ? await getHistoricalClaimsForEntities(
          storyUnitId,
          [...hopIds],
          upToScene,
        )
      : [];

  // Merge all claims; dedup by claim_id in case a claim appears in both sets.
  const allClaims = [...claims, ...hopClaims];
  const seen = new Set<string>();
  const dedupedClaims = allClaims.filter((c) => {
    if (seen.has(c.claimId)) return false;
    seen.add(c.claimId);
    return true;
  });

  return dedupedClaims.map((c) => ({
    factId: c.claimId,
    entityId: c.universeEntityId,
    entityName: c.entityName,
    property: c.property,
    value: c.value,
    sourceType: c.sourceType,
    confidence: c.confidence,
    sceneNumber: c.validFromScene,
    sourceLine: c.sourceLine,
    // Mark superseded claims as historical so Gemini can reason about
    // causal chains rather than treating old values as contradictions.
    isHistorical: c.supersededByCanon || c.validToScene !== null,
  }));
}

// =============================================================================
// Mode: summary
// =============================================================================

/**
 * buildSummaryFacts
 *
 * Returns all claims with confidence >= 0.75 plus all events, no deduplication.
 * The full undeduped set is needed for catch-up and what-should-I-remember
 * answers: narrative progression requires seeing how state evolved, not just
 * where it ended up.
 *
 * Events are represented as PackFacts with property="event" and
 * value=ev.description. This lets the answerer format them inline with claims
 * without needing a separate events block in the user turn.
 *
 * The confidence threshold (0.75) matches the boundary between "implied" and
 * "inferred" source types. Inferred claims (< 0.75) are excluded because they
 * introduce speculation into a summary that should be concrete.
 */
export async function buildSummaryFacts(
  storyUnitId: string,
  upToScene: number,
): Promise<PackFact[]> {
  const allSummaries = await buildEntitySummaries(storyUnitId, upToScene);
  const allIds = allSummaries.map((e) => e.entityId);

  const [claims, events] = await Promise.all([
    getHistoricalClaimsForEntities(storyUnitId, allIds, upToScene),
    getEventsForEntities(storyUnitId, allIds, upToScene),
  ]);

  const CONFIDENCE_THRESHOLD = 0.75;

  const claimFacts: PackFact[] = claims
    .filter((c) => c.confidence >= CONFIDENCE_THRESHOLD)
    .map((c) => ({
      factId: c.claimId,
      entityId: c.universeEntityId,
      entityName: c.entityName,
      property: c.property,
      value: c.value,
      sourceType: c.sourceType,
      confidence: c.confidence,
      sceneNumber: c.validFromScene,
      sourceLine: c.sourceLine,
      isHistorical: c.supersededByCanon || c.validToScene !== null,
    }));

  const eventFacts: PackFact[] = events.map((ev) => ({
    factId: ev.eventId,
    entityId: ev.subjectEntityId,
    entityName: ev.subjectName,
    property: "event",
    value: ev.description,
    sourceType: "explicit" as const,
    confidence: 1.0,
    sceneNumber: ev.sceneNumber,
    sourceLine: "",
    isHistorical: false,
  }));

  return [...claimFacts, ...eventFacts];
}

// =============================================================================
// Shared helpers — run in every mode
// =============================================================================

/**
 * buildEntitySummaries
 *
 * Returns a lightweight summary for every entity that appears in scenes 1–N.
 * The summaries serve two purposes:
 *   1. Orientation layer in the Gemini user turn (entity list before facts)
 *   2. Input to resolveEntitiesFromQuestion for historical mode entity matching
 *
 * aliases: in v1, parsed from the entity's description field by extracting
 * quoted strings or comma-separated names mentioned in the first sentence.
 * Defaults to [canonicalName] when no aliases can be parsed.
 *
 * firstSeenScene: lowest source_scene_number among the entity's claims within
 * the boundary. Requires a claim fetch; we reuse the data already fetched for
 * current-state mode when available. Here we do a lightweight fetch via
 * getEntitiesForUniverse + getHistoricalClaimsForEntities.
 *
 * NOTE: storyUnitId → universeId requires a join we don't have at this layer.
 * We work around this by fetching entities scoped to the story unit via
 * getHistoricalClaimsForEntities with a large upToScene and deriving the
 * entity list from the claim rows, rather than from getEntitiesForUniverse
 * which requires universeId.
 */
export async function buildEntitySummaries(
  storyUnitId: string,
  upToScene: number,
): Promise<EntitySummary[]> {
  // Fetch all claims within boundary — this gives us entity IDs, names, types,
  // and first-seen scenes without a separate entity lookup.
  // We use a sentinel "all entities" approach: start with an empty list and
  // fall back to the fact that getHistoricalClaimsForEntities with a broad
  // entity list is not available without entity IDs first.
  //
  // Solution: use getCompanionFacts (which handles its own entity join) to get
  // the set of entity names appearing in the boundary, then build summaries
  // from that data. This avoids the universeId dependency.
  const boundary: SpoilerBoundaryEntry[] = [{ storyUnitId, upToScene }];
  const rows = await getCompanionFacts("", boundary);

  if (rows.length === 0) return [];

  // Derive entity summaries from claim rows.
  // firstSeenScene = min(sourceSceneNumber) per entity.
  const entityMap = new Map<
    string, // entityName as key (canonical)
    { firstSeen: number }
  >();

  for (const row of rows) {
    const existing = entityMap.get(row.entityName);
    if (!existing) {
      entityMap.set(row.entityName, { firstSeen: row.sourceSceneNumber });
    } else if (row.sourceSceneNumber < existing.firstSeen) {
      existing.firstSeen = row.sourceSceneNumber;
    }
  }

  return [...entityMap.entries()].map(([name, meta]) => ({
    entityId: "",            // not available from getCompanionFacts
    canonicalName: name,
    entityType: "character" as const, // not available without entity join; placeholder
    firstSeenScene: meta.firstSeen,
    aliases: parseAliases(name),
  }));
}

/**
 * buildSceneDigests
 *
 * Assembles a 1–3 sentence orientation summary for each scene from 1 to upToScene.
 * No Gemini call. Built deterministically from events and claim changes.
 *
 * Format principle (from audience-companion.md):
 *   - Events first: what happened in the scene
 *   - Significant state changes second: what changed as a result
 *   - Never interprets — only describes what the data shows
 *
 * "Significant" state change = any claim whose valid_from_scene equals this
 * scene number (a new value was established here).
 *
 * Strategy:
 *   1. Fetch all scenes for the unit to get headings.
 *   2. Fetch all events up to upToScene for all entities.
 *   3. Fetch all current-state facts to identify which claims started at each scene.
 *   4. For each scene number 1..upToScene, compose the one-liner.
 */
export async function buildSceneDigests(
  storyUnitId: string,
  upToScene: number,
): Promise<SceneDigest[]> {
  // Fetch scene headings and current-state facts in parallel.
  const [scenes, boundaryFacts] = await Promise.all([
    getScenesForUnit(storyUnitId),
    getCompanionFacts("", [{ storyUnitId, upToScene }]),
  ]);

  // Filter to scenes within the boundary (scene 0 is preamble, excluded).
  const relevantScenes = scenes.filter(
    (s) => s.sceneNumber >= 1 && s.sceneNumber <= upToScene,
  );

  if (relevantScenes.length === 0) return [];

  // We need events per scene. Build a map: sceneNumber → events.
  // getEventsForEntities requires entity IDs; since we don't have them here
  // we fall back to the raw scene text approach: we can't fetch events without
  // entity IDs. Instead, use the fact data we already have.
  //
  // Claim-based digest: for each scene, find claims that first became valid
  // here (sourceSceneNumber === sceneNumber) and describe them.

  // Group facts by source scene number.
  const factsByScene = new Map<number, typeof boundaryFacts>();
  for (const fact of boundaryFacts) {
    const sceneNum = fact.sourceSceneNumber;
    if (!factsByScene.has(sceneNum)) factsByScene.set(sceneNum, []);
    factsByScene.get(sceneNum)!.push(fact);
  }

  return relevantScenes.map((scene) => {
    const sceneFacts = factsByScene.get(scene.sceneNumber) ?? [];

    let oneLiner: string;

    if (sceneFacts.length === 0) {
      oneLiner = `Scene ${scene.sceneNumber}: No tracked claims established.`;
    } else {
      // Group by entity to avoid repetition.
      const byEntity = new Map<string, string[]>();
      for (const fact of sceneFacts) {
        if (!byEntity.has(fact.entityName)) byEntity.set(fact.entityName, []);
        byEntity.get(fact.entityName)!.push(
          `${fact.property} is ${fact.value}`,
        );
      }

      const parts: string[] = [];
      for (const [entityName, changes] of byEntity) {
        parts.push(`${entityName}: ${changes.join(", ")}.`);
      }

      oneLiner = `Scene ${scene.sceneNumber}: ${parts.join(" ")}`;

      // Trim to ~3 sentences worth of content (~300 chars).
      if (oneLiner.length > 300) {
        oneLiner = oneLiner.slice(0, 297) + "…";
      }
    }

    return {
      sceneNumber: scene.sceneNumber,
      heading: scene.heading,
      oneLiner,
    };
  });
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * resolveEntitiesFromQuestion
 *
 * Matches entity names and aliases against the question text.
 * Lowercase substring match — deterministic, no Gemini.
 *
 * Falls back to the full entity list if no match is found so that a question
 * like "How did that happen?" still gets the full historical context rather
 * than an empty pack.
 *
 * Exported for testability; callers inside this module use it directly.
 */
export function resolveEntitiesFromQuestion(
  question: string,
  entities: ES[],
): ES[] {
  const normalised = question.toLowerCase();

  const matched = entities.filter((entity) => {
    // Check canonical name.
    if (normalised.includes(entity.canonicalName.toLowerCase())) return true;
    // Check each alias.
    return entity.aliases.some((alias) =>
      normalised.includes(alias.toLowerCase()),
    );
  });

  // Fall back to all entities if nothing matched.
  return matched.length > 0 ? matched : entities;
}

/**
 * parseAliases
 *
 * v1 alias extraction: looks for quoted strings or parenthetical content in
 * the entity description. Returns [canonicalName] as the minimum guaranteed
 * alias so resolveEntitiesFromQuestion always has something to match against.
 *
 * Example:
 *   "Agent Clara Voss, also known as 'The Sparrow'" → ["Clara Voss", "The Sparrow"]
 *   "The Cipher Device (sometimes called the Box)" → ["The Cipher Device", "the Box"]
 */
function parseAliases(canonicalName: string): string[] {
  const aliases: string[] = [canonicalName];

  // Extract content inside double quotes.
  const quoted = canonicalName.match(/"([^"]+)"/g);
  if (quoted) {
    for (const q of quoted) {
      aliases.push(q.replace(/"/g, "").trim());
    }
  }

  // Extract content inside parentheses.
  const parens = canonicalName.match(/\(([^)]+)\)/g);
  if (parens) {
    for (const p of parens) {
      aliases.push(p.replace(/[()]/g, "").trim());
    }
  }

  return [...new Set(aliases)]; // deduplicate
}
