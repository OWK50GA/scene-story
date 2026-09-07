# Architectural Gaps

Decisions deferred during initial build. Each entry describes what is missing,
why it matters, where the fix belongs in the codebase, and what is needed to
implement it.

---

## GAP-001 — Original screenplay file is not persisted

### What is missing

When a user uploads a screenplay (PDF or plain text), the file is parsed and
immediately discarded. The raw bytes are never stored. Only the extracted scene
text ends up in ClickHouse.

### Why it matters

- **Re-parsing:** If the screenplay parser is improved (better heading regex,
  expanded transition list, PDF normalisation agent), existing story units
  cannot be reprocessed without asking the user to upload again.
- **Auditability:** There is no way to compare the original source file against
  what was ingested. If a claim looks wrong, the source of truth is gone.
- **User experience:** A future screenplay viewer or diff tool has nothing to
  render. Users cannot retrieve what they submitted.
- **PDF normalisation agent:** The planned agent that converts non-standard PDFs
  into spec format before parsing (see design notes) requires the original file
  to be accessible at agent invocation time.

### Where the fix belongs

`backend/src/routes/ingest.ts` (Task 14) — the upload route.

Before calling `parseScreenplay()`, upload the buffer to object storage and
save the resulting URL on the `story_units` record.

### Implementation sketch

Storage target: **Google Cloud Storage** — already implied by the GCP platform
choice for this project. One bucket per environment.

Object key convention:

```
{universeId}/{storyUnitId}/original.{ext}
```

Story unit schema addition:

```sql
ALTER TABLE story_units ADD COLUMN source_file_url String DEFAULT '';
```

Route change (inside `POST /ingest`):

```typescript
// 1. Upload to GCS before parsing
const fileUrl = await uploadToGCS(req.file.buffer, {
  bucketName: config.GCS_BUCKET,
  objectKey: `${universeId}/${storyUnitId}/original.${ext}`,
  contentType: req.file.mimetype,
});

// 2. Save URL on the story unit record
await updateStoryUnitFileUrl(storyUnitId, fileUrl);

// 3. Continue with parsing as now
const result = await parseScreenplay(req.file.buffer, { ... });
```

New config vars required:

```
GCS_BUCKET=
GCS_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=   # path to service account JSON, or use ADC
```

New dependency: `@google-cloud/storage`

### Blocking status

Does not block Tasks 9–14. The ingest route (Task 14) is the right and only
place to add this. Flag it when Task 14 is being planned.

---

## GAP-002 — Prompt iteration loop not yet verified against all 14 scenes

### What is missing

`backend/scripts/iterate-prompt.ts` exists and is correct, but has not been
run to completion. The first full run (September 2026) hit Gemini free-tier
rate limits — 503s and timeouts — before scenes 4–13 could be processed.
Only scenes 1–3 and 5 returned valid extractions.

As a result, criteria C1, C2, C5, and C6 have not been verified, and the
prompt has not been iterated against actual failures.

### Why it matters

The Story Analyst prompt is the foundation of every claim in the system. If it
consistently misclassifies knowledge claims, bundles atomic facts, or invents
causal events, every downstream component (Guardian, Companion, query layer)
operates on bad data. The prompt needs at least one clean full run before Task
8's done criteria can be considered met.

### Where the fix belongs

No code change needed. Requires a Gemini Enterprise Agent Platform API key
(Google Cloud Console → APIs & Services → Credentials) which removes the free
tier rate limits.

Once the key is in `.env` as `GEMINI_API_KEY`, run:

```
pnpm tsx scripts/iterate-prompt.ts
```

Read `scripts/output/film-a-summary-<timestamp>.txt` and iterate on
`src/agents/story-analyst/prompt.ts` until all 6 criteria pass.

### Blocking status

Blocks the Task 7 and Task 8 done criteria. Does not block Task 9 code work,
but should be resolved before end-to-end pipeline testing.

---

## GAP-003 — Grafana MCP health queries not wired in Director monitoring

### What is missing

`checkIngestionHealth` in `backend/src/agents/director/monitoring.ts` is designed
to query Grafana Cloud Prometheus for per-scene claim counts
(`lmm_claims_written_total`) and processing durations
(`lmm_scene_ingestion_duration_ms`). These metrics are pushed by the Story
Analyst on every scene via `recordSceneIngestionDuration` and
`recordClaimWritten` in `metrics.ts`.

Currently, health data is read directly from ClickHouse scene records instead.
This means duration-based anomaly detection (> 5× median) is not available from
the health check endpoint — only failed scene counts are surfaced.

### Why it matters

The Director's anomaly thresholds (design.md § Director Agent → Anomaly
Thresholds) require duration data per scene. Without Grafana, the health check
can only flag scenes with `ingestion_status = "failed"`, not slow scenes that
completed with low claim counts. The `retryScene` path in `monitoring.ts` is
not affected — it re-runs based on the result it receives directly.

### Where the fix belongs

`backend/src/mcp/grafana/client.ts` — thin wrapper around the Grafana HTTP API
(or Grafana MCP server when available).

Once the client exists, replace the ClickHouse scene reads in
`checkIngestionHealth` with two Prometheus range queries:

```typescript
const claimCounts = await grafana.queryRange(
  `sum by (scene_number) (lmm_claims_written_total{story_unit_id="${storyUnitId}"})`,
);
const durations = await grafana.queryRange(
  `lmm_scene_ingestion_duration_ms{story_unit_id="${storyUnitId}"}`,
);
```

Then compute the median and flag duration anomalies exactly as `detectAnomaly`
does in `orchestration.ts`.

### Blocking status

Does not block any task. Health check is functional (failed scenes are caught).
Duration-based anomaly detection in the health endpoint is degraded until fixed.
Address when implementing the Grafana dashboard (Task 17).

---

## GAP-004 — Guardian within-unit pass runs sequentially, not in parallel

### What is missing

The current implementation of `runWithinUnitPass` in
`backend/src/agents/continuity-guardian/within-unit.ts` processes candidate
transitions one at a time: build dossier → call Gemini → write result → move
to next candidate.

The architecture supports concurrent investigation — each candidate dossier is
independent; no candidate's result depends on another's. The sequential design
was chosen deliberately for the initial implementation because the demo target
(14 scenes, ~3–5 candidates) does not require parallelism, and sequential
execution is easier to debug and trace.

### Why it matters

For a universe with multiple films and hundreds of ingested scenes, the
within-unit Guardian pass for a single story unit could involve dozens of
candidates. Each Gemini call takes roughly 2–5 seconds. Sequential processing
means the pass for a large story unit could take a minute or more before any
finding is returned. This degrades the user-facing `POST /api/units/:id/analyze`
response time and the SSE stream experience.

### Where the fix belongs

`backend/src/agents/continuity-guardian/within-unit.ts` — replace the
sequential candidate loop with `Promise.allSettled()`.

### Implementation sketch

Current (sequential):
```typescript
for (const candidate of candidates) {
  const dossier = await buildEntityDossier(candidate, storyUnitId);
  const verdict = await reasonAboutDossier(dossier, "within_unit");
  await applyVerdict(verdict, candidate);
}
```

Parallel target:
```typescript
const results = await Promise.allSettled(
  candidates.map(async (candidate) => {
    const dossier = await buildEntityDossier(candidate, storyUnitId);
    const verdict = await reasonAboutDossier(dossier, "within_unit");
    await applyVerdict(verdict, candidate);
    return verdict;
  })
);

// Log failures without halting
for (const result of results) {
  if (result.status === "rejected") {
    log({ agent: "guardian", eventType: "candidate_error", status: "failure",
          detail: { reason: String(result.reason) } });
  }
}
```

Three things required before doing this:

1. **Per-candidate error isolation.** One Gemini failure must not abort the
   others. `Promise.allSettled` provides this; `Promise.all` does not.

2. **Deduplication at merge.** If two candidates reference the same claim pair
   (edge case, but possible if entity resolution produced split entities that
   were partially merged), the `writeFinding` call must be idempotent or the
   merge step must deduplicate by `(claim_a_id, claim_b_id)` before writing.

3. **ClickHouse write contention check.** `updateClaimValidTo` and `writeFinding`
   are append/update operations. ClickHouse handles concurrent writes to the
   same table without row-level locks, but verify that two simultaneous
   `updateClaimValidTo` calls on the same `claim_id` are safe (idempotent
   because both would set the same `valid_to_scene` value for a given candidate).

### Blocking status

Does not block any current task. Implement when story unit sizes grow beyond
the demo target and sequential latency becomes observable. Benchmark first.

---

## GAP-005 — Dossier entity context uses coarse inclusion policy

### What is missing

The `buildEntityDossier` function in
`backend/src/agents/continuity-guardian/dossier.ts` includes **all claims for
the focus entity** within the candidate scene window, regardless of property.
For example, if the candidate is `Cipher Device.location`, the dossier also
includes `Cipher Device.key_count`, `Cipher Device.lock_state`, and any other
property extracted for that entity between the two candidate scenes.

This is an intentionally coarse policy. It provides cross-property context
without requiring any classifier to decide which properties are relevant to the
candidate transition. The cost is a slightly larger prompt for entities with
many properties.

### Why it matters

For the demo, the Cipher Device has 3–5 properties and the scene window spans
4–6 scenes. The coarse inclusion adds perhaps 5 extra rows to the dossier —
negligible. For a complex universe entity (a main character across 10 films
with dozens of tracked properties), the coarse inclusion could add hundreds of
rows to a single dossier, degrading both prompt quality (noise) and cost.

### Where the fix belongs

`backend/src/agents/continuity-guardian/dossier.ts` — the entity claims
retrieval section of `buildEntityDossier`.

### Implementation options

**Heuristic (simple):** Include only properties that changed at least once
within the candidate scene window. A property whose value is stable throughout
the window contributes no explanatory information and can be excluded.

```typescript
// Only include properties with >1 distinct value in the scene window
const changedProperties = entityClaims
  .reduce((acc, claim) => {
    acc[claim.property] = acc[claim.property] ?? new Set();
    acc[claim.property].add(claim.value);
    return acc;
  }, {} as Record<string, Set<string>>);

const relevantClaims = entityClaims.filter(
  c => changedProperties[c.property]!.size > 1 || c.property === candidateProperty
);
```

**Semantic similarity (heavier):** Embed property names using a small embedding
model and include only those whose cosine similarity to the candidate property
name exceeds a threshold. Requires an embedding call per candidate, adds latency,
and needs a threshold chosen from empirical data. Not worth building before the
heuristic is tried.

### Blocking status

Does not block any current task. Implement if dossier sizes become problematic
in testing or if Gemini reasoning quality degrades due to noise. Monitor dossier
row counts in logs (`detail.dossier_claim_count`) to catch this early.

---

## GAP-006 — No finding deduplication or synthesis layer

### What is missing

When the Guardian completes a pass (within-unit or cross-unit), findings are
written independently per candidate. There is no step that checks whether two
findings reference overlapping claims, groups related findings about the same
entity, or synthesises a higher-level conclusion across multiple per-property
findings.

For within-unit, this is not a problem: each candidate is per entity+property,
and the same claim pair cannot appear in two candidates (the detection query
produces unique pairs). For cross-unit with large universes, two distinct
property conflicts on the same entity between the same two story units could
produce separate findings that are conceptually part of the same continuity
problem.

### Why it matters

At the UI layer, a reviewer seeing five separate findings about the Cipher
Device across the same two films would benefit from grouping. The findings
table currently has no `group_id` or parent relationship. Each finding stands
alone.

A synthesis layer would also be the right place to catch conflicts whose meaning
only becomes apparent when multiple per-property findings are considered together
— something entity-partitioned parallel investigation cannot surface on its own.

### Where the fix belongs

A new function `mergeFindings(findings[])` in
`backend/src/agents/continuity-guardian/within-unit.ts` (or a shared
`merge.ts` module), called after all candidates are processed and before
`writeFinding` is called for any result.

This requires either:
- a schema change to `continuity_findings` (add `group_id Nullable(String)`)
- or a separate `finding_groups` table if grouping metadata is rich

### Blocking status

Does not block any current task. The demo has 2 within-unit findings and 1
cross-unit finding — grouping adds no value at that scale. Design the schema
extension before implementing the Grafana dashboard (Task 17) so that panel 3
(findings by type and scope) can be grouped by entity if desired.
