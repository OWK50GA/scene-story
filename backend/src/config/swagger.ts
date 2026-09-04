import swaggerJSDoc, { type Options } from "swagger-jsdoc";

const options: Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Living Movie Memory API",
      version: "1.0.0",
      description:
        "A live story-state engine for structured screenplay ingestion, " +
        "continuity analysis, and spoiler-safe audience queries.",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT ?? 3001}/api`,
        description: "Local development",
      },
      {
        url: `https://${process.env.PRODUCTION_HOST ?? "api.livingmoviememory.com"}/api`,
        description: "Production",
      },
    ],
    components: {
      schemas: {
        // ── Shared primitives ───────────────────────────────────────────────
        ErrorResponse: {
          type: "object",
          properties: {
            status: { type: "string", example: "error" },
            message: { type: "string" },
            code: { type: "string", example: "universe.not_found" },
          },
        },

        // ── Universe ────────────────────────────────────────────────────────
        Universe: {
          type: "object",
          properties: {
            universe_id: { type: "string", format: "uuid" },
            name: { type: "string", example: "The Voss Universe" },
            description: { type: "string" },
            created_at: { type: "string", format: "date-time" },
          },
        },

        // ── Project ─────────────────────────────────────────────────────────
        Project: {
          type: "object",
          properties: {
            project_id: { type: "string", format: "uuid" },
            universe_id: { type: "string", format: "uuid" },
            name: { type: "string", example: "The Voss Cipher" },
            type: {
              type: "string",
              enum: ["film", "series", "crossover", "other"],
            },
            canon_tier: {
              type: "integer",
              enum: [1, 2, 3],
              description: "1 = primary canon, 2 = secondary, 3 = non-canon",
            },
            created_at: { type: "string", format: "date-time" },
          },
        },

        // ── Story Unit ──────────────────────────────────────────────────────
        StoryUnit: {
          type: "object",
          properties: {
            story_unit_id: { type: "string", format: "uuid" },
            project_id: { type: "string", format: "uuid" },
            universe_id: { type: "string", format: "uuid" },
            title: { type: "string", example: "The Voss Cipher" },
            unit_type: {
              type: "string",
              enum: ["film", "episode", "short", "other"],
            },
            season_number: { type: "integer", nullable: true },
            episode_number: { type: "integer", nullable: true },
            in_universe_period: { type: "string", example: "1943" },
            in_universe_date_start: {
              type: "integer",
              nullable: true,
              example: 1943,
            },
            in_universe_date_end: { type: "integer", nullable: true },
            release_order: { type: "integer", example: 1 },
            ingestion_status: {
              type: "string",
              enum: ["pending", "ingesting", "complete", "failed"],
            },
            scene_count: { type: "integer" },
            claim_count: { type: "integer" },
          },
        },

        // ── World State Entry ───────────────────────────────────────────────
        WorldStateEntry: {
          type: "object",
          properties: {
            entity_id: { type: "string", format: "uuid" },
            entity_name: { type: "string", example: "Cipher Device" },
            property: { type: "string", example: "location" },
            value: { type: "string", example: "locked in Meinhardt's safe" },
            source_unit_title: { type: "string", example: "The Voss Cipher" },
            in_universe_period: { type: "string", example: "1943" },
            canon_tier: { type: "integer", enum: [1, 2, 3] },
          },
        },

        // ── Continuity Finding ──────────────────────────────────────────────
        ContinuityFinding: {
          type: "object",
          properties: {
            finding_id: { type: "string", format: "uuid" },
            universe_id: { type: "string", format: "uuid" },
            project_id: { type: "string", format: "uuid" },
            story_unit_id_a: { type: "string", format: "uuid" },
            story_unit_id_b: { type: "string", format: "uuid" },
            claim_a_id: { type: "string", format: "uuid" },
            claim_b_id: { type: "string", format: "uuid" },
            conflict_type: {
              type: "string",
              enum: ["confirmed", "ambiguous"],
            },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            scope: {
              type: "string",
              enum: ["within_unit", "cross_unit"],
            },
            explanation: { type: "string" },
            resolution_suggestion: { type: "string" },
            status: {
              type: "string",
              enum: ["open", "marked_intentional", "resolved"],
            },
          },
        },

        // ── Guardian Summary ────────────────────────────────────────────────
        GuardianSummary: {
          type: "object",
          properties: {
            findings_count: { type: "integer" },
            findings: {
              type: "array",
              items: { $ref: "#/components/schemas/ContinuityFinding" },
            },
          },
        },

        // ── Companion Answer ────────────────────────────────────────────────
        CompanionAnswer: {
          type: "object",
          properties: {
            answer: { type: "string" },
            claims_used: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entity_name: { type: "string" },
                  property: { type: "string" },
                  value: { type: "string" },
                  source_unit_title: { type: "string" },
                  scene_number: { type: "integer" },
                },
              },
            },
            boundary_enforced: { type: "boolean", example: true },
            boundary_summary: { type: "string" },
          },
        },

        // ── Spoiler Boundary Entry ──────────────────────────────────────────
        SpoilerBoundaryEntry: {
          type: "object",
          required: ["story_unit_id", "up_to_scene"],
          properties: {
            story_unit_id: { type: "string", format: "uuid" },
            up_to_scene: {
              type: "integer",
              minimum: 0,
              description:
                "Last scene number the viewer has watched (inclusive). Use 9999 for fully watched.",
              example: 9999,
            },
          },
        },
      },
    },
  },
  // JSDoc @swagger comments are co-located in the route files
  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJSDoc(options);
