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
  findWithinUnitConflicts,
  writeFinding,
  updateClaimValidTo,
  getStoryUnit,
} from "../../mcp/clickhouse/operations.js";
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

  // ── Step 1: Fetch all conflicting claim pairs ─────────────────────────────
  let candidates;
  try {
    candidates = await findWithinUnitConflicts(storyUnitId);
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
        // Legitimate state change — close the earlier claim.
        // No finding written.
        await updateClaimValidTo(earlierClaim.claimId, laterClaim.validFromScene);

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

        await updateClaimValidTo(earlierClaim.claimId, laterClaim.validFromScene);

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
