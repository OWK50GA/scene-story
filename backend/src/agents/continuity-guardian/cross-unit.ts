/**
 * cross-unit.ts
 *
 * Runs the Continuity Guardian's cross-unit pass for a universe.
 *
 * Algorithm — for each candidate from findCrossUnitConflicts:
 *
 *   Gate 1 — Canon tier check (deterministic, no Gemini)
 *     If tierA ≠ tierB: mark the lower-tier claim superseded, log, skip.
 *     No dossier built, no finding written.
 *
 *   Gate 2 — Temporal resolution
 *     Call resolveTemporalOrder(unitAId, unitBId, universeId).
 *     If indeterminate: write an ambiguous finding directly, skip Gemini.
 *
 *   Gate 3 — Dossier + reasoning (same as within-unit)
 *     Build a cross-unit EntityDossier via buildCrossUnitDossier.
 *     Inject the temporal relation into the dossier.
 *     Call reasonAboutDossier — same reasoner as within-unit.
 *     Apply verdict write rules.
 *
 * Sequential processing is intentional. See GAP-004 in ARCHITECTURAL_GAPS.md
 * for the deferred parallel implementation.
 *
 * Never throws. Per-candidate errors are logged and skipped.
 */

import {
  writeFinding,
  markClaimSupersededByCanon,
  getStoryUnit,
} from "../../mcp/clickhouse/operations.js";
import { runQuery } from "../../mcp/clickhouse/http-client.js";
import type { CrossUnitConflictRow } from "../../mcp/clickhouse/operations.js";
import { log } from "../../observability/logger.js";
import {
  recordGuardianDuration,
  recordClaimPairsExamined,
  recordFindingWritten,
} from "../../observability/metrics.js";
import { buildCrossUnitDossier } from "./dossier.js";
import { reasonAboutDossier } from "./reasoner.js";
import { resolveTemporalOrder } from "./temporal.js";
import type { GuardianSummary } from "../director/orchestration.js";
import type { ContinuityFinding } from "../../types/index.js";

// =============================================================================
// Public API
// =============================================================================

/**
 * runCrossUnitPass
 *
 * Investigates all candidate cross-unit continuity transitions for a universe
 * and persists findings. Returns a summary of what was found.
 */
export async function runCrossUnitPass(
  universeId: string,
): Promise<GuardianSummary> {
  const passStart = Date.now();

  // ── Fetch all cross-unit conflict candidates via official mcp-clickhouse ──
  //
  // This query goes through the official ClickHouse MCP server — the Guardian
  // retrieves its cross-unit story-memory conflicts through the MCP layer
  // before reasoning over them with Gemini.
  let candidates: CrossUnitConflictRow[];
  try {
    const rows = await runQuery<{
      claim_a_id: string;
      claim_b_id: string;
      universe_entity_id: string;
      property: string;
      value_a: string;
      value_b: string;
      unit_a_id: string;
      unit_b_id: string;
      date_a: string | number | null;
      date_b: string | number | null;
      period_a: string;
      period_b: string;
      tier_a: string | number;
      tier_b: string | number;
      confidence_a: string | number;
      confidence_b: string | number;
    }>(
      `SELECT
         a.claim_id                AS claim_a_id,
         b.claim_id                AS claim_b_id,
         a.universe_entity_id,
         a.property,
         a.value                   AS value_a,
         b.value                   AS value_b,
         a.story_unit_id           AS unit_a_id,
         b.story_unit_id           AS unit_b_id,
         a.in_universe_date_start  AS date_a,
         b.in_universe_date_start  AS date_b,
         a.in_universe_period      AS period_a,
         b.in_universe_period      AS period_b,
         a.canon_tier              AS tier_a,
         b.canon_tier              AS tier_b,
         a.confidence              AS confidence_a,
         b.confidence              AS confidence_b
       FROM lmm.claims a
       JOIN lmm.claims b
         ON  a.universe_entity_id = b.universe_entity_id
         AND a.property           = b.property
         AND a.story_unit_id      != b.story_unit_id
         AND a.claim_id           < b.claim_id
         AND a.value              != b.value
       WHERE a.universe_id        = '${universeId}'
         AND a.valid_to_scene     IS NULL
         AND b.valid_to_scene     IS NULL
         AND a.superseded_by_canon = 0
         AND b.superseded_by_canon = 0
       ORDER BY a.in_universe_date_start NULLS LAST`,
    );
    // Coerce ClickHouse string numbers to JS numbers
    candidates = rows.map((r) => ({
      claimAId: r.claim_a_id,
      claimBId: r.claim_b_id,
      universeEntityId: r.universe_entity_id,
      property: r.property,
      valueA: r.value_a,
      valueB: r.value_b,
      unitAId: r.unit_a_id,
      unitBId: r.unit_b_id,
      dateA: r.date_a !== null ? Number(r.date_a) : null,
      dateB: r.date_b !== null ? Number(r.date_b) : null,
      periodA: r.period_a,
      periodB: r.period_b,
      tierA: Number(r.tier_a),
      tierB: Number(r.tier_b),
      confidenceA: Number(r.confidence_a),
      confidenceB: Number(r.confidence_b),
    }));
  } catch (err) {
    log({
      agent: "guardian",
      universeId,
      eventType: "cross_unit_conflict_fetch_failed",
      status: "failure",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    return { findingsCount: 0, findings: [] };
  }

  log({
    agent: "guardian",
    universeId,
    eventType: "cross_unit_pass_started",
    status: "success",
    scope: "cross_unit",
    detail: { candidateCount: candidates.length },
  });

  recordClaimPairsExamined("cross_unit", candidates.length);

  const findings: ContinuityFinding[] = [];

  for (const candidate of candidates) {
    try {
      // ── Gate 1: Canon tier ──────────────────────────────────────────────
      if (candidate.tierA !== candidate.tierB) {
        // Lower canon tier is superseded by the higher-tier claim.
        // No finding — this is intentional canon hierarchy, not an error.
        const lowerTierClaimId =
          candidate.tierA > candidate.tierB
            ? candidate.claimAId
            : candidate.claimBId;

        const higherTierClaimId =
          candidate.tierA < candidate.tierB
            ? candidate.claimAId
            : candidate.claimBId;

        await markClaimSupersededByCanon(lowerTierClaimId, higherTierClaimId);

        log({
          agent: "guardian",
          universeId,
          eventType: "cross_unit_canon_supersession",
          status: "success",
          scope: "cross_unit",
          detail: {
            lowerTierClaimId,
            higherTierClaimId,
            tierA: candidate.tierA,
            tierB: candidate.tierB,
            property: candidate.property,
            entityId: candidate.universeEntityId,
          },
        });

        continue; // skip to next candidate
      }

      // ── Gate 2: Temporal resolution ─────────────────────────────────────
      const temporalRelation = await resolveTemporalOrder(
        candidate.unitAId,
        candidate.unitBId,
        universeId,
      );

      if (temporalRelation === "indeterminate") {
        // Cannot reason about ordering — write ambiguous directly,
        // no Gemini reasoning step.

        // Load unit titles and projectId for the finding.
        // unitA and unitB are hoisted so projectId doesn't need a second fetch.
        let unitATitle = candidate.unitAId;
        let unitBTitle = candidate.unitBId;
        let unitAProjectId = ""; // fallback; writeFinding requires a projectId
        try {
          const [unitA, unitB] = await Promise.all([
            getStoryUnit(candidate.unitAId),
            getStoryUnit(candidate.unitBId),
          ]);
          unitATitle = unitA.title;
          unitBTitle = unitB.title;
          unitAProjectId = unitA.projectId;
        } catch {
          // Non-fatal — fall back to IDs in the explanation.
        }

        const finding = await writeFinding({
          universeId,
          projectId: unitAProjectId,
          storyUnitIdA: candidate.unitAId,
          storyUnitIdB: candidate.unitBId,
          claimAId: candidate.claimAId,
          claimBId: candidate.claimBId,
          conflictType: "ambiguous",
          severity: "low",
          scope: "cross_unit",
          explanation:
            `The in-universe temporal relationship between "${unitATitle}" ` +
            `and "${unitBTitle}" could not be determined. ` +
            `The conflicting values for "${candidate.property}" on this entity ` +
            `cannot be adjudicated without knowing which unit comes first.`,
          resolutionSuggestion:
            `Set in_universe_date_start on both story units, or manually ` +
            `record a temporal relation between them, then re-run the ` +
            `cross-unit Guardian pass.`,
        });

        findings.push(finding);
        recordFindingWritten("ambiguous", "cross_unit");

        log({
          agent: "guardian",
          universeId,
          eventType: "cross_unit_indeterminate_finding",
          status: "success",
          scope: "cross_unit",
          detail: {
            findingId: finding.findingId,
            unitAId: candidate.unitAId,
            unitBId: candidate.unitBId,
            property: candidate.property,
          },
        });

        continue;
      }

      // ── Gate 3: Dossier + reasoning ─────────────────────────────────────
      const dossier = await buildCrossUnitDossier(candidate);

      // Inject the resolved temporal relation so the prompt includes it.
      dossier.temporalRelation = temporalRelation;

      const verdict = await reasonAboutDossier(dossier);

      const { claimA, claimB } = dossier.candidateTransition;

      if (verdict.conflictType === "normal_transition") {
        // Legitimate cross-unit state change — the earlier claim remains valid
        // within its own unit. Do not set valid_to_scene to a scene number
        // from a different story unit.
        log({
          agent: "guardian",
          universeId,
          eventType: "cross_unit_normal_transition",
          status: "success",
          scope: "cross_unit",
          detail: {
            entityId: candidate.universeEntityId,
            property: candidate.property,
            unitAId: candidate.unitAId,
            unitBId: candidate.unitBId,
            temporalRelation,
          },
        });
      } else {
        // confirmed or ambiguous — write finding.
        // Do not mutate valid_to_scene: the earlier claim is valid within its
        // own unit's scene sequence regardless of what a later unit says.
        const projectId = claimA.projectId;

        const finding = await writeFinding({
          universeId,
          projectId,
          storyUnitIdA: claimA.storyUnitId,
          storyUnitIdB: claimB.storyUnitId,
          claimAId: claimA.claimId,
          claimBId: claimB.claimId,
          conflictType: verdict.conflictType,
          severity: verdict.severity,
          scope: "cross_unit",
          explanation: verdict.explanation,
          resolutionSuggestion: verdict.resolutionSuggestion,
        });

        findings.push(finding);
        recordFindingWritten(verdict.conflictType, "cross_unit");

        log({
          agent: "guardian",
          universeId,
          eventType: "cross_unit_finding_written",
          status: "success",
          scope: "cross_unit",
          detail: {
            findingId: finding.findingId,
            conflictType: verdict.conflictType,
            severity: verdict.severity,
            entityId: candidate.universeEntityId,
            property: candidate.property,
            temporalRelation,
            unitAId: candidate.unitAId,
            unitBId: candidate.unitBId,
          },
        });
      }
    } catch (err) {
      // Per-candidate failure — log and continue.
      log({
        agent: "guardian",
        universeId,
        eventType: "cross_unit_candidate_error",
        status: "failure",
        scope: "cross_unit",
        detail: {
          claimAId: candidate.claimAId,
          claimBId: candidate.claimBId,
          property: candidate.property,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ── Metrics and completion log ────────────────────────────────────────────
  const durationMs = Date.now() - passStart;
  recordGuardianDuration("cross_unit", durationMs);

  log({
    agent: "guardian",
    universeId,
    eventType: "cross_unit_pass_complete",
    durationMs,
    status: "success",
    scope: "cross_unit",
    detail: {
      candidatesExamined: candidates.length,
      findingsWritten: findings.length,
    },
  });

  return {
    findingsCount: findings.length,
    findings,
  };
}
