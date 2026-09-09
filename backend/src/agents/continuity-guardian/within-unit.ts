/**
 * within-unit.ts
 *
 * Runs the Continuity Guardian's within-unit pass for a single story unit.
 *
 * Algorithm:
 *   1. Fetch all conflicting claim pairs via findWithinUnitConflicts (one SQL query)
 *   2. For each candidate pair, sequentially:
 *      a. Build an EntityDossier (deterministic — no Gemini)
 *      b. Send dossier to Gemini via reasonAboutDossier
 *      c. Apply verdict:
 *         - normal_transition → updateClaimValidTo on the earlier claim; no finding
 *         - confirmed / ambiguous → writeFinding, then updateClaimValidTo
 *   3. Emit metrics and log on completion
 *   4. Return GuardianSummary
 *
 * Sequential processing is intentional. See GAP-004 in ARCHITECTURAL_GAPS.md
 * for the deferred parallel implementation.
 *
 * This function never throws. Per-candidate errors are logged and skipped
 * so a single bad candidate cannot abort the entire pass.
 */

import {
  writeFinding,
  updateClaimValidTo,
  getStoryUnit,
} from "../../mcp/clickhouse/operations.js";
import { runQuery } from "../../mcp/clickhouse/http-client.js";
import type { WithinUnitConflictRow } from "../../mcp/clickhouse/operations.js";
import { log } from "../../observability/logger.js";
import {
  recordGuardianDuration,
  recordClaimPairsExamined,
  recordFindingWritten,
} from "../../observability/metrics.js";
import { buildEntityDossier } from "./dossier.js";
import { reasonAboutDossier } from "./reasoner.js";
import type { GuardianSummary } from "../director/orchestration.js";
import type { ContinuityFinding } from "../../types/index.js";

// =============================================================================
// Public API
// =============================================================================

/**
 * runWithinUnitPass
 *
 * Investigates all candidate continuity transitions for a story unit and
 * persists findings. Returns a summary of what was found.
 */
export async function runWithinUnitPass(
  storyUnitId: string,
): Promise<GuardianSummary> {
  const passStart = Date.now();

  // Load unit for universe/project IDs needed when writing findings.
  let unit;
  try {
    unit = await getStoryUnit(storyUnitId);
  } catch (err) {
    log({
      agent: "guardian",
      universeId: "unknown",
      storyUnitId,
      eventType: "within_unit_pass_load_failed",
      status: "failure",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    return { findingsCount: 0, findings: [] };
  }

  // ── Step 1: Fetch all conflicting claim pairs via official mcp-clickhouse ──
  //
  // This query goes through the official ClickHouse MCP server
  // (github.com/ClickHouse/mcp-clickhouse) — the Guardian retrieves its
  // candidate story-memory conflicts through the MCP layer before reasoning.
  let candidates: WithinUnitConflictRow[];
  try {
    const rows = await runQuery<{
      claim_a_id: string;
      claim_b_id: string;
      universe_entity_id: string;
      property: string;
      value_a: string;
      value_b: string;
      scene_a: string | number;
      scene_b: string | number;
      confidence_a: string | number;
      confidence_b: string | number;
    }>(
      `SELECT
         a.claim_id          AS claim_a_id,
         b.claim_id          AS claim_b_id,
         a.universe_entity_id,
         a.property,
         a.value             AS value_a,
         b.value             AS value_b,
         a.valid_from_scene  AS scene_a,
         b.valid_from_scene  AS scene_b,
         a.confidence        AS confidence_a,
         b.confidence        AS confidence_b
       FROM lmm.claims a
       JOIN lmm.claims b
         ON  a.universe_entity_id = b.universe_entity_id
         AND a.property           = b.property
         AND a.story_unit_id      = b.story_unit_id
         AND a.claim_id           < b.claim_id
         AND a.value              != b.value
       WHERE a.story_unit_id       = '${storyUnitId}'
         AND a.valid_to_scene      IS NULL
         AND b.valid_to_scene      IS NULL
         AND a.superseded_by_canon = 0
         AND b.superseded_by_canon = 0
       ORDER BY a.valid_from_scene`,
    );
    // Coerce ClickHouse string numbers to JS numbers
    candidates = rows.map((r) => ({
      claimAId: r.claim_a_id,
      claimBId: r.claim_b_id,
      universeEntityId: r.universe_entity_id,
      property: r.property,
      valueA: r.value_a,
      valueB: r.value_b,
      sceneA: Number(r.scene_a),
      sceneB: Number(r.scene_b),
      confidenceA: Number(r.confidence_a),
      confidenceB: Number(r.confidence_b),
    }));
  } catch (err) {
    log({
      agent: "guardian",
      universeId: unit.universeId,
      storyUnitId,
      eventType: "within_unit_conflict_fetch_failed",
      status: "failure",
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    return { findingsCount: 0, findings: [] };
  }

  log({
    agent: "guardian",
    universeId: unit.universeId,
    storyUnitId,
    eventType: "within_unit_pass_started",
    status: "success",
    scope: "within_unit",
    detail: { candidateCount: candidates.length },
  });

  console.log(
    `[guardian] within-unit pass: ${candidates.length} candidates for unit ${storyUnitId}`,
  );

  recordClaimPairsExamined("within_unit", candidates.length);

  // ── Step 2: Investigate each candidate ───────────────────────────────────
  const findings: ContinuityFinding[] = [];

  for (const candidate of candidates) {
    try {
      // a. Build the evidence dossier — deterministic, no Gemini
      const dossier = await buildEntityDossier(candidate, storyUnitId);

      // b. Reason about the dossier — Gemini call
      const verdict = await reasonAboutDossier(dossier);

      const { claimA, claimB } = dossier.candidateTransition;
      const earlierClaim = claimA; // dossier guarantees claimA is the earlier scene
      const laterClaim = claimB;

      // c. Apply verdict
      if (verdict.conflictType === "normal_transition") {
        console.log(
          `[guardian] normal_transition: [${candidate.property}] "${candidate.valueA}" → "${candidate.valueB}"`,
        );
        // Legitimate state change — close the earlier claim.
        // No finding written.
        await updateClaimValidTo(
          earlierClaim.claimId,
          laterClaim.validFromScene,
        );

        log({
          agent: "guardian",
          universeId: unit.universeId,
          storyUnitId,
          eventType: "within_unit_normal_transition",
          status: "success",
          scope: "within_unit",
          detail: {
            entityId: candidate.universeEntityId,
            property: candidate.property,
            sceneA: claimA.validFromScene,
            sceneB: claimB.validFromScene,
          },
        });
      } else {
        console.log(
          `[guardian] FINDING: [${candidate.property}] ${verdict.conflictType}/${verdict.severity} — "${candidate.valueA}" vs "${candidate.valueB}"`,
        );
        // confirmed or ambiguous — write a finding, then close the earlier claim.
        const finding = await writeFinding({
          universeId: unit.universeId,
          projectId: unit.projectId,
          storyUnitIdA: storyUnitId,
          storyUnitIdB: storyUnitId, // same unit for within-unit findings
          claimAId: earlierClaim.claimId,
          claimBId: laterClaim.claimId,
          conflictType: verdict.conflictType,
          severity: verdict.severity,
          scope: "within_unit",
          explanation: verdict.explanation,
          resolutionSuggestion: verdict.resolutionSuggestion,
        });

        findings.push(finding);
        recordFindingWritten(verdict.conflictType, "within_unit");

        await updateClaimValidTo(
          earlierClaim.claimId,
          laterClaim.validFromScene,
        );

        log({
          agent: "guardian",
          universeId: unit.universeId,
          storyUnitId,
          eventType: "within_unit_finding_written",
          status: "success",
          scope: "within_unit",
          detail: {
            findingId: finding.findingId,
            conflictType: verdict.conflictType,
            severity: verdict.severity,
            entityId: candidate.universeEntityId,
            property: candidate.property,
            sceneA: claimA.validFromScene,
            sceneB: claimB.validFromScene,
          },
        });
      }
    } catch (err) {
      // Per-candidate failure: log and continue. One bad candidate must not
      // abort the rest of the pass.
      log({
        agent: "guardian",
        universeId: unit.universeId,
        storyUnitId,
        eventType: "within_unit_candidate_error",
        status: "failure",
        scope: "within_unit",
        detail: {
          claimAId: candidate.claimAId,
          claimBId: candidate.claimBId,
          property: candidate.property,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      console.error(
        `[guardian] candidate error — property="${candidate.property}" claimA=${candidate.claimAId.slice(0, 8)} claimB=${candidate.claimBId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Step 3: Emit metrics and final log ────────────────────────────────────
  const durationMs = Date.now() - passStart;
  recordGuardianDuration("within_unit", durationMs);

  log({
    agent: "guardian",
    universeId: unit.universeId,
    storyUnitId,
    eventType: "within_unit_pass_complete",
    durationMs,
    status: "success",
    scope: "within_unit",
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
