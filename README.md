<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/scenestory-mark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/scenestory-mark-light.svg">
  <img src="assets/scenestory-mark-light.svg" alt="SceneStory" width="480">
</picture></p>

<p align="center"><em>A structured, queryable story-state engine built on top of a screenplay. It catches continuity errors before they reach production, and answers audience questions without spoiling what they haven't seen yet.</em></p>

Hackathon submission for **Google Cloud Agentic Cinema**, deadline September 9, 2026.

---

## What It Does

Upload a screenplay. The system reads every scene and builds a live record of who is in the story, what objects exist, where things are, and how all of that changes from scene to scene. Every extracted fact is stored as a **claim**: a typed, sourced, time-bounded assertion about the world of the story.

On top of that record, two things become possible:

**Continuity Guardian**: checks the story for internal contradictions. A prop that vanishes without explanation. A character who left the city but is somehow home two scenes later. The system finds these, cites exactly where each conflicting claim was established, and distinguishes genuine errors from intentional story beats.

**Audience Companion**: answers viewer questions using only the information from scenes they have already watched. Ask about a character, an object, a plot point. If the answer hasn't been established yet in the story, the system says so rather than spoiling what comes next.

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

**Director Agent**: the coordinator. Receives every request from the API, routes it to the right specialist, and assembles the response. When something goes wrong in the pipeline, it queries Grafana via MCP to investigate and decides whether to retry or flag for review. Built with Google Cloud ADK.

**Story Analyst Agent**: the reader. Takes one scene at a time and extracts structured claims from it using Gemini. Writes entities, events, and state changes to ClickHouse. Runs once per scene during ingestion. Has no awareness of other scenes: extraction is intentionally isolated.

**Continuity Guardian Agent**: the investigator. After ingestion, queries ClickHouse for all cases where two active claims share the same entity and property but have different values. Asks Gemini to reason about whether the gap is a genuine contradiction, a normal transition, or an ambiguous case. Writes findings to ClickHouse. Does not modify existing claims.

**Audience Companion Agent**: the guide. Takes a viewer question and a scene number. Before any reasoning, constructs a hard boundary: only claims where `valid_from_scene ≤ viewer's current scene`. Queries ClickHouse with that filter, passes the retrieved facts to Gemini, and answers from within the boundary only. If the answer hasn't been established yet, it says so.

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

**`projects`**: one row per uploaded screenplay. Tracks ingestion status.

**`scenes`**: one row per scene. Stores the raw text, a summary, the location, and scene number.

**`entities`**: one row per named character, object, or location in the story.

**`claims`**: the core of the system. One row per fact established in the story.

| Field | Description |
|---|---|
| `entity_id` | which entity this fact is about |
| `property` | what aspect of the entity (location, state, possession, etc.) |
| `value` | the value of that property |
| `valid_from_scene` | the scene that established this fact |
| `valid_to_scene` | null while active; filled in by Continuity Guardian when superseded |
| `source_type` | `explicit` / `implied` / `inferred` |
| `confidence` | 1.0 for explicit, 0.85 for implied, ≤0.6 for inferred |

**`events`**: one row per story event. Subject, action, object. Events are what explain transitions between conflicting claims: if an event bridges two claims, it is not a contradiction.

**`continuity_findings`**: one row per contradiction or potential issue. Records the two conflicting claims, conflict type (`confirmed` / `potential` / `ambiguous`), severity, explanation, resolution suggestion, and status.

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

---

## Deployment (Google Cloud Run)

Both services run as Cloud Run services in the `europe-west2` region of the `living-movie-memory` project:

- `scenestory-api` (backend, Express on port 8080)
- `scenestory-web` (frontend, Next.js standalone)

```
Web browser ──► scenestory-web (Cloud Run)
                     │  /api/* proxied server-side
                     ▼
               scenestory-api (Cloud Run)
                     │
                     ▼
        ClickHouse Cloud  +  Gemini API
```

### Prerequisites

- Google Cloud CLI (`gcloud`) installed and authenticated. The repo being public does not grant access to the `living-movie-memory` project; you need an account with Cloud Run Admin, Artifact Registry Admin, Cloud Build Editor, and Secret Manager Admin (or Owner).
- `pnpm` locally, to run the migration script.
- A local `backend/.env`. It is gitignored, so clone it from `backend/.env.example` and fill in the values (ask a maintainer for the ClickHouse credentials and Gemini API key if you do not have them). The deploy commands reference these values.

### Runtime environment

| Where | What |
|---|---|
| Env vars (plain) | `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_DATABASE`, `NODE_ENV` |
| Secret Manager | `GEMINI_API_KEY`, `CLICKHOUSE_PASSWORD` (referenced as env vars on the service) |
| Docker build arg | `BACKEND_URL` (frontend only, baked into the rewrite at build time) |

### One-time setup

The shared `living-movie-memory` project is already provisioned, so on an existing environment **skip every step that already exists** (the commands below error out if you rerun them). They are only needed for a brand-new project:

```bash
gcloud config set project living-movie-memory
gcloud auth login

# Enable APIs
gcloud services enable artifactregistry.googleapis.com run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com

# Artifact Registry repo
gcloud artifacts repositories create scene-story --repository-format=docker --location=europe-west2

# Secrets (values come from your local backend/.env)
printf %s "$GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
printf %s "$CLICKHOUSE_PASSWORD" | gcloud secrets create CLICKHOUSE_PASSWORD --data-file=-

# Allow the Cloud Run service account to read secrets
gcloud projects add-iam-policy-binding living-movie-memory \
  --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

### Deploy the backend

`CLICKHOUSE_HOST` below is a placeholder: fill it (and any other ClickHouse values) from your `backend/.env`.

```bash
gcloud builds submit backend \
  --tag europe-west2-docker.pkg.dev/living-movie-memory/scene-story/backend:latest

gcloud run deploy scenestory-api \
  --image=europe-west2-docker.pkg.dev/living-movie-memory/scene-story/backend:latest \
  --region=europe-west2 --allow-unauthenticated \
  --cpu=1 --memory=1Gi --min-instances=0 --max-instances=5 \
  --set-env-vars=NODE_ENV=production,CLICKHOUSE_HOST=...,CLICKHOUSE_PORT=8443,CLICKHOUSE_USERNAME=default,CLICKHOUSE_DATABASE=lmm \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest,CLICKHOUSE_PASSWORD=CLICKHOUSE_PASSWORD:latest
```

### Migrations

Schema is bootstrapped by a migration script, not by the server:

```bash
cd backend && pnpm exec tsx scripts/migrate.ts
```

What it does:

- Connects to the ClickHouse instance configured by your environment (`CLICKHOUSE_HOST` etc., read from `backend/.env` locally or env vars elsewhere).
- Creates the database if missing, then runs the table DDLs from `backend/src/mcp/clickhouse/queries.ts` (`DDL_TABLES_IN_ORDER`) in dependency order.
- Every statement is `CREATE ... IF NOT EXISTS`. It never drops or alters existing tables, so it is safe to re-run any time.

When to run it:

- Once after ClickHouse is provisioned.
- Once against any new environment (the deployed backend and a local dev box currently share the same ClickHouse Cloud instance and `lmm` database, so prod is already migrated).
- Any time new tables are added to `DDL_TABLES_IN_ORDER`.

Limits to know:

- It only creates tables. Changing the shape of an existing table is not handled by the script, so add the `ALTER` manually (for example via the ClickHouse console) and keep the DDL list in sync.
- It is not run automatically by CI/CD or at server boot, so a deploy that adds a table needs this step run first (the backend tolerates a missing table by failing that specific operation, but the pipeline will not work until the table exists).

### Deploy the frontend

The frontend bakes `BACKEND_URL` into its `/api` rewrite at build time. Deploy the backend first, then pass its URL here.

```bash
gcloud builds submit frontend --config frontend/cloudbuild.yaml \
  --substitutions=_BACKEND_URL=https://scenestory-api-<PROJECT_NUMBER>.europe-west2.run.app

gcloud run deploy scenestory-web \
  --image=europe-west2-docker.pkg.dev/living-movie-memory/scene-story/frontend:latest \
  --region=europe-west2 --allow-unauthenticated \
  --cpu=1 --memory=1Gi --min-instances=0 --max-instances=5
```

### Redeploying after code changes

There is no auto-deploy yet. Push to the repo, then rerun the two `gcloud builds submit` + `gcloud run deploy` blocks above. The backend service URL is stable across deploys, so the frontend only needs a rebuild when its code changed (or when the API service is recreated). Cloud Run keeps every revision, so a bad deploy rolls back with `gcloud run revisions` in the console.

### Smoke check

```bash
curl https://scenestory-api-<PROJECT_NUMBER>.europe-west2.run.app/health
curl https://scenestory-web-<PROJECT_NUMBER>.europe-west2.run.app/api/universes
```

### Containers

- `backend/Dockerfile`: multi-stage (`pnpm install` → `tsc` build → `node dist/index.js`). Production runtime is CommonJS: do not add `"type": "module"` back to `backend/package.json`.
- `frontend/Dockerfile`: multi-stage Next.js standalone build (`output: "standalone"`), runs `node server.js`.
- `.dockerignore` in each service dir excludes `.env`, secrets, and local artifacts. Keep any service account JSON out of the image.
- `frontend/cloudbuild.yaml` builds the frontend with the `BACKEND_URL` build arg.
- The backend lockfile must stay compatible with pnpm 11 (CI runs pnpm 11 via `pnpm/action-setup`). Regenerate it with pnpm 11 if it ever changes.
