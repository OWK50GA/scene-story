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
