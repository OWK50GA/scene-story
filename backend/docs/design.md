# Design — Living Movie Memory

## Overview

```
Browser (React SPA)
        │
        │ HTTP/REST + SSE
        ▼
┌──────────────────────────────────────────────────────────┐
│                    Express API (Node.js)                  │
│                       src/index.ts                        │
└─────────────────────────┬────────────────────────────────┘
                          │ ADK agent invocation
                          ▼
┌──────────────────────────────────────────────────────────┐
│                   Director Agent (ADK)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │    Story     │  │  Continuity  │  │   Audience    │  │
│  │   Analyst    │  │   Guardian   │  │   Companion   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
          └─────────────────┴─────────────────┘
                            │ MCP
               ┌────────────┴────────────┐
               │                         │
     ┌─────────▼──────────┐   ┌──────────▼──────────┐
     │  ClickHouse MCP    │   │    Grafana MCP       │
     │     Wrapper        │   │  (Director only)     │
     └─────────┬──────────┘   └──────────┬───────────┘
               │                         │
     ┌─────────▼──────────┐   ┌──────────▼───────────┐
     │  ClickHouse Cloud  │   │    Grafana Cloud      │
     │  (Universe State)  │   │  Loki + Prometheus    │
     └────────────────────┘   └──────────────────────┘
```

All agent-to-database communication goes through the ClickHouse MCP wrapper. The Director Agent is the only agent that talks to Grafana, and only through the Grafana MCP server. Agents never communicate with each other directly — all routing goes through the Director.

The unit of ingestion is a **story unit** (a film or episode). Story units belong to projects; projects belong to universes. Entities are registered at universe scope and participate across story units — they are never owned by a single project.

---

## Architecture

### Repository Structure

```
agentic-cinema/
├── backend/
│   ├── src/
│   │   ├── index.ts                         # Express entry point
│   │   ├── routes/
│   │   │   ├── universes.ts                 # Universe CRUD + world state + cross-unit analyze + ask
│   │   │   ├── projects.ts                  # Project CRUD + findings
│   │   │   ├── units.ts                     # Story unit CRUD + ingest + within-unit analyze + SSE stream
│   │   │   └── health.ts                    # GET /health
│   │   ├── agents/
│   │   │   ├── director/
│   │   │   │   ├── agent.ts                 # ADK Director agent definition
│   │   │   │   ├── orchestration.ts         # Pipeline orchestration tools
│   │   │   │   └── monitoring.ts            # Health monitoring tools
│   │   │   ├── story-analyst/
│   │   │   │   ├── agent.ts                 # ADK sub-agent definition
│   │   │   │   ├── extractor.ts             # Gemini extraction logic
│   │   │   │   └── prompt.ts                # Prompt templates
│   │   │   ├── continuity-guardian/
│   │   │   │   ├── agent.ts
│   │   │   │   ├── dossier.ts               # Deterministic dossier assembly
│   │   │   │   ├── within-unit.ts           # Within-unit conflict detection
│   │   │   │   ├── cross-unit.ts            # Cross-unit conflict detection
│   │   │   │   ├── temporal.ts              # Temporal ordering resolution
│   │   │   │   ├── reasoner.ts              # Gemini reasoning + verdict rules
│   │   │   │   └── prompt.ts
│   │   │   └── audience-companion/
│   │   │       ├── agent.ts
│   │   │       ├── answerer.ts
│   │   │       └── prompt.ts
│   │   ├── mcp/
│   │   │   ├── clickhouse/
│   │   │   │   ├── server.ts                # MCP server definition
│   │   │   │   ├── operations.ts            # All 17 named operations
│   │   │   │   ├── client.ts                # ClickHouse HTTP client
│   │   │   │   └── queries.ts               # Parameterised SQL strings
│   │   │   └── grafana/
│   │   │       └── client.ts                # Thin wrapper around Grafana MCP
│   │   ├── parser/
│   │   │   ├── index.ts                     # Screenplay → scenes dispatcher
│   │   │   ├── pdf.ts                       # PDF extraction
│   │   │   └── text.ts                      # Plain-text scene splitting
│   │   ├── observability/
│   │   │   ├── logger.ts                    # Loki structured log pusher
│   │   │   └── metrics.ts                   # Prometheus metric emitter
│   │   └── types/
│   │       └── index.ts                     # All shared TypeScript types
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/
│   └── ...                                  # Frontend team's territory
├── grafana/
│   └── dashboards/
│       └── lmm-overview.json                # Dashboard definition (committed)
├── fixtures/
│   ├── film-a.txt                           # Demo Film A screenplay
│   └── film-b.txt                           # Demo Film B screenplay
└── README.md
```

---

## Data Models

All tables live in the `lmm` database on ClickHouse Cloud.

### universes

```sql
CREATE TABLE lmm.universes (
  universe_id   String,
  name          String,
  description   String,
  created_at    DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (universe_id);
```

### projects

```sql
CREATE TABLE lmm.projects (
  project_id    String,
  universe_id   String,
  name          String,
  type          Enum8('film'=0, 'series'=1, 'crossover'=2, 'other'=3),
  canon_tier    UInt8,   -- 1 = primary, 2 = secondary, 3 = non-canon
  created_at    DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (universe_id, project_id);
```

### story_units

```sql
CREATE TABLE lmm.story_units (
  story_unit_id         String,
  project_id            String,
  universe_id           String,
  title                 String,
  unit_type             Enum8('film'=0, 'episode'=1, 'short'=2, 'other'=3),
  season_number         Nullable(UInt16),
  episode_number        Nullable(UInt16),
  in_universe_period    String,                    -- always required
  in_universe_date_start Nullable(Int32),          -- year or NULL
  in_universe_date_end   Nullable(Int32),          -- year or NULL
  release_order         UInt32,                    -- global release order within universe
  ingestion_status      Enum8('pending'=0, 'ingesting'=1, 'complete'=2, 'failed'=3),
  scene_count           UInt16 DEFAULT 0,
  claim_count           UInt32 DEFAULT 0
) ENGINE = MergeTree()
ORDER BY (universe_id, project_id, release_order);
```

### universe_entities

```sql
CREATE TABLE lmm.universe_entities (
  entity_id                String,
  universe_id              String,
  canonical_name           String,
  entity_type              Enum8('character'=0, 'object'=1, 'location'=2,
                                  'faction'=3, 'concept'=4),
  parent_entity_id         Nullable(String),        -- for type hierarchy
  description              String,
  first_appearance_unit_id Nullable(String),
  created_at               DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (universe_id, entity_id);
```

`parent_entity_id` enables arbitrary-depth type hierarchies (e.g. Tesseract → Infinity Stone → Cosmic Artifact). Inheritance is resolved lazily at query time — only ancestors that have active claims relevant to the current query are traversed.

### temporal_relations

```sql
CREATE TABLE lmm.temporal_relations (
  unit_a_id     String,
  unit_b_id     String,
  universe_id   String,
  relation      Enum8('before'=0, 'after'=1, 'overlapping'=2, 'indeterminate'=3),
  reasoning     String,    -- Gemini's explanation, stored for auditability
  created_at    DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (universe_id, unit_a_id, unit_b_id);
```

The `(unit_a_id, unit_b_id)` pair is always stored with `unit_a_id < unit_b_id` lexicographically to avoid duplicate pairs.

### scenes

```sql
CREATE TABLE lmm.scenes (
  scene_id          String,
  story_unit_id     String,
  project_id        String,
  universe_id       String,
  scene_number      UInt16,
  heading           String,
  raw_text          String,
  summary           String,
  ingestion_status  Enum8('pending'=0, 'complete'=1, 'failed'=2)
) ENGINE = MergeTree()
ORDER BY (story_unit_id, scene_number);
```

### claims

```sql
CREATE TABLE lmm.claims (
  claim_id                 String,
  universe_entity_id       String,
  universe_id              String,
  project_id               String,
  story_unit_id            String,
  source_scene_number      UInt16,
  property                 String,
  value                    String,
  in_universe_period       String,          -- inherited from story unit
  in_universe_date_start   Nullable(Int32), -- inherited from story unit
  in_universe_date_end     Nullable(Int32), -- inherited from story unit
  valid_from_scene         UInt16,          -- within the source story unit
  valid_to_scene           Nullable(UInt16),
  source_type              Enum8('explicit'=0, 'implied'=1, 'inferred'=2),
  confidence               Float32,
  confidence_rationale     String,
  raw_extraction           String,          -- JSON blob from Gemini
  source_line              String,
  canon_tier               UInt8,           -- inherited from project
  superseded_by_canon      UInt8 DEFAULT 0  -- 1 if overridden by higher-tier claim
) ENGINE = MergeTree()
ORDER BY (universe_id, universe_entity_id, property, story_unit_id, valid_to_scene);
```

The ORDER BY serves as the compound index for both within-unit and cross-unit conflict queries. `valid_to_scene` sorts NULLs last in ClickHouse, clustering active claims together.

### events

```sql
CREATE TABLE lmm.events (
  event_id              String,
  story_unit_id         String,
  project_id            String,
  universe_id           String,
  scene_number          UInt16,
  subject_entity_id     String,
  action                String,
  object_entity_id      Nullable(String),
  description           String,
  in_universe_period    String
) ENGINE = MergeTree()
ORDER BY (story_unit_id, scene_number);
```

### continuity_findings

```sql
CREATE TABLE lmm.continuity_findings (
  finding_id            String,
  universe_id           String,
  project_id            String,           -- project of claim_a for cross-unit findings
  story_unit_id_a       String,
  story_unit_id_b       String,           -- same as a for within-unit
  claim_a_id            String,
  claim_b_id            String,
  conflict_type         Enum8('confirmed'=0, 'ambiguous'=1),
  severity              Enum8('high'=0, 'medium'=1, 'low'=2),
  scope                 Enum8('within_unit'=0, 'cross_unit'=1),
  explanation           String,
  resolution_suggestion String,
  status                Enum8('open'=0, 'marked_intentional'=1, 'resolved'=2)
) ENGINE = MergeTree()
ORDER BY (universe_id, finding_id);
```

---

## Components and Interfaces

### Entity Registry and Hierarchy

### What qualifies as an entity

An entity is anything the story makes a **claim** about — anything that has properties, states, or behaviors that can be tracked for continuity. The test is: "If this thing changed between scenes without explanation, would it matter?" If yes, it's an entity.

This is determined bottom-up by the Story Analyst. The agent names what it finds in the scene text. It does not impose a type hierarchy. Hierarchy links are added in two ways:

1. **Explicitly in scene text** — if a scene says "the Tesseract, one of the six Infinity Stones," and "Infinity Stones" already exists as a universe entity, the Story Analyst sets `parent_entity_id` on the Tesseract to point to the Infinity Stones entity.
2. **Manually by the producer** — via the API after ingestion.

### Inheritance rules

- A child entity inherits the active claims of its parent at the time its context is queried.
- If the child has its own claim for the same `property`, the child's claim takes precedence.
- Inheritance is resolved lazily. The `get_current_state` and `get_world_state` MCP operations traverse the parent chain upward and merge claims, with child claims winning on collision.
- There is no enforced depth limit. Traversal stops at the first ancestor with no `parent_entity_id`.
- An entity type (e.g. "Infinity Stone") with no claims of its own contributes nothing to any prompt. The system does not create phantom context.

### Practical depth guidance

The hierarchy is only useful when the story makes claims at multiple levels. For a spy thriller where a character carries a briefcase: "briefcase" is a sufficient entity. There is no need for "briefcase → luggage → container." Add intermediate types only when the story text establishes properties at that intermediate level that affect continuity.

---

### In-Universe Time

### Storage

Every story unit carries three temporal fields:

- `in_universe_period` (String, always required) — a human-readable label, e.g. "World War II, 1942", "post-Snap, 2023"
- `in_universe_date_start` (Nullable Int32) — year, e.g. `1942`
- `in_universe_date_end` (Nullable Int32) — year for multi-year spans; equals start for single-year stories

Claims inherit these values from their source story unit at write time.

### Ordering algorithm

When two claims from different story units need to be ordered:

1. **Both have precise dates** — compare `in_universe_date_start`. Lower value is earlier.
2. **One or both lack a precise date** — look up the `temporal_relations` table for the `(unit_a, unit_b)` pair. If a relation exists, use it.
3. **No stored relation** — pass both units' `in_universe_period` strings, any available `in_universe_date_start` values, and their `release_order` values to Gemini with the prompt: "Given these two story periods, determine whether period A comes before, after, overlaps with, or is in an indeterminate relationship to period B." Store the result in `temporal_relations` before proceeding.
4. **Indeterminate** — treat any claim conflict between those units as automatically `ambiguous` regardless of confidence scores.

### Period label conventions

The Story Analyst is instructed to write period labels in a consistent format when they can be inferred from context: `"{descriptive label}, {year or decade}"`. Example: "Cold War era, 1970s". When no year can be inferred, the label alone is acceptable: "before the Snap". These labels are stored as-is and passed to Gemini for semantic reasoning; they are never parsed programmatically.

---

### Screenplay Parser

The parser runs before any agent is invoked. It is pure TypeScript with no LLM calls.

**PDF input**: use `pdf-parse` to extract raw text, then apply the text parser.

**Text input**: split on scene heading patterns. A scene heading is a line matching:

```
/^(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.)\s+/i
```

Each match begins a new scene. Scene number is assigned sequentially from 1.

Edge cases:

- Title pages and preamble content before the first heading are stored as scene 0 with type `preamble` and excluded from ingestion.
- `DISSOLVE TO:` and `CUT TO:` transitions are stripped from `raw_text`.

---

### Story Analyst Agent

### Extraction Schema

The agent returns a `SceneExtraction` JSON object:

```typescript
type SceneExtraction = {
  entities: {
    canonical_name: string;
    entity_type: "character" | "object" | "location" | "faction" | "concept";
    description: string;
    parent_entity_name: string | null; // null if no type relationship is explicit in text
  }[];
  claims: {
    entity_name: string;
    property: string;
    value: string;
    source_type: "explicit" | "implied" | "inferred";
    confidence: number;
    confidence_rationale: string;
    source_line: string;
  }[];
  events: {
    subject: string;
    action: string;
    object: string | null;
    description: string;
  }[];
};
```

If the output is not parseable JSON or fails Zod schema validation, the stage retries once with the same prompt. If the retry also fails, the scene is marked `failed` and the pipeline continues.

### Context Injection

Before generating the prompt for scene N, the agent calls `get_current_state(story_unit_id, entity_ids[])` where `entity_ids` are all universe entities whose canonical names appear in the scene text (matched by fuzzy name lookup). The returned state block includes inherited parent claims resolved lazily:

```
KNOWN STATE OF ENTITIES IN THIS SCENE:
- Tesseract: location = "HYDRA facility" (established scene 3, confidence 1.0)
  [inherited from Infinity Stones]: destructible_by_conventional_means = "false" (universe-level)
- Red Skull: affiliation = "HYDRA" (established scene 1, confidence 1.0)
```

The agent is instructed: "The above represents the current known state. If this scene changes any of these values, write a new claim with the new value. If a value is unchanged, do not repeat it."

### Entity Resolution

After extraction, entity names are resolved to `universe_entity_id`s by querying `find_universe_entities`. Resolution order: exact match → case-insensitive match → Levenshtein ≤ 2 → create new universe entity.

When a `parent_entity_name` is returned by the extraction, the system looks up that name in the same universe and sets `parent_entity_id` if a match is found.

### Sequential Processing

Scenes are processed in order. Each scene's entities, claims, and events are written to ClickHouse before the next scene begins.

---

### Continuity Guardian Agent

The Guardian is a story-continuity investigator, not a claim-pair classifier.
Full design reasoning, including the options considered and rejected, is in
`.kiro/specs/living-movie-memory/continuity-guardian.md`.

The Guardian runs two passes sequentially after each ingestion: within-unit first,
then cross-unit. Both passes follow the same pipeline:

```
findCandidateTransitions()   ← deterministic SQL (ClickHouse)
        ↓
buildEntityDossier()         ← deterministic application code (dossier.ts)
        ↓
reasonAboutDossier()         ← Gemini reasoning (reasoner.ts)
        ↓
applyVerdict()               ← write finding / update claim
```

### Within-Unit Detection Query

Unchanged. Finds all active claim pairs sharing the same entity+property with
different values within one story unit.

```sql
SELECT
  a.claim_id AS claim_a_id,
  b.claim_id AS claim_b_id,
  a.universe_entity_id,
  a.property,
  a.value AS value_a,
  b.value AS value_b,
  a.valid_from_scene AS scene_a,
  b.valid_from_scene AS scene_b,
  a.confidence AS confidence_a,
  b.confidence AS confidence_b
FROM lmm.claims a
JOIN lmm.claims b
  ON  a.universe_entity_id = b.universe_entity_id
  AND a.property           = b.property
  AND a.story_unit_id      = b.story_unit_id
  AND a.claim_id           < b.claim_id
  AND a.value              != b.value
WHERE a.story_unit_id  = {story_unit_id}
  AND a.valid_to_scene IS NULL
  AND b.valid_to_scene IS NULL
ORDER BY a.valid_from_scene;
```

### Entity Dossier

After detection, application code builds an `EntityDossier` for each candidate
pair before any Gemini call is made. The dossier is the complete evidence package
the Guardian reasons over.

```typescript
type EntityDossier = {
  // What is being investigated
  focusEntity: { entityId: string; canonicalName: string; entityType: string };
  candidateProperty: string;
  candidateTransition: { claimA: Claim; claimB: Claim };

  // Full chronological history for the candidate property
  propertyHistory: Claim[];

  // All claims for this entity within the candidate scene window (all properties)
  // Enables cross-property reasoning without a relevance classifier
  entityClaimsInWindow: Claim[];

  // Events where this entity is subject or object, between candidate scenes
  relevantEvents: Event[];

  // Story unit metadata
  storyUnit: {
    storyUnitId: string;
    title: string;
    inUniversePeriod: string;
    canonTier: number;
  };

  // Cross-unit only — populated by cross-unit.ts
  temporalRelation?: TemporalRelationType;
};
```

`buildEntityDossier` is implemented in `continuity-guardian/dossier.ts`. It is
deterministic: no Gemini calls, no side effects. It can be tested independently.

The coarse inclusion policy for `entityClaimsInWindow` (all properties, not just
the candidate property) is intentional for the current implementation. See
GAP-005 in `backend/ARCHITECTURAL_GAPS.md` for the deferred relevance-scoring
improvement.

### Cross-Unit Detection Query

Unchanged. Finds all active claim pairs sharing entity+property across different
story units within the same universe.

```sql
SELECT
  a.claim_id AS claim_a_id,
  b.claim_id AS claim_b_id,
  a.universe_entity_id,
  a.property,
  a.value AS value_a,
  b.value AS value_b,
  a.story_unit_id AS unit_a,
  b.story_unit_id AS unit_b,
  a.in_universe_date_start AS date_a,
  b.in_universe_date_start AS date_b,
  a.in_universe_period AS period_a,
  b.in_universe_period AS period_b,
  a.canon_tier AS tier_a,
  b.canon_tier AS tier_b,
  a.confidence AS confidence_a,
  b.confidence AS confidence_b
FROM lmm.claims a
JOIN lmm.claims b
  ON  a.universe_entity_id = b.universe_entity_id
  AND a.property           = b.property
  AND a.story_unit_id      != b.story_unit_id
  AND a.claim_id           < b.claim_id
  AND a.value              != b.value
WHERE a.universe_id    = {universe_id}
  AND a.valid_to_scene IS NULL
  AND b.valid_to_scene IS NULL
  AND a.superseded_by_canon = 0
  AND b.superseded_by_canon = 0
ORDER BY a.in_universe_date_start NULLS LAST;
```

### Cross-Unit Canon Tier Resolution

Before building a dossier for a cross-unit candidate, the Guardian checks canon
tiers:

- If `tier_a != tier_b`: call `markClaimSupersededByCanon` on the lower-tier
  claim. No dossier built. No finding written. Log the supersession to Loki.
- If `tier_a == tier_b`: proceed to temporal resolution, then build dossier.

### Temporal Resolution for Cross-Unit Pairs

Before building the cross-unit dossier, the temporal ordering of the two story
units is resolved using the 4-branch algorithm in §In-Universe Time. The result
is stored in the dossier as `temporalRelation` and included in the Gemini prompt.

If the relation is `indeterminate`, the Guardian does not call Gemini. It writes
an `ambiguous` finding directly with `severity: "low"` and a standard explanation
noting the unresolvable temporal order.

### Guardian System Prompt

The Guardian's system prompt establishes it as a story-continuity investigator
operating over a chronological state dossier, not a claim-pair classifier. It
instructs the model to:

1. Examine the full property history to understand the state trajectory
2. Search recorded events for explanations before classifying transitions
3. Reason across properties when related claims explain the transition
4. Treat absence of evidence as uncertainty, not proof of contradiction
5. Apply the decision procedure: establish states → establish chronology →
   search for explanation → check related evidence → test consistency →
   assess evidence quality → classify

The full system prompt is in `continuity-guardian/prompt.ts`.

### Guardian Output Schema

Gemini returns exactly one JSON object. Validated by Zod in `reasoner.ts`.

```typescript
type GuardianVerdict = {
  conflictType: "confirmed" | "normal_transition" | "ambiguous";
  severity: "high" | "medium" | "low";
  explanation: string;
  resolutionSuggestion: string; // "" for normal_transition
};
```

For `normal_transition`, `severity` must be `"low"` and `resolutionSuggestion`
must be `""`. These are enforced by the Zod schema.

### Severity Heuristic (system prompt guidance)

- **high** — physical impossibility: object in two places simultaneously, dead
  character acts, entity violates an established rule.
- **medium** — unexplained change: object moves without carrying event, character
  acquires knowledge without information-exchange event.
- **low** — minor inconsistency explainable by offscreen action: prop position,
  minor descriptive mismatch.

### Confidence Downgrade Rule

Applied in `reasoner.ts` after Gemini returns, before any write:

If `conflictType = "confirmed"` and either candidate claim has `confidence ≤ 0.70`,
the result is downgraded to `"ambiguous"`. This is deterministic code, not a
Gemini instruction. There are no exceptions.

### Write Rules

| Verdict             | `updateClaimValidTo` called                        | `writeFinding` called |
| ------------------- | -------------------------------------------------- | --------------------- |
| `normal_transition` | yes — earlier claim gets `valid_to_scene = sceneB` | no                    |
| `confirmed`         | yes                                                | yes                   |
| `ambiguous`         | yes                                                | yes                   |

The Guardian may only call `updateClaimValidTo` and `markClaimSupersededByCanon`.
It has no access to `writeClaim`, `writeEvent`, or any delete operation. This is
enforced by the MCP tool set registered to the Guardian sub-agent.

### Files

```
backend/src/agents/continuity-guardian/
├── prompt.ts        — buildDossierPrompt(dossier): string (system prompt + dossier format)
├── dossier.ts       — buildEntityDossier(candidate, storyUnitId): EntityDossier
├── reasoner.ts      — reasonAboutDossier(dossier): GuardianVerdict
├── within-unit.ts   — runWithinUnitPass(storyUnitId): GuardianSummary
├── cross-unit.ts    — runCrossUnitPass(universeId): GuardianSummary   [Task 11]
├── temporal.ts      — resolveTemporalOrder(unitAId, unitBId, universeId)  [Task 11]
└── agent.ts         — analyzeUnit() / analyzeUniverse()
```

`dossier.ts` is not in the original repository structure (Task 10 adds it).
Its separation from `prompt.ts` and `reasoner.ts` is deliberate: dossier
assembly is deterministic application code and must be independently testable.

---

### Audience Companion Agent

### Spoiler Boundary

The boundary is expressed as a list of `{story_unit_id: string, up_to_scene: number}` pairs. A viewer who has watched Film A completely and Film B up to scene 7 sends:

```json
[
  { "story_unit_id": "film-a-id", "up_to_scene": 9999 },
  { "story_unit_id": "film-b-id", "up_to_scene": 7 }
]
```

Story units not in the list are entirely excluded.

### Boundary Query (get_companion_facts)

```sql
SELECT
  e.canonical_name AS entity_name,
  c.property,
  c.value,
  c.valid_from_scene,
  c.in_universe_period,
  c.confidence,
  su.title AS source_unit_title
FROM lmm.claims c
JOIN lmm.universe_entities e ON c.universe_entity_id = e.entity_id
JOIN lmm.story_units su ON c.story_unit_id = su.story_unit_id
WHERE c.universe_id = {universe_id}
  AND (
    -- one row per boundary entry, expanded by the MCP layer before SQL execution
    (c.story_unit_id = {unit_id_1} AND c.source_scene_number <= {up_to_scene_1})
    OR
    (c.story_unit_id = {unit_id_2} AND c.source_scene_number <= {up_to_scene_2})
    -- ... etc
  )
  AND (c.valid_to_scene IS NULL OR c.valid_to_scene > c.source_scene_number)
  AND e.first_appearance_unit_id IN ({watched_unit_ids})
ORDER BY c.in_universe_date_start NULLS LAST, c.valid_from_scene;
```

The MCP layer expands the boundary list into the IN clauses before execution. No dynamic SQL — the expansion produces a fixed parameterised form per boundary entry.

### Answer Prompt

```
You are answering questions for a viewer. You may only use the facts listed below.
Do not speculate, do not use outside knowledge, and do not hint at anything beyond
the viewer's watched boundary.

If the answer is not contained in the facts, respond with exactly:
"I don't have enough information to answer that yet."
Do not explain why. Do not imply what might happen later.

WATCHED: {comma-separated list of "Unit Title (up to scene N)"}

KNOWN FACTS:
{facts as: "- [entity_name]: [property] is [value] (established in [unit_title], scene N)"}

VIEWER QUESTION: {question}
```

---

### Director Agent (ADK)

### Agent Definition

The Director is an ADK `LlmAgent` with two tool groups:

**Orchestration tools:**

- `run_ingestion_pipeline(story_unit_id, scene_count)` — calls Story Analyst for each scene sequentially, emits SSE progress events
- `run_within_unit_guardian(story_unit_id)` — calls Continuity Guardian within-unit pass
- `run_cross_unit_guardian(universe_id)` — calls Continuity Guardian cross-unit pass
- `run_companion_query(universe_id, question, boundary)` — calls Audience Companion

**Monitoring tools:**

- `check_ingestion_health(story_unit_id)` — queries Grafana for claim counts and scene durations
- `retry_scene(story_unit_id, scene_number)` — re-runs Story Analyst for a single scene
- `flag_for_review(universe_id, context)` — writes a structured alert to Loki

### Post-Ingestion Sequence

When `run_ingestion_pipeline` completes for a story unit, the Director automatically runs:

1. `run_within_unit_guardian(story_unit_id)`
2. `run_cross_unit_guardian(universe_id)`

This sequence is always triggered together. The API's `POST /api/units/:id/ingest` endpoint returns `{ status: "ingesting" }` immediately; progress is delivered via SSE.

### Anomaly Thresholds

The Director's monitoring triggers on:

- Claims per scene < 2 (possible extraction failure)
- Scene processing time > 5× the project median
- Any scene with `ingestion_status = 'failed'`

On anomaly: retry once → if still anomalous: call `flag_for_review`, return 503 from the relevant API endpoint.

---

### ClickHouse MCP Server

The MCP server runs as a sidecar process. It exposes 17 named operations, each with:

- A tool name and description (used by the LLM to select the right tool)
- An input schema (Zod-validated before SQL execution)
- Parameterised SQL (ClickHouse native parameter binding — no string interpolation)

The 17 operations:

| Operation                        | Description                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `get_universe_entity`            | Fetch entity + lazily resolved parent claims                                   |
| `find_universe_entities`         | Search by name within a universe                                               |
| `get_entity_history`             | All claims for an entity across all units, ordered by in-universe time         |
| `find_active_claims`             | Active claims for an entity within a story unit                                |
| `get_scene_facts`                | All claims and events for a scene                                              |
| `get_current_state`              | Active claims for a list of entity IDs as of a given scene (context injection) |
| `get_world_state`                | Active canonical claims for a universe as of an in-universe time point         |
| `get_companion_facts`            | Claims within a spoiler boundary (multi-unit boundary list)                    |
| `find_within_unit_conflicts`     | Conflicting claim pairs within one story unit                                  |
| `find_cross_unit_conflicts`      | Conflicting claim pairs across story units in a universe                       |
| `get_temporal_relation`          | Retrieve stored temporal relation between two story units                      |
| `write_claim`                    | Insert a validated claim (enforces confidence–source_type contract)            |
| `write_event`                    | Insert an event record                                                         |
| `write_finding`                  | Insert a finding record                                                        |
| `write_temporal_relation`        | Store a resolved temporal ordering                                             |
| `update_claim_valid_to`          | Set valid_to_scene on a claim (Guardian only)                                  |
| `mark_claim_superseded_by_canon` | Flag a lower-tier claim as superseded (Guardian only)                          |

The server does not accept arbitrary SQL. Failed validation returns a structured error; no SQL is executed.

---

### Observability

### Loki Log Events

`src/observability/logger.ts` exports `log(event: LogEvent)`:

```typescript
type LogEvent = {
  agent: "director" | "story-analyst" | "guardian" | "companion";
  universe_id: string;
  project_id?: string;
  story_unit_id?: string;
  scene_number?: number;
  event_type: string;
  duration_ms?: number;
  status: "success" | "failure" | "retry";
  scope?: "within_unit" | "cross_unit";
  detail?: Record<string, unknown>;
};
```

Push is fire-and-forget with a 1000-event in-memory queue. Failed pushes are dropped after one retry.

### Prometheus Metrics

| Metric                                 | Labels                     |
| -------------------------------------- | -------------------------- |
| `lmm_scene_ingestion_duration_ms`      | story_unit_id              |
| `lmm_claims_written_total`             | story_unit_id, source_type |
| `lmm_confidence_distribution`          | source_type, bucket        |
| `lmm_extraction_retries_total`         | story_unit_id              |
| `lmm_extraction_failures_total`        | story_unit_id              |
| `lmm_guardian_duration_ms`             | scope                      |
| `lmm_claim_pairs_examined_total`       | scope                      |
| `lmm_findings_written_total`           | conflict_type, scope       |
| `lmm_companion_query_duration_ms`      | —                          |
| `lmm_companion_claims_retrieved_total` | —                          |
| `lmm_companion_boundary_units_count`   | —                          |

Pushed to Grafana Cloud Prometheus via remote write after each pipeline stage.

### Grafana Dashboard

`grafana/dashboards/lmm-overview.json` defines five panels:

1. Claims per scene over ingestion (bar chart, x = scene number, y = claim count, grouped by story unit)
2. Confidence distribution (stacked bar: explicit / implied / inferred)
3. Guardian findings by type and scope (grouped bar: within_unit / cross_unit × confirmed / ambiguous)
4. Cross-unit temporal resolution calls (counter: precise / fuzzy-gemini / indeterminate)
5. Companion query latency (time series, p50/p95)

---

### API

### Routes

```
POST   /api/universes
GET    /api/universes/:id/world-state
POST   /api/universes/:id/analyze         (cross-unit Guardian pass)
POST   /api/universes/:id/ask             (Audience Companion)
GET    /api/universes/:id/findings        (all cross-unit findings)

POST   /api/universes/:id/projects
GET    /api/projects/:id/findings         (within-unit + cross-unit for this project)

POST   /api/projects/:id/units
POST   /api/units/:id/ingest              (async, returns immediately)
GET    /api/units/:id/status
GET    /api/units/:id/ingest-stream       (SSE: real-time ingestion progress)
POST   /api/units/:id/analyze             (within-unit Guardian pass, synchronous)

GET    /health
```

### SSE Event Shape

`GET /api/units/:id/ingest-stream` emits newline-delimited SSE events:

```
event: scene_complete
data: {"scene_number": 4, "claims_written": 6, "status": "complete"}

event: scene_failed
data: {"scene_number": 7, "reason": "gemini_schema_error"}

event: ingestion_complete
data: {"scene_count": 14, "claim_count": 89, "failed_scenes": [7]}
```

### Error Response Shape

All errors return `{ error: string, code: string }` with dot-separated codes:

- `universe.not_found`
- `project.not_found`
- `unit.not_found`
- `ingestion.already_running`
- `ingestion.scene_failed`
- `guardian.anomaly_unresolved`
- `companion.boundary_violation`
- `validation.schema_error`

---

### Demo Fixture

Two screenplays, one universe, one project (type: film series, canon_tier: 1).

**Universe**: The Voss Cipher — a fictional Cold War spy thriller universe.

**Film A — "The Voss Cipher" (1943)**

- 14 scenes
- Characters: Agent Clara Voss (protagonist), Colonel Meinhardt (antagonist), Dr. Hartley (supporting)
- Objects: the Cipher Device, the Red Ledger, the Signal Watch, the Photograph
- Planted within-unit contradiction 1: the Cipher Device is established as "locked in Meinhardt's safe" in scene 5, and then described as "in Clara's hands" in scene 8, with no transfer event between scenes 5 and 8
- Planted within-unit contradiction 2: Dr. Hartley is established as "unaware of the cipher's location" in scene 6, and then demonstrates specific knowledge of it in scene 7 with no information-exchange event
- Clean within-unit transition: Clara takes the Signal Watch from Meinhardt's desk in scene 3 (explicit carry event), and it is correctly in her possession in scene 4
- `in_universe_date_start`: 1943

**Film B — "Legacy Protocol" (present day)**

- 14 scenes
- Characters: Director Sarah Voss (Clara's granddaughter, new entity with family link), Marcus Webb (new character), Agent Clara Voss and Colonel Meinhardt appear in archival/referenced context
- Objects: the Cipher Device (same universe entity as Film A), the Red Ledger (same entity)
- Planted cross-unit contradiction: Film A establishes "the Cipher Device has exactly one activation key." Film B states "the Cipher Device requires two simultaneous keys to activate." Same entity, same property, directly contradictory values, no in-universe event explains the change.
- Clean cross-unit reference: the Red Ledger is described in Film B as "last seen in Allied hands in 1943" — consistent with Film A's final scene where Clara delivers it to Allied command
- `in_universe_date_start`: 2024

This fixture produces:

- 2 within-unit findings from Film A (both confirmed, high severity)
- 1 cross-unit finding spanning Film A and Film B (confirmed, high severity)
- 0 false positives from the two clean transitions

---

## Correctness Properties

### Claim Temporal Consistency

For any `(universe_entity_id, property)` pair within a story unit, there must be at most one active claim (`valid_to_scene IS NULL`) at any scene position. The Guardian is the only process that sets `valid_to_scene`. Claims are never deleted.

### Spoiler Boundary Integrity

The spoiler boundary is enforced at the SQL level inside `get_companion_facts`, not in the agent or API layer. No claim with `source_scene_number` beyond the viewer's cutoff for that unit, and no entity whose `first_appearance_unit_id` is not in the watched list, may appear in any fact list returned to the Companion. `boundary_enforced: true` is set only after the MCP call completes.

### Confidence Range Validity

The `write_claim` MCP operation enforces:

| source_type | valid range |
| ----------- | ----------- |
| explicit    | 0.90 – 1.00 |
| implied     | 0.75 – 0.89 |
| inferred    | 0.00 – 0.60 |

Claims violating this are rejected with a structured error. They are not silently coerced.

### Cross-Unit Canon Priority

When two claims conflict and come from different canon tiers, the lower-tier claim is marked `superseded_by_canon = 1` before any Gemini reasoning is invoked. No finding is written. The world state returned by `get_world_state` always excludes `superseded_by_canon = 1` claims.

### Sequential Ingestion Ordering

Scene N+1 must not begin processing until scene N's writes are committed. `run_ingestion_pipeline` awaits each ClickHouse write before advancing. Out-of-order processing would corrupt `get_current_state` context injection.

### Guardian Write Restrictions

The Guardian may only call `update_claim_valid_to` and `mark_claim_superseded_by_canon`. It has no access to `write_claim`, `write_event`, or any delete operation. This is enforced by the MCP tool set registered to the Guardian sub-agent.

---

## Error Handling

### Gemini Extraction Failures

Malformed JSON or Zod schema failure → retry once → if still failing: mark scene `failed`, emit Loki log `status: "failure"`, continue pipeline. Director flags the project if >10% of scenes fail.

### ClickHouse Write Failures

MCP client retries once after 500ms. Second failure → structured MCP error returned to agent → agent marks affected scene/finding as failed. Pipeline does not halt.

### Temporal Resolution Failures

If Gemini returns an unparseable response for a temporal ordering query → log the failure → treat the pair as `indeterminate` → any conflict between those units is classified `ambiguous`.

### Observability Failures

Loki and Prometheus pushes are fire-and-forget. One retry, then drop. Observability failures never block agent execution. Prometheus buffer holds up to 500 events; oldest evicted when full.

### Scene Timeout

Each Gemini call for a scene has a 30-second timeout. Timeout is treated as a failure and follows the 16.1 retry path.

### Guardian Anomaly Handling

Director detects anomaly → `retry_scene` once → if still anomalous → `flag_for_review` (Loki alert, severity: critical) → API returns 503 with `guardian.anomaly_unresolved`.

---

## Testing Strategy

### Parser Unit Tests

Vitest, no network calls. Cover: all four heading prefix variants, sequential scene numbering, preamble capture, transition stripping, PDF round-trip against a known fixture.

### MCP Tool Validation Tests

Each of the 17 operations tested in isolation against a ClickHouse mock:

- Valid inputs produce correct parameterised query bindings
- Invalid inputs return structured errors without executing SQL
- `write_claim` rejects out-of-range confidence values
- `get_companion_facts` never returns out-of-boundary rows
- `mark_claim_superseded_by_canon` is inaccessible to the Story Analyst tool set

### Agent Prompt Integration Tests

Marked `@integration`, skipped unless `RUN_INTEGRATION=true`. Use real Gemini calls.

- Story Analyst on Film A fixture: ≥ 4 entities, ≥ 15 claims, 0 schema failures
- Within-unit Guardian on Film A: exactly 2 confirmed findings, 0 false positives
- Cross-unit Guardian on Film A + Film B: exactly 1 confirmed cross-unit finding (Cipher Device)
- Companion: scene-boundary question answered correctly at boundary-1 ("not enough information") and boundary scene (substantive answer)

### Spoiler Boundary Contract Test

Unit test, no Gemini. Insert a claim at `source_scene_number = 10` for an entity with `first_appearance_unit_id = film-b`. Call `get_companion_facts` with boundary `[{film-b, up_to_scene: 9}]`. Assert result is empty.

### Temporal Ordering Tests

Unit tests covering all four branches of the ordering algorithm (§5.2): precise dates, stored relation lookup, Gemini fallback (mocked), indeterminate classification.

### API End-to-End Tests

Supertest against a locally started Express server with test ClickHouse. Gemini stubbed via msw. Cover the full create-universe → create-project → create-unit → ingest → analyze → ask flow. Assert SSE events arrive in order and findings surface correctly.
