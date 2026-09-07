# Requirements Document

## Introduction

Living Movie Memory is a universe-scale story continuity memory layer. It ingests screenplays and builds a structured, queryable record of every fact established in a story — who exists, what properties they have, where they are, and how all of that changes across scenes, across episodes, across films, and across an entire shared universe.

The system serves three users today and is designed to serve a fourth in the future:

- A **filmmaker** who wants to check a screenplay for internal contradictions before production.
- A **showrunner** managing continuity across multiple story units (episodes, films) within a project.
- A **viewer** who wants to ask questions about a story without being spoiled by events beyond what they have watched.
- A **story writer agent** (future path, not built in this version) that crafts new stories within an existing universe and needs the world state as a creative constraint.

The data model is designed to support all four from day one.

---

## Glossary

- **Universe**: The root container. All entities, projects, and story units belong to a universe. Examples: MCU, Arrowverse, House M.D.
- **Project**: A creative work within a universe. Can be a single film, a film series, a TV series, or a crossover. Examples: *Iron Man* (single film), *The Avengers Saga* (film series), *CW Flash* (TV series).
- **Story Unit**: A single self-contained narrative within a project. A film is a story unit. An episode is a story unit. Story units are the unit of ingestion.
- **Scene**: A numbered scene within a story unit, parsed from a screenplay.
- **Universe Entity**: A character, object, location, faction, or concept defined at universe scope. Entities are not owned by any project or story unit; they participate in them.
- **Entity Type**: A category of entity (e.g. "Infinity Stone"). An entity can have a parent entity type, from which it inherits properties.
- **Claim**: A single structured fact about a universe entity (e.g. "the Tesseract is located in HYDRA's possession"). Claims are time-bounded by in-universe time.
- **Event**: An action that occurs in a scene, connecting a subject entity to an optional object entity.
- **In-Universe Time**: The temporal position of a claim or event within the story world. Expressed as a precise date (ISO format or year integer) when known, or as a fuzzy period label (e.g. "World War II era", "post-Snap") when not.
- **Temporal Ordering**: The process of establishing which claim came before another. Uses precise dates when available; falls back to Gemini semantic reasoning over fuzzy period labels when not.
- **Spoiler Boundary**: The set of story units and scene positions a viewer has watched. No data beyond this boundary is visible to the Audience Companion.
- **Canon Tier**: The authority level of a project's claims. Tier 1 = primary canon (e.g. theatrical films). Tier 2 = secondary canon (e.g. tie-in series). Tier 3 = non-canon. When claims conflict across tiers, the higher tier wins.
- **Cross-Unit Continuity**: Continuity checking that spans multiple story units within the same universe.
- **Within-Unit Continuity**: Continuity checking scoped to a single story unit (the original single-screenplay behavior).
- **MCP**: Model Context Protocol. The communication layer between ADK agents and external tools (ClickHouse, Grafana).
- **ADK**: Google Cloud Agent Development Kit. The framework used to build and orchestrate agents.

---

## Requirements

### 1. Universe Management

WHEN a user creates a universe
THE SYSTEM SHALL store: universe_id, name, description, and created_at

WHEN a universe is created
THE SYSTEM SHALL initialize an empty entity registry and an empty world state for that universe

WHEN a user requests the world state of a universe
THE SYSTEM SHALL return the set of all active claims across all story units in that universe, ordered by in-universe time, filtered to the highest canon tier when conflicts exist

### 2. Project Management

WHEN a user creates a project
THE SYSTEM SHALL require that the project is assigned to an existing universe

WHEN a project is created
THE SYSTEM SHALL store: project_id, universe_id, name, type (film | series | crossover | other), canon_tier (1 | 2 | 3), and created_at

WHEN a user adds a story unit to a project
THE SYSTEM SHALL store: story_unit_id, project_id, universe_id, title, unit_type (film | episode | short | other), episode_number (nullable), season_number (nullable), in_universe_period (free text, required), in_universe_date_start (ISO date or year integer, nullable), in_universe_date_end (ISO date or year integer, nullable), release_order (integer, required for temporal fallback), and ingestion_status

WHEN a story unit is added without a precise date
THE SYSTEM SHALL require that in_universe_period is provided and non-empty

WHEN a user reclassifies a project type (e.g. from film to series)
THE SYSTEM SHALL update the project record without affecting any existing story units, claims, or entity assignments

### 3. Universe Entity Registry

WHEN an entity is created
THE SYSTEM SHALL store it at universe scope with: entity_id, universe_id, canonical_name, entity_type (character | object | location | faction | concept), parent_entity_id (nullable), description, first_appearance_unit_id (nullable), and created_at

WHEN an entity has a parent_entity_id
THE SYSTEM SHALL treat the parent's active claims as inherited properties of the child entity unless the child has its own claim for the same property that overrides them

WHEN the Story Analyst Agent resolves entity names from a scene
THE SYSTEM SHALL look up names against the universe entity registry, not a project-local table

WHEN an entity name from a scene does not match any existing universe entity
THE SYSTEM SHALL create a new universe entity for that name and assign it to the universe of the story unit being processed

WHEN entity name resolution is performed
THE SYSTEM SHALL use exact match first, then case-insensitive match, then Levenshtein distance ≤ 2 fallback, and then treat the name as a new entity if no match is found

WHEN a new entity is created during ingestion
THE SYSTEM SHALL set first_appearance_unit_id to the story unit currently being ingested

### 4. In-Universe Time

WHEN a claim is written
THE SYSTEM SHALL record the in_universe_period, in_universe_date_start, and in_universe_date_end of the story unit that sourced it, alongside the source scene number within that unit

WHEN two claims about the same entity and property need to be ordered temporally
THE SYSTEM SHALL use in_universe_date_start for ordering when both claims have a precise date

WHEN two claims need to be ordered but one or both lack a precise date
THE SYSTEM SHALL pass the period labels, any available precise dates, and the release_order values of the source story units to Gemini and instruct it to determine which period plausibly precedes the other

WHEN Gemini determines a temporal ordering for fuzzy periods
THE SYSTEM SHALL store the resolved ordering as a temporal_relation record (unit_a, unit_b, relation: before | after | overlapping | indeterminate) so the reasoning is not repeated for the same pair

WHEN a temporal relation is marked indeterminate
THE SYSTEM SHALL treat any claim conflict between those story units as ambiguous regardless of the confidence scores on the claims

### 5. Screenplay Ingestion

WHEN a user uploads a PDF or plain-text screenplay file for a story unit
THE SYSTEM SHALL parse the file into numbered scenes before invoking any agent

WHEN a screenplay is parsed
THE SYSTEM SHALL store each scene with: scene_id, story_unit_id, project_id, universe_id, scene_number, scene_heading, raw_text, summary (populated later), and ingestion_status

WHEN the Story Analyst Agent processes a scene
THE SYSTEM SHALL extract and persist claims, each recording: claim_id, universe_entity_id, project_id, story_unit_id, source_scene_number, property, value, in_universe_period, in_universe_date_start, in_universe_date_end, valid_from_scene, valid_to_scene (null), source_type, confidence, confidence_rationale, raw_extraction, source_line, and canon_tier (inherited from the project)

WHEN the Story Analyst Agent processes a scene
THE SYSTEM SHALL also extract and persist events: event_id, story_unit_id, scene_number, subject_entity_id, action, object_entity_id (nullable), description, in_universe_period

WHEN the Story Analyst Agent is about to process scene N
THE SYSTEM SHALL retrieve the current active claim values for all universe entities mentioned in scene N's text and inject them as a structured state summary into the Gemini prompt alongside the scene text

WHEN the state summary is injected for scene N
THE SYSTEM SHALL include, for each entity: its own active claims AND the active claims of its parent entity (if any), so inherited properties are visible to the model

WHEN the state summary is injected into a scene prompt
THE SYSTEM SHALL NOT include prior scene text — only structured entity state (entity canonical_name, property, value, source)

WHEN the ingestion pipeline runs
THE SYSTEM SHALL process scenes sequentially in scene-number order so each scene's context summary reflects all claims written by prior scenes in the same unit

WHEN a Gemini response is malformed or fails schema validation
THE SYSTEM SHALL retry the extraction once with the same prompt before marking the scene as failed

WHEN a scene is marked failed
THE SYSTEM SHALL continue ingesting subsequent scenes rather than halting the pipeline

WHEN Gemini assigns a confidence score to a claim
THE SYSTEM SHALL validate that the score falls within the declared source_type range: 0.9–1.0 for explicit, 0.75–0.89 for implied, 0.60 and below for inferred

WHEN any ingestion stage completes or fails
THE SYSTEM SHALL emit structured log events and timing metrics to Grafana

### 6. Continuity Guardian — Within-Unit Pass

WHEN the Continuity Guardian runs a within-unit pass for a story unit
THE SYSTEM SHALL query for all claim pairs where the same universe_entity_id and property have two active claims (valid_to_scene IS NULL) sourced from the same story unit with differing values

WHEN a conflicting claim pair is found within a unit
THE SYSTEM SHALL retrieve all events from that story unit between the two claims' scene numbers and pass claim A, claim B, and the event list to Gemini in a single reasoning call

WHEN Gemini returns a conflict verdict
THE SYSTEM SHALL write a finding record only when conflict_type is confirmed or ambiguous — normal transitions SHALL NOT produce finding records

WHEN a conflict is classified as confirmed within a unit
THE SYSTEM SHALL require that both contributing claims have confidence above 0.7 — if either claim has confidence ≤ 0.7 the conflict SHALL be downgraded to ambiguous

WHEN a finding is written
THE SYSTEM SHALL store: finding_id, universe_id, project_id, story_unit_id_a, story_unit_id_b (same as a for within-unit), claim_a_id, claim_b_id, conflict_type, severity, explanation, resolution_suggestion, scope (within_unit | cross_unit), and status (default: open)

WHEN the Guardian identifies a superseded claim within a unit
THE SYSTEM SHALL update valid_to_scene on the earlier claim to the valid_from_scene of the conflicting claim

WHEN the Guardian runs
THE SYSTEM SHALL NOT create new claims, delete claims, or modify any claim field other than valid_to_scene

### 7. Continuity Guardian — Cross-Unit Pass

WHEN a story unit finishes ingestion
THE SYSTEM SHALL automatically trigger a cross-unit Guardian pass for the universe that story unit belongs to

WHEN a user explicitly requests a cross-unit Guardian pass for a universe
THE SYSTEM SHALL run the pass on demand across all story units in that universe

WHEN the cross-unit Guardian pass runs
THE SYSTEM SHALL query for all claim pairs where the same universe_entity_id and property have active claims sourced from different story units within the same universe, with differing values

WHEN two cross-unit claims need to be compared
THE SYSTEM SHALL resolve their temporal ordering using the in-universe time rules (req 4) before passing them to Gemini

WHEN two cross-unit claims have an indeterminate temporal ordering
THE SYSTEM SHALL pass both claims and the indeterminate relation to Gemini and instruct it to assess whether the values are mutually exclusive regardless of order

WHEN two cross-unit claims conflict and come from projects with different canon tiers
THE SYSTEM SHALL mark the lower-tier claim as superseded_by_canon rather than as a continuity error — no finding record is written, but the supersession is recorded

WHEN two cross-unit claims conflict and come from projects with the same canon tier
THE SYSTEM SHALL apply the same reasoning and severity rules as the within-unit pass

WHEN a cross-unit finding is written
THE SYSTEM SHALL record story_unit_id_a and story_unit_id_b so the finding can be surfaced in the context of either unit

WHEN a Guardian pass completes (either scope)
THE SYSTEM SHALL emit: pass scope, run duration, claim pairs examined, and finding counts by conflict_type and scope to Grafana

### 8. Audience Companion

WHEN a viewer submits a question
THE SYSTEM SHALL require that the request includes a spoiler boundary: a list of (story_unit_id, up_to_scene) pairs representing what the viewer has watched

WHEN the spoiler boundary is enforced
THE SYSTEM SHALL return only claims where the source story unit is in the viewer's watched list AND source_scene_number ≤ the up_to_scene for that unit

WHEN the spoiler boundary is enforced
THE SYSTEM SHALL exclude any universe entity whose first_appearance_unit_id is not in the viewer's watched list, preventing entity names from leaking even if no claims are returned

WHEN the Audience Companion Agent receives the boundary-filtered facts
THE SYSTEM SHALL pass those facts to Gemini and instruct it to answer using only that information

WHEN the answer cannot be derived from within-boundary facts
THE SYSTEM SHALL return a response that does not state or imply anything about what exists beyond the boundary

WHEN the Audience Companion returns a response
THE SYSTEM SHALL include boundary_enforced: true and a summary of the boundary (list of story unit titles and scene cutoffs) in the response object

WHEN a Companion query completes
THE SYSTEM SHALL emit: query latency, claims retrieved count, number of story units in boundary, and whether the boundary was a partial watch or a full watch to Grafana

### 9. Director Agent

WHEN any API request requires agent processing
THE SYSTEM SHALL route it through the Director Agent, which is built using Google Cloud ADK

WHEN the Director Agent receives a pipeline request
THE SYSTEM SHALL invoke specialist agents (Story Analyst, Continuity Guardian, Audience Companion) as ADK sub-agents registered as tools

WHEN ingestion of a story unit completes
THE SYSTEM SHALL have the Director automatically trigger the within-unit Guardian pass followed by the cross-unit Guardian pass

WHEN a pipeline stage produces abnormally low claim counts, takes 5× the project median duration, or is marked failed
THE SYSTEM SHALL have the Director query Grafana via the Grafana MCP server, log the anomaly, retry the failing stage once, and flag for human review if the retry also fails

WHEN the Director Agent needs data
THE SYSTEM SHALL route all data access through the ClickHouse MCP wrapper

### 10. ClickHouse MCP Wrapper

WHEN any agent needs to read or write story state data
THE SYSTEM SHALL require that access goes through the ClickHouse MCP wrapper — agents SHALL NOT be given raw SQL tools

WHEN a MCP tool call fails input validation
THE SYSTEM SHALL return a structured error and SHALL NOT execute the SQL

THE SYSTEM SHALL expose the following named operations:

- **get_universe_entity** — fetch a single entity and its inherited parent claims by universe_entity_id
- **find_universe_entities** — search universe entities by name within a universe
- **get_entity_history** — all claims for a universe entity across all story units, ordered by in-universe time
- **find_active_claims** — active claims for an entity within a story unit
- **get_scene_facts** — all claims and events for a scene
- **get_current_state** — active claims for a list of entity IDs as of a given scene within a story unit (used for context injection)
- **get_world_state** — active claims for a universe as of a given in-universe time point, respecting canon tier priority (used for cross-unit Guardian and future Story Writer)
- **get_companion_facts** — claims visible within a spoiler boundary expressed as a list of (story_unit_id, up_to_scene) pairs
- **find_cross_unit_conflicts** — claim pairs across story units in a universe with the same entity+property and differing values
- **find_within_unit_conflicts** — claim pairs within a single story unit with the same entity+property and differing values
- **get_temporal_relation** — retrieve a stored temporal_relation between two story units if one exists
- **write_claim** — insert a validated claim record
- **write_event** — insert an event record
- **write_finding** — insert a finding record
- **write_temporal_relation** — store a resolved temporal ordering between two story units
- **update_claim_valid_to** — set valid_to_scene on a claim (Guardian only)
- **mark_claim_superseded_by_canon** — flag a lower-tier claim as superseded (Guardian only)

### 11. Observability

WHEN any agent completes an operation
THE SYSTEM SHALL push a structured log line to Grafana Loki containing: timestamp, agent, universe_id, project_id, story_unit_id (where applicable), scene_number (where applicable), event_type, duration_ms, and status

WHEN an ingestion run completes a scene
THE SYSTEM SHALL emit: lmm_scene_ingestion_duration_ms, lmm_claims_written_total (labelled by story_unit), lmm_confidence_distribution, lmm_extraction_retries_total, lmm_extraction_failures_total

WHEN a Guardian pass completes
THE SYSTEM SHALL emit: lmm_guardian_duration_ms, lmm_claim_pairs_examined_total (labelled by scope: within_unit | cross_unit), lmm_findings_written_total (labelled by conflict_type and scope)

WHEN a Companion query completes
THE SYSTEM SHALL emit: lmm_companion_query_duration_ms, lmm_companion_claims_retrieved_total, lmm_companion_boundary_units_count

WHEN the system is deployed
THE SYSTEM SHALL provision a Grafana dashboard with per-scene claim counts, confidence distribution, Guardian finding rates (split by scope), and Companion query latency — and the dashboard definition SHALL be committed to the repository

### 12. API

WHEN a POST /api/universes request is received
THE SYSTEM SHALL create a universe record and return { universe_id, name, created_at }

WHEN a GET /api/universes/:id/world-state request is received
THE SYSTEM SHALL return the active canonical world state for that universe

WHEN a POST /api/universes/:id/projects request is received
THE SYSTEM SHALL create a project within that universe and return { project_id, universe_id, name, type, canon_tier, created_at }

WHEN a POST /api/projects/:id/units request is received
THE SYSTEM SHALL create a story unit record within that project and return the story unit object

WHEN a POST /api/units/:id/ingest request is received with a screenplay file
THE SYSTEM SHALL parse the file, create scene records, trigger ingestion asynchronously, and return { story_unit_id, status: "ingesting" }

WHEN a GET /api/units/:id/status request is received
THE SYSTEM SHALL return current ingestion status, scene count, claim count, and a list of any failed scenes

WHEN a POST /api/units/:id/analyze request is received
THE SYSTEM SHALL invoke the within-unit Guardian pass synchronously and return all within-unit findings on completion

WHEN a POST /api/universes/:id/analyze request is received
THE SYSTEM SHALL invoke the cross-unit Guardian pass across all ingested story units in the universe and return all cross-unit findings on completion

WHEN a GET /api/projects/:id/findings request is received
THE SYSTEM SHALL return all findings (within-unit and cross-unit) for all story units in the project, with full claim citations and scope labels

WHEN a GET /api/universes/:id/findings request is received
THE SYSTEM SHALL return all cross-unit findings for the universe, with full claim citations, source story unit titles, and canon tier information

WHEN a POST /api/universes/:id/ask request is received with { question, boundary: [{story_unit_id, up_to_scene}] }
THE SYSTEM SHALL return { answer, claims_used, boundary_enforced: true, boundary_summary }

WHEN a GET /health request is received
THE SYSTEM SHALL return { status: "healthy" }

### 13. Demo Fixture

The demo fixture consists of two screenplays written for the same universe, designed to produce reliable and readable demo moments for both within-unit and cross-unit contradiction detection.

WHEN the demo fixture is loaded
THE SYSTEM SHALL have the following structure:
- One universe: a fictional spy thriller universe
- One project of type "film series" with canon_tier 1
- Two story units: Film A (set during World War II) and Film B (set in the present day, ~80 years later)

Film A SHALL contain:
- 12–15 scenes
- 3 named characters, 4 named objects (including one object that appears in both films)
- 2 planted within-unit contradictions: clear physical impossibilities (object in two places, or character with contradictory knowledge in adjacent scenes)
- 1 clean within-unit transition (explicit transfer event the Guardian should classify as normal_transition)
- Precise in_universe_date_start: a year in the 1940s

Film B SHALL contain:
- 12–15 scenes
- 2 characters who also appear in Film A (same universe entities), 2 new characters
- 1 planted cross-unit contradiction: a property of the shared object that Film B explicitly contradicts what Film A established, with no in-universe event that explains the change
- 1 clean cross-unit reference: a character from Film A is mentioned by name in Film B in a way that is consistent with Film A's claims about them
- Precise in_universe_date_start: a year in the present day

WHEN the demo fixture is loaded
THE SYSTEM SHALL make both screenplay files available for upload through the standard ingestion API — there is no "Load Demo" shortcut in the backend; the demo files are static fixtures that the frontend can bundle or the user can upload manually

### 14. Frontend (Interface Contract Only)

The frontend is owned by a separate team. The backend SHALL provide the following behaviors that the frontend depends on:

THE SYSTEM SHALL support CORS for the frontend origin configured via environment variable

THE SYSTEM SHALL return all API errors as JSON { error: string, code: string } with appropriate HTTP status codes, using dot-separated error codes (e.g. universe.not_found, ingestion.scene_failed, companion.boundary_violation)

THE SYSTEM SHALL emit SSE (Server-Sent Events) on GET /api/units/:id/ingest-stream so the frontend can display real-time ingestion progress without polling

THE SYSTEM SHALL include Content-Type: application/json on all non-SSE responses

The frontend SHALL present at minimum: a universe/project/unit creation flow, ingestion upload and progress, findings display (within-unit and cross-unit clearly distinguished), and the Audience Companion question interface with multi-unit boundary selection
