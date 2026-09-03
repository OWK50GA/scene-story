# Scene Story — Living Movie Memory

A structured, queryable story-state engine built on top of a screenplay. It catches continuity errors before they reach production, and answers audience questions without spoiling what they haven't seen yet.

Hackathon submission for **Google Cloud Agentic Cinema** — deadline September 9, 2026.

---

## What It Does

Upload a screenplay. The system reads every scene and builds a live record of who is in the story, what objects exist, where things are, and how all of that changes from scene to scene. Every extracted fact is stored as a **claim** — a typed, sourced, time-bounded assertion about the world of the story.

On top of that record, two things become possible:

**Continuity Guardian** — checks the story for internal contradictions. A prop that vanishes without explanation. A character who left the city but is somehow home two scenes later. The system finds these, cites exactly where each conflicting claim was established, and distinguishes genuine errors from intentional story beats.

**Audience Companion** — answers viewer questions using only the information from scenes they have already watched. Ask about a character, an object, a plot point. If the answer hasn't been established yet in the story, the system says so rather than spoiling what comes next.

---

## Architecture

```
User (filmmaker or viewer)
        ↓
    Web Interface
        ↓
    Backend API  (Cloud Run)
        ↓
    Director Agent  (ADK)
        ↓
  ┌─────┼──────┐
  ↓     ↓      ↓
Story  Continuity  Audience
Analyst  Guardian  Companion
  ↓     ↓      ↓
  └─────┼──────┘
        ↓
  ┌─────┴──────┐
  ↓            ↓
ClickHouse    Grafana
(Story State) (Observability)
```

### The Agents

**Director Agent** — the coordinator. Receives every request from the API, routes it to the right specialist, and assembles the response. When something goes wrong in the pipeline, it queries Grafana via MCP to investigate and decides whether to retry or flag for review. Built with Google Cloud ADK.

**Story Analyst Agent** — the reader. Takes one scene at a time and extracts structured claims from it using Gemini. Writes entities, events, and state changes to ClickHouse. Runs once per scene during ingestion. Has no awareness of other scenes — extraction is intentionally isolated.

**Continuity Guardian Agent** — the investigator. After ingestion, queries ClickHouse for all cases where two active claims share the same entity and property but have different values. Asks Gemini to reason about whether the gap is a genuine contradiction, a normal transition, or an ambiguous case. Writes findings to ClickHouse. Does not modify existing claims.

**Audience Companion Agent** — the guide. Takes a viewer question and a scene number. Before any reasoning, constructs a hard boundary: only claims where `valid_from_scene ≤ viewer's current scene`. Queries ClickHouse with that filter, passes the retrieved facts to Gemini, and answers from within the boundary only. If the answer hasn't been established yet, it says so.

---

## Technology Stack

| Component | Technology |
|---|---|
| Agent framework | Google Cloud ADK |
| LLM | Gemini |
| Story state database | ClickHouse Cloud |
| ClickHouse access | Official ClickHouse MCP server (domain-specific wrapper) |
| Observability | Grafana Cloud |
| Grafana access | Grafana MCP server |
| Backend API | Google Cloud Run |
| Screenplay storage | Google Cloud Storage |

Agents access ClickHouse through a thin MCP wrapper that exposes domain-specific operations rather than raw SQL: `get_entity_history`, `find_active_claims`, `get_scene_facts`, `find_unresolved_transitions`, `write_claim`, `write_finding`.

---

## Data Model

**`projects`** — one row per uploaded screenplay. Tracks ingestion status.

**`scenes`** — one row per scene. Stores the raw text, a summary, the location, and scene number.

**`entities`** — one row per named character, object, or location in the story.

**`claims`** — the core of the system. One row per fact established in the story.

| Field | Description |
|---|---|
| `entity_id` | which entity this fact is about |
| `property` | what aspect of the entity (location, state, possession, etc.) |
| `value` | the value of that property |
| `valid_from_scene` | the scene that established this fact |
| `valid_to_scene` | null while active; filled in by Continuity Guardian when superseded |
| `source_type` | `explicit` / `implied` / `inferred` |
| `confidence` | 1.0 for explicit, 0.85 for implied, ≤0.6 for inferred |

**`events`** — one row per story event. Subject, action, object. Events are what explain transitions between conflicting claims — if an event bridges two claims, it is not a contradiction.

**`continuity_findings`** — one row per contradiction or potential issue. Records the two conflicting claims, conflict type (`confirmed` / `potential` / `ambiguous`), severity, explanation, resolution suggestion, and status.

---

## Confidence and Contradiction Rules

- **Explicit** (directly stated in dialogue or stage direction) → confidence 1.0
- **Implied** (clearly follows from what is stated) → confidence 0.85
- **Inferred** (concluded from context) → confidence ≤ 0.6

A finding is reported as a **confirmed contradiction** only when confidence exceeds 0.7. Below that threshold it surfaces as a potential issue for human review.

A conflict between two claims is only a contradiction if no event exists between them that explains the transition.

---

## Observability

Every pipeline stage emits structured logs and metrics to Grafana:

- Ingestion time per scene
- Claims written per scene
- Confidence score distribution per scene
- Contradiction detection query time
- Audience query response time
- Error counts per stage

When an anomaly is detected, the Director Agent queries Grafana via MCP, logs the issue, retries the failing stage once, and flags for human review if the retry fails.

---

## Project Structure

```
agentic-cinema/
├── backend/        # Cloud Run API + ADK agent definitions
└── frontend/       # Web interface
```

---

## Demo

The demo uses a purpose-written screenplay of 12–15 scenes with 3 named characters, 4–5 named objects that move around, 2 clean transitions with explaining events, 2 planted contradictions, and 1 ambiguous case.

**Filmmaker loop:** upload the screenplay → watch the Story Analyst process it → see the Story State fill with claims → ask the Continuity Guardian to check for problems → see it identify the planted contradiction with full citations and the gap between the two conflicting claims.

**Viewer loop:** ask a question about the story at a scene number before the answer is established → system says it cannot answer yet → advance the scene number past where the answer is established → ask the same question → system answers correctly from within the spoiler boundary.
