import EventEmitter from "events";
import { LlmAgent, FunctionTool, AgentTool, Gemini, InMemoryRunner } from "@google/adk";
import { config } from "../../config/index.js";
import {
  runIngestionPipeline,
  runWithinUnitGuardian,
  runCrossUnitGuardian,
  runCompanionQuery,
  type IngestionSummary,
  type GuardianSummary,
  type CompanionAnswer,
} from "./orchestration.js";
import {
  checkIngestionHealth,
  retryScene,
  flagForReview,
  type IngestionHealthReport,
  type RetryResult,
} from "./monitoring.js";
import { log } from "../../observability/logger.js";
import type { SpoilerBoundaryEntry } from "../../types/index.js";
import { z } from 'zod';

// =============================================================================
// Director — ADK LlmAgent
//
// The Director is the root ADK agent. It is the single entry point for all
// route handlers. No route handler calls an agent, operation, or MCP tool
// directly — everything goes through the Director.
//
// Architecture:
//   - The Director is an LlmAgent with orchestration and monitoring tools.
//   - Sub-agents (Story Analyst, Guardian, Companion) are registered as
//     AgentTool instances. They are currently stub LlmAgents. Each will be
//     replaced with a real implementation in Tasks 10–12.
//   - An InMemoryRunner is used to run the Director in-process, one session
//     per ingestion request.
//
// Route handlers call the typed methods on the exported `director` object.
// They never interact with the ADK runner directly.
// =============================================================================

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

const gemini = new Gemini({
  model: "gemini-2.0-flash",
  apiKey: config.GEMINI_API_KEY,
});

// -----------------------------------------------------------------------------
// Sub-agent stubs
//
// Each is a minimal LlmAgent that will be replaced in Tasks 10–12.
// The name and description are what the Director's LLM uses to decide
// which sub-agent to route work to.
// -----------------------------------------------------------------------------

const storyAnalystAgent = new LlmAgent({
  name: "story_analyst",
  description:
    "Reads a single screenplay scene and extracts structured facts: " +
    "entities, claims, and events. Called once per scene during ingestion.",
  model: gemini,
  tools: [],
  instruction:
    "You are the Story Analyst. Process the scene provided to you and " +
    "return structured extraction results.",
});

const guardianAgent = new LlmAgent({
  name: "continuity_guardian",
  description:
    "Analyzes extracted claims for continuity conflicts within a story unit " +
    "or across multiple story units in a universe.",
  model: gemini,
  tools: [],
  instruction:
    "You are the Continuity Guardian. Analyze the claims provided and " +
    "identify any continuity conflicts.",
});

const companionAgent = new LlmAgent({
  name: "audience_companion",
  description:
    "Answers viewer questions about story content within a spoiler boundary. " +
    "Never reveals information beyond the viewer's watched content.",
  model: gemini,
  tools: [],
  instruction:
    "You are the Audience Companion. Answer the viewer's question using " +
    "only the facts within their spoiler boundary.",
});

// -----------------------------------------------------------------------------
// Orchestration tools
// -----------------------------------------------------------------------------

const runIngestionPipelineTool = new FunctionTool({
  name: "run_ingestion_pipeline",
  description:
    "Processes all scenes for a story unit sequentially. Writes entities, " +
    "claims, and events to ClickHouse. Emits SSE progress events. " +
    "Automatically triggers Guardian passes on completion.",
    parameters: z.object({
        storyUnitId: z.string().uuid().describe(
          "The UUID of the story unit to ingest. All scenes for this unit " +
          "must already exist in ClickHouse before calling this tool."
        ),
    }),
  execute: async ( { storyUnitId } ) => {
    // The tool interface doesn't carry the EventEmitter — that's managed
    // at the HTTP layer. When called via ADK, we create a detached emitter
    // so the pipeline logic runs without SSE. Route handlers use the typed
    // Director methods below which supply the real emitter.
    const emitter = new EventEmitter();
    return runIngestionPipeline(storyUnitId, emitter);
  },
});

const runWithinUnitGuardianTool = new FunctionTool({
  name: "run_within_unit_guardian",
  description:
    "Triggers the Continuity Guardian within-unit pass for a story unit. " +
    "Detects claim conflicts within a single film or episode.",
    parameters: z.object({
        storyUnitId: z.string().uuid().describe(
          "The UUID of the story unit to run the within-unit Guardian pass on."
        ),
    }),
  execute: async ({ storyUnitId }) => {
    return runWithinUnitGuardian(storyUnitId);
  },
});

const runCrossUnitGuardianTool = new FunctionTool({
  name: "run_cross_unit_guardian",
  description:
    "Triggers the Continuity Guardian cross-unit pass for a universe. " +
    "Detects claim conflicts spanning multiple story units.",
    parameters: z.object({
        universeId: z.string().uuid().describe(
          "The UUID of the universe to run the cross-unit Guardian pass on. " +
          "All story units within this universe will be compared against each other."
        ),
    }),
  execute: async ({ universeId }) => {
    return runCrossUnitGuardian(universeId);
  },
});

const runCompanionQueryTool = new FunctionTool({
  name: "run_companion_query",
  description:
    "Delegates a viewer question to the Audience Companion. " +
    "Enforces the spoiler boundary at the SQL level before answering.",
    parameters: z.object({
        universeId: z.string().uuid().describe(
          "The UUID of the universe the viewer's question is about."
        ),
        question: z.string().min(1).describe(
          "The viewer's natural-language question about the story. " +
          "Only content within the spoiler boundary will be used to answer."
        ),
        boundary: z.array(z.object({
            storyUnitId: z.string().uuid().describe(
              "The UUID of a story unit the viewer has watched."
            ),
            upToScene: z.coerce.number().int().nonnegative().describe(
              "The last scene number the viewer has watched in this unit (inclusive). " +
              "Use 9999 to indicate the viewer has watched the entire unit."
            ),
        })).min(1).describe(
          "The viewer's spoiler boundary: a list of watched story units and " +
          "how far into each they have watched. Units not listed are fully excluded."
        ),
    }),
  execute: async ({
    universeId,
    question,
    boundary,
  }) => {
    return runCompanionQuery(universeId, question, boundary);
  },
});

// -----------------------------------------------------------------------------
// Monitoring tools
// -----------------------------------------------------------------------------

const checkIngestionHealthTool = new FunctionTool({
  name: "check_ingestion_health",
  description:
    "Inspects the ingestion results for a story unit. Returns a health " +
    "report flagging failed scenes, low claim counts, and duration anomalies.",
    parameters: z.object({
        storyUnitId: z.string().uuid().describe(
          "The UUID of the story unit to check. Returns a health report " +
          "with anomaly flags for failed scenes and low claim counts."
        ),
    }),
  execute: async ({ storyUnitId }) => {
    return checkIngestionHealth(storyUnitId);
  },
});

const retrySceneTool = new FunctionTool({
  name: "retry_scene",
  description:
    "Re-runs the Story Analyst for a single scene. Use when a scene " +
    "produced zero claims, failed, or was flagged as anomalous.",
    parameters: z.object({
        storyUnitId: z.string().uuid().describe(
          "The UUID of the story unit containing the scene to retry."
        ),
        sceneNumber: z.coerce.number().int().min(1).describe(
          "The 1-based scene number to retry. Must match the scene_number " +
          "stored in ClickHouse for this story unit."
        ),
    }),
  execute: async ({
    storyUnitId,
    sceneNumber,
  }) => {
    return retryScene(storyUnitId, sceneNumber);
  },
});

const flagForReviewTool = new FunctionTool({
  name: "flag_for_review",
  description:
    "Writes a critical-severity Loki alert for a universe or unit. " +
    "Called when anomalies persist after retry.",
    parameters: z.object({
        universeId: z.string().uuid().describe(
          "The UUID of the universe the alert belongs to."
        ),
        context: z.record(z.string(), z.unknown()).describe(
          "Structured context about the problem that triggered the review flag. " +
          "Include storyUnitId, sceneNumber, reason, and any relevant counts or errors."
        ),
    }),
  execute: async ({
    universeId,
    context,
  }) => {
    return flagForReview(universeId, context);
  },
});

// -----------------------------------------------------------------------------
// Director LlmAgent definition
// -----------------------------------------------------------------------------

export const directorLlmAgent = new LlmAgent({
  name: "director",
  description:
    "Orchestrates the Living Movie Memory pipeline. Coordinates story " +
    "ingestion, continuity analysis, and audience queries across sub-agents.",
  model: gemini,
  tools: [
    // Sub-agents registered as AgentTools
    new AgentTool({ agent: storyAnalystAgent }),
    new AgentTool({ agent: guardianAgent }),
    new AgentTool({ agent: companionAgent }),
    // Orchestration tools
    runIngestionPipelineTool,
    runWithinUnitGuardianTool,
    runCrossUnitGuardianTool,
    runCompanionQueryTool,
    // Monitoring tools
    checkIngestionHealthTool,
    retrySceneTool,
    flagForReviewTool,
  ],
  instruction: `You are the Director of the Living Movie Memory system.
You orchestrate the full pipeline: ingestion, continuity analysis, and audience queries.

When asked to ingest a story unit, use run_ingestion_pipeline.
When asked to analyze a unit for continuity, use run_within_unit_guardian.
When asked to analyze a universe for cross-unit continuity, use run_cross_unit_guardian.
When asked to answer a viewer question, use run_companion_query.
When asked to check health, use check_ingestion_health.
When asked to retry a scene, use retry_scene.
When a critical anomaly is unresolved, use flag_for_review.

Always complete the requested operation fully before responding.`,
});

// -----------------------------------------------------------------------------
// In-process runner
// -----------------------------------------------------------------------------

const runner = new InMemoryRunner({
  agent: directorLlmAgent,
  appName: "living-movie-memory",
});

// -----------------------------------------------------------------------------
// Director facade
//
// Route handlers use this object exclusively. The ADK runner is hidden behind
// typed methods so no route handler needs to know about ADK internals.
// The emitter-based SSE pattern is preserved for the ingest route.
// -----------------------------------------------------------------------------

class Director {
  // ── Orchestration ──────────────────────────────────────────────────────────

  /**
   * ingestStoryUnit
   *
   * Runs the ingestion pipeline for a story unit.
   * Accepts an external EventEmitter so the route handler owns the emitter
   * lifecycle and can register it in the SSE registry before the pipeline starts.
   *
   * Route handler pattern:
   *   const emitter = new EventEmitter();
   *   pipelineEmitters.set(storyUnitId, emitter);
   *   const pipeline = director.ingestStoryUnit(storyUnitId, emitter);
   *   // client connecting to /ingest-stream picks up the emitter from the map
   */
  ingestStoryUnit(
    storyUnitId: string,
    emitter: EventEmitter
  ): Promise<IngestionSummary> {
    return runIngestionPipeline(storyUnitId, emitter, (sceneNumber) => {
      log({
        agent: "director",
        universeId: "unknown",
        storyUnitId,
        sceneNumber,
        eventType: "scene_retry_triggered",
        status: "retry",
      });
    });
  }

  /**
   * analyzeUnit — within-unit Guardian pass.
   * Called by POST /api/units/:id/analyze (synchronous).
   */
  async analyzeUnit(storyUnitId: string): Promise<GuardianSummary> {
    return runWithinUnitGuardian(storyUnitId);
  }

  /**
   * analyzeUniverse — cross-unit Guardian pass.
   * Called by POST /api/universes/:id/analyze.
   */
  async analyzeUniverse(universeId: string): Promise<GuardianSummary> {
    return runCrossUnitGuardian(universeId);
  }

  /**
   * askCompanion — viewer question with spoiler boundary.
   * Called by POST /api/universes/:id/ask.
   */
  async askCompanion(
    universeId: string,
    question: string,
    boundary: SpoilerBoundaryEntry[]
  ): Promise<CompanionAnswer> {
    return runCompanionQuery(universeId, question, boundary);
  }

  // ── Monitoring ─────────────────────────────────────────────────────────────

  /** Health report for a story unit's ingestion results. */
  async getIngestionHealth(storyUnitId: string): Promise<IngestionHealthReport> {
    return checkIngestionHealth(storyUnitId);
  }

  /** Re-run Story Analyst for a single scene. */
  async retrySingleScene(
    storyUnitId: string,
    sceneNumber: number
  ): Promise<RetryResult> {
    return retryScene(storyUnitId, sceneNumber);
  }

  /** Write a critical Loki alert. */
  async flagUnit(
    universeId: string,
    context: Record<string, unknown>
  ): Promise<void> {
    return flagForReview(universeId, context);
  }

  // ── ADK runner access (for testing / admin use) ────────────────────────────

  /**
   * getRunner — exposes the InMemoryRunner for cases where direct ADK
   * interaction is needed (integration tests, admin CLI scripts).
   * Route handlers should not use this.
   */
  getRunner() {
    return runner;
  }
}

// Singleton — all state lives in ClickHouse, not here.
export const director = new Director();

// Named type exports for route handlers.
export type { IngestionSummary, GuardianSummary, CompanionAnswer };
export type { IngestionHealthReport, RetryResult };
