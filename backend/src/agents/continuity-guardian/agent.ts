/**
 * agent.ts
 *
 * Public entry point for the Continuity Guardian.
 *
 * Exposes two methods:
 *   analyzeUnit(storyUnitId)    — within-unit pass
 *   analyzeUniverse(universeId) — cross-unit pass
 *
 * Called by orchestration.ts — not by route handlers directly.
 */

import { runWithinUnitPass } from "./within-unit.js";
import { runCrossUnitPass } from "./cross-unit.js";
import type { GuardianSummary } from "../director/orchestration.js";

class ContinuityGuardianAgent {
  /**
   * analyzeUnit
   *
   * Runs the within-unit Guardian pass for a story unit.
   * Investigates all candidate claim transitions, writes findings,
   * and closes superseded claims.
   */
  async analyzeUnit(storyUnitId: string): Promise<GuardianSummary> {
    return runWithinUnitPass(storyUnitId);
  }

  /**
   * analyzeUniverse
   *
   * Runs the cross-unit Guardian pass for a universe.
   * Checks canon tier, resolves temporal ordering, builds cross-unit
   * dossiers, and calls the Guardian reasoner for each candidate pair.
   */
  async analyzeUniverse(universeId: string): Promise<GuardianSummary> {
    return runCrossUnitPass(universeId);
  }
}

export const guardianAgent = new ContinuityGuardianAgent();
