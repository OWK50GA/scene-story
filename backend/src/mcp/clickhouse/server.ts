import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createUniverse,
  getUniverse,
  createProject,
  getProject,
  createStoryUnit,
  getStoryUnit,
  getStoryUnitsForUniverse,
  createEntity,
  findEntityByName,
  getEntitiesForUniverse,
  getEntityWithAncestors,
  writeTemporalRelation,
  getTemporalRelation,
  insertScene,
  getScenesForUnit,
  writeClaim,
  getCurrentState,
  getEntityHistory,
  writeEvent,
  getEventsBetweenScenes,
  writeFinding,
  getFindingsForProject,
  getCrossUnitFindingsForUniverse,
  getCompanionFacts,
  getWorldState,
  findWithinUnitConflicts,
  findCrossUnitConflicts,
} from "./operations.js";
import { MCPOperationError } from "../../types/index.js";

// ---------------------------------------------------------------------------
// MCP server — exposes ClickHouse operations as tools for ADK agents.
//
// The two Guardian-only mutations (updateClaimValidTo, markClaimSupersededByCanon)
// are NOT registered here. They are called directly by Guardian agent code,
// not via MCP tool dispatch, to prevent any other agent from accessing them.
//
// Transport: stdio. The server is launched as a child process by the ADK
// agent runtime. All communication happens over stdin/stdout.
// stderr is reserved for server-level diagnostic logs — never for tool output.
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "lmm-clickhouse",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Error helper — wraps operation errors into MCP-compatible error responses.
// MCPOperationError carries a structured code; everything else is unexpected.
// ---------------------------------------------------------------------------

function toToolError(err: unknown): never {
  if (err instanceof MCPOperationError) {
    throw new Error(`[${err.code}] ${err.message}`);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Tool registration
//
// Each tool follows the same pattern:
//   server.registerTool(name, description, inputSchema, handler)
//
// The handler receives validated input, calls the corresponding operation,
// and returns { content: [{ type: "text", text: JSON.stringify(result) }] }.
// Errors are surfaced as thrown errors — the MCP SDK turns them into
// structured error responses automatically.
// ---------------------------------------------------------------------------

// --- Universe ----------------------------------------------------------------

server.registerTool(
  "create_universe",
  {
    description: "Create a new story universe. All projects, entities, and story units belong to a universe.",
    inputSchema: {
      name: z.string().min(1).describe("The name of the universe, e.g. 'MCU' or 'The Voss Cipher'"),
      description: z.string().describe("A brief description of the universe"),
    },
  },
  async ({ name, description }) => {
    try {
      const universe = await createUniverse({ name, description });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(universe) }]
      };
    } catch (err) {
      toToolError(err);
    }
  }
)

server.registerTool(
  "get_universe",
  {
    description: "Fetch a universe by ID.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
    }
  },
  async ({ universeId }) => {
    try {
      const universe = await getUniverse(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(universe) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_world_state",
  {
    description: "Return the active canonical world state for a universe — all active claims across all story units, highest canon tier wins on conflicts. Used by the Audience Companion and the future Story Writer agent.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
    }
  },
  async ({ universeId }) => {
    try {
      const entries = await getWorldState(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(entries) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Project -----------------------------------------------------------------

server.registerTool(
  "create_project",
  {
    description: "Create a project within a universe. A project is a creative work: a single film, a film series, a TV series, or a crossover.",
    inputSchema: {
      universeId: z.uuid().describe("The parent universe ID"),
      name: z.string().min(1).describe("Project name"),
      type: z.enum(["film", "series", "crossover", "other"]).describe("Project type"),
      canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("Canon authority level: 1 = primary, 2 = secondary, 3 = non-canon"),
    }
  },
  async ({ universeId, name, type, canonTier }) => {
    try {
      const project = await createProject({ universeId, name, type, canonTier });
      return { content: [{ type: "text" as const, text: JSON.stringify(project) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_project",
  {
    description: "Fetch a project by ID.",
    inputSchema: {
      projectId: z.uuid().describe("The project ID"),
    },
  },
  async ({ projectId }) => {
    try {
      const project = await getProject(projectId);
      return { content: [{ type: "text" as const, text: JSON.stringify(project) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Story Unit --------------------------------------------------------------

server.registerTool(
  "create_story_unit",
  {
    description: "Add a story unit to a project. A story unit is a single self-contained narrative: one film or one episode. This is the unit of ingestion.",
    inputSchema: {
      projectId: z.uuid().describe("The parent project ID"),
      universeId: z.uuid().describe("The parent universe ID"),
      title: z.string().min(1).describe("Story unit title"),
      unitType: z.enum(["film", "episode", "short", "other"]).describe("Unit type"),
      seasonNumber: z.number().int().positive().nullable().optional().describe("Season number (series only)"),
      episodeNumber: z.number().int().positive().nullable().optional().describe("Episode number (series only)"),
      inUniversePeriod: z.string().min(1).describe("Required. Human-readable in-universe period label, e.g. 'World War II, 1943'"),
      inUniverseDateStart: z.number().int().nullable().optional().describe("Optional. Year the story unit begins in-universe, e.g. 1943"),
      inUniverseDateEnd: z.number().int().nullable().optional().describe("Optional. Year the story unit ends in-universe"),
      releaseOrder: z.number().int().nonnegative().describe("Release position within the universe. Used as temporal ordering fallback when precise dates are absent"),
    },
  },
  async (input) => {
    try {
      const unit = await createStoryUnit(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(unit) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_story_unit",
  {
    description: "Fetch a story unit by ID.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit ID"),
    },
  },
  async ({ storyUnitId }) => {
    try {
      const unit = await getStoryUnit(storyUnitId);
      return { content: [{ type: "text" as const, text: JSON.stringify(unit) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_story_units_for_universe",
  {
    description: "List all story units in a universe, ordered by release_order.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
    },
  },
  async ({ universeId }) => {
    try {
      const units = await getStoryUnitsForUniverse(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(units) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Entity ------------------------------------------------------------------

server.registerTool(
  "create_entity",
  {
    description: "Create a universe-scoped entity. Entities (characters, objects, locations, factions, concepts) are never owned by a project — they participate across story units. Set parentEntityId when this entity belongs to a broader type (e.g. Tesseract → Infinity Stone).",
    inputSchema: {
      universeId: z.uuid().describe("The universe this entity belongs to"),
      canonicalName: z.string().min(1).describe("The canonical name of the entity"),
      entityType: z.enum(["character", "object", "location", "faction", "concept"]).describe("Entity type"),
      parentEntityId: z.uuid().nullable().optional().describe("Optional. ID of the parent entity type in the hierarchy"),
      description: z.string().describe("Brief description of the entity"),
      firstAppearanceUnitId: z.uuid().nullable().optional().describe("Optional. Story unit where this entity first appears"),
    },
  },
  async (input) => {
    try {
      const entity = await createEntity(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(entity) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_universe_entity",
  {
    description: "Fetch a universe entity by ID, along with its chain of ancestor entities for inherited claim resolution.",
    inputSchema: {
      entityId: z.uuid().describe("The entity ID"),
    },
  },
  async ({ entityId }) => {
    try {
      const result = await getEntityWithAncestors(entityId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "find_universe_entities",
  {
    description: "Search for universe entities by name within a universe. Resolution order: exact match → case-insensitive match. Returns null if no match found — the caller is responsible for Levenshtein fallback and entity creation.",
    inputSchema: {
      universeId: z.uuid().describe("The universe to search within"),
      name: z.string().min(1).describe("The entity name to look up"),
    },
  },
  async ({ universeId, name }) => {
    try {
      const entity = await findEntityByName(universeId, name);
      return { content: [{ type: "text" as const, text: JSON.stringify(entity) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_entities_for_universe",
  {
    description: "List all universe entities in a universe, ordered by canonical name.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
    },
  },
  async ({ universeId }) => {
    try {
      const entities = await getEntitiesForUniverse(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(entities) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_entity_history",
  {
    description: "Return all claims for a universe entity across all story units, ordered by in-universe time. Used to inspect how an entity's properties evolved across the universe.",
    inputSchema: {
      entityId: z.uuid().describe("The entity ID"),
    },
  },
  async ({ entityId }) => {
    try {
      const claims = await getEntityHistory(entityId);
      return { content: [{ type: "text" as const, text: JSON.stringify(claims) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Temporal Relations ------------------------------------------------------

server.registerTool(
  "get_temporal_relation",
  {
    description: "Retrieve a stored temporal ordering between two story units. Returns null if no relation has been resolved yet for this pair.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
      unitAId: z.uuid().describe("First story unit ID"),
      unitBId: z.uuid().describe("Second story unit ID"),
    },
  },
  async ({ universeId, unitAId, unitBId }) => {
    try {
      const relation = await getTemporalRelation(universeId, unitAId, unitBId);
      return { content: [{ type: "text" as const, text: JSON.stringify(relation) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "write_temporal_relation",
  {
    description: "Store a resolved temporal ordering between two story units. Call this after Gemini determines the relation so the reasoning is cached and not repeated.",
    inputSchema: {
      unitAId: z.uuid().describe("First story unit ID"),
      unitBId: z.uuid().describe("Second story unit ID"),
      universeId: z.uuid().describe("The universe ID"),
      relation: z.enum(["before", "after", "overlapping", "indeterminate"]).describe("The resolved temporal relation of unit A relative to unit B"),
      reasoning: z.string().describe("Gemini's explanation for the relation — stored for auditability"),
    },
  },
  async (input) => {
    try {
      await writeTemporalRelation(input);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Scenes ------------------------------------------------------------------

server.registerTool(
  "insert_scene",
  {
    description: "Insert a parsed scene record for a story unit. Called by the ingestion pipeline after the screenplay parser runs, before any agent processes the scene.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit this scene belongs to"),
      projectId: z.uuid().describe("The project ID"),
      universeId: z.uuid().describe("The universe ID"),
      sceneNumber: z.number().int().nonnegative().describe("Sequential scene number, starting at 1"),
      heading: z.string().describe("The scene heading line, e.g. 'INT. BRIEFING ROOM — NIGHT'"),
      rawText: z.string().describe("The full raw text of the scene"),
    },
  },
  async (input) => {
    try {
      const scene = await insertScene(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(scene) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_scenes_for_unit",
  {
    description: "Return all scenes for a story unit in scene-number order.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit ID"),
    },
  },
  async ({ storyUnitId }) => {
    try {
      const scenes = await getScenesForUnit(storyUnitId);
      return { content: [{ type: "text" as const, text: JSON.stringify(scenes) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Claims ------------------------------------------------------------------

server.registerTool(
  "write_claim",
  {
    description: "Write a new claim about a universe entity. Enforces the confidence–source_type contract: explicit 0.90–1.00, implied 0.75–0.89, inferred 0.00–0.60. Rejects with claim.confidence_out_of_range if violated.",
    inputSchema: {
      universeEntityId: z.uuid().describe("The entity this claim is about"),
      universeId: z.uuid().describe("The universe ID"),
      projectId: z.uuid().describe("The project ID"),
      storyUnitId: z.uuid().describe("The story unit where this claim was established"),
      sourceSceneNumber: z.number().int().nonnegative().describe("The scene number where this claim was established"),
      property: z.string().min(1).describe("The property being claimed, e.g. 'location', 'affiliation', 'physical_state'"),
      value: z.string().min(1).describe("The value of the property, e.g. 'HYDRA facility', 'Allied Command'"),
      inUniversePeriod: z.string().min(1).describe("In-universe period label inherited from the story unit"),
      inUniverseDateStart: z.number().int().nullable().optional().describe("In-universe start year, inherited from the story unit"),
      inUniverseDateEnd: z.number().int().nullable().optional().describe("In-universe end year, inherited from the story unit"),
      validFromScene: z.number().int().nonnegative().describe("The scene from which this claim is active"),
      sourceType: z.enum(["explicit", "implied", "inferred"]).describe("How the claim was derived from the scene text"),
      confidence: z.number().min(0).max(1).describe("Confidence score — must fall within the range for the given source_type"),
      confidenceRationale: z.string().describe("Explanation of why this confidence score was assigned"),
      rawExtraction: z.string().describe("The raw JSON extraction from Gemini that produced this claim"),
      sourceLine: z.string().describe("The specific line of scene text this claim was derived from"),
      canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("Canon tier inherited from the project"),
    },
  },
  async (input) => {
    try {
      const claim = await writeClaim(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(claim) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_current_state",
  {
    description: "Return active claims for a list of entity IDs as of a given scene within a story unit. Used by the Story Analyst to build the context summary before processing each scene. Includes inherited parent claims, with child claims taking precedence on property collisions.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit being processed"),
      entityIds: z.array(z.uuid()).describe("List of universe entity IDs to retrieve state for"),
      upToScene: z.number().int().nonnegative().describe("Only include claims from scenes up to and including this scene number"),
    },
  },
  async ({ storyUnitId, entityIds, upToScene }) => {
    try {
      const state = await getCurrentState(storyUnitId, entityIds, upToScene);
      return { content: [{ type: "text" as const, text: JSON.stringify(state) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_companion_facts",
  {
    description: "Return claims visible within a viewer's spoiler boundary. The boundary is a list of {storyUnitId, upToScene} entries. Enforces the boundary at SQL level — no claim beyond the viewer's cutoff is returned, and entities whose first appearance is in an unwatched unit are excluded entirely.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
      boundary: z.array(
        z.object({
          storyUnitId: z.uuid().describe("A story unit the viewer has watched"),
          upToScene: z.number().int().nonnegative().describe("The scene number up to which the viewer has watched this unit. Use 9999 for a fully watched unit."),
        })
      ).min(1).describe("The viewer's spoiler boundary"),
    },
  },
  async ({ universeId, boundary }) => {
    try {
      const facts = await getCompanionFacts(universeId, boundary);
      return { content: [{ type: "text" as const, text: JSON.stringify(facts) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Events ------------------------------------------------------------------

server.registerTool(
  "write_event",
  {
    description: "Write an event that occurred in a scene. Events connect a subject entity to an optional object entity via an action. The Guardian uses events between two conflicting claim scenes to determine whether a transition was intentional.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit ID"),
      projectId: z.uuid().describe("The project ID"),
      universeId: z.uuid().describe("The universe ID"),
      sceneNumber: z.number().int().nonnegative().describe("The scene number where this event occurs"),
      subjectEntityId: z.uuid().describe("The entity performing the action"),
      action: z.string().min(1).describe("The action performed, e.g. 'carries', 'transfers', 'destroys'"),
      objectEntityId: z.uuid().nullable().optional().describe("Optional. The entity the action is directed at"),
      description: z.string().describe("Human-readable description of the event"),
      inUniversePeriod: z.string().min(1).describe("In-universe period label inherited from the story unit"),
    },
  },
  async (input) => {
    try {
      await writeEvent(input);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_events_between_scenes",
  {
    description: "Return all events in a story unit between two scene numbers (inclusive). Used by the Guardian to check whether a transfer or carry event explains a claim change.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit ID"),
      fromScene: z.number().int().nonnegative().describe("Start of the scene range (inclusive)"),
      toScene: z.number().int().nonnegative().describe("End of the scene range (inclusive)"),
    },
  },
  async ({ storyUnitId, fromScene, toScene }) => {
    try {
      const events = await getEventsBetweenScenes(storyUnitId, fromScene, toScene);
      return { content: [{ type: "text" as const, text: JSON.stringify(events) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Findings ----------------------------------------------------------------

server.registerTool(
  "write_finding",
  {
    description: "Write a continuity finding. Only call this for confirmed or ambiguous conflicts — normal_transition verdicts must not produce findings.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
      projectId: z.uuid().describe("The project ID of claim A"),
      storyUnitIdA: z.uuid().describe("Story unit of claim A. For within-unit findings, this equals storyUnitIdB."),
      storyUnitIdB: z.uuid().describe("Story unit of claim B. For within-unit findings, this equals storyUnitIdA."),
      claimAId: z.uuid().describe("The first conflicting claim"),
      claimBId: z.uuid().describe("The second conflicting claim"),
      conflictType: z.enum(["confirmed", "ambiguous"]).describe("Conflict classification. normal_transition must not be passed here."),
      severity: z.enum(["high", "medium", "low"]).describe("Severity of the conflict"),
      scope: z.enum(["within_unit", "cross_unit"]).describe("Whether this conflict is within a single story unit or across multiple"),
      explanation: z.string().min(1).describe("Explanation of why this is a conflict"),
      resolutionSuggestion: z.string().describe("Suggested way to resolve the conflict in the screenplay"),
    },
  },
  async (input) => {
    try {
      const finding = await writeFinding(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(finding) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_findings_for_project",
  {
    description: "Return all continuity findings (within-unit and cross-unit) for all story units in a project.",
    inputSchema: {
      projectId: z.uuid().describe("The project ID"),
    },
  },
  async ({ projectId }) => {
    try {
      const findings = await getFindingsForProject(projectId);
      return { content: [{ type: "text" as const, text: JSON.stringify(findings) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "get_cross_unit_findings_for_universe",
  {
    description: "Return all cross-unit continuity findings for a universe, with full claim citations and source story unit details.",
    inputSchema: {
      universeId: z.uuid().describe("The universe ID"),
    },
  },
  async ({ universeId }) => {
    try {
      const findings = await getCrossUnitFindingsForUniverse(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(findings) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// --- Guardian conflict detection ---------------------------------------------

server.registerTool(
  "find_within_unit_conflicts",
  {
    description: "Find all conflicting claim pairs within a single story unit — same entity, same property, different values, both active. Returns pairs for the Guardian to reason about.",
    inputSchema: {
      storyUnitId: z.uuid().describe("The story unit to scan"),
    },
  },
  async ({ storyUnitId }) => {
    try {
      const conflicts = await findWithinUnitConflicts(storyUnitId);
      return { content: [{ type: "text" as const, text: JSON.stringify(conflicts) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

server.registerTool(
  "find_cross_unit_conflicts",
  {
    description: "Find all conflicting claim pairs across story units in a universe — same entity, same property, different values, both active, from different story units. Returns pairs for the Guardian to reason about.",
    inputSchema: {
      universeId: z.uuid().describe("The universe to scan"),
    },
  },
  async ({ universeId }) => {
    try {
      const conflicts = await findCrossUnitConflicts(universeId);
      return { content: [{ type: "text" as const, text: JSON.stringify(conflicts) }] };
    } catch (err) {
      toToolError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// Start — connect to stdio transport and begin listening.
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lmm-clickhouse] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[lmm-clickhouse] Fatal startup error:", err);
  process.exit(1);
});
