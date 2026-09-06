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
  findCrossUnitConflicts,
  writeFinding,
  markClaimSupersededByCanon,
  getStoryUnit,
} from "../../mcp/clickhouse/operations.js";
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

  // ── Fetch all cross-unit conflict candidates ──────────────────────────────
  let candidates;
  try {
    candidates = await findCrossUnitConflicts(universeId);
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
