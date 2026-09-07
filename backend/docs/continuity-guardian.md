# Continuity Guardian — Design Reasoning

This document records the design thinking behind the Continuity Guardian component
of Bloodraven. It covers what was considered, what was rejected, what was adopted,
and what was deferred. It is a living record, not a tutorial.

---

## What the Guardian is for

Bloodraven's core premise is that a story world has a **persistent state**, and that
state evolves scene by scene. The Story Analyst extracts that state into structured
claims and events. ClickHouse stores it. The Continuity Guardian's job is to
determine whether the extracted state history is **internally coherent** — whether
the world can move from one established state to another without contradiction.

The Guardian is not:
- a claim comparator (are these two strings different?)
- a story summariser
- a creative writer
- a scanner that searches for problems on its own

The Guardian is:
- an investigator that receives a bounded evidence package
- a judge that reasons over that package and returns a verdict

The ClickHouse layer finds candidates. The Guardian adjudicates them.

---

## Design evolution

### Option A — Pairwise claim comparison (original spec)

The first design, as written in the original `tasks.md`, described the Guardian as
receiving two claims and a list of events between them:

```
buildReasoningPrompt(claimA, claimB, events[], scope, temporalRelation?)
```

Gemini would then reason: "Does any event explain how value A became value B?"

**Why this was considered:**

It is the most obvious decomposition. The within-unit detection query already
produces pairs. Events are already indexed by story unit and scene. The whole
thing fits in one function call.

**Why it was rejected:**

Looking at the actual extracted data from Film A:

- Scene 2 extracts `Dr. Hartley.knowledge_of_cipher_device = "none"` (explicit, 1.0)
- Scene 5 extracts `Hartley.knowledge_of_cipher_location = "ignorant"` (explicit, 1.0)
- The screenplay's scene 7 has Hartley deducing two locks from the encoded fragment

The mechanism of Hartley's knowledge change is **mathematical deduction from the
fragment**, not an information-transfer event. No event record says "Hartley receives
knowledge." The relevant context is that Clara gave Hartley an encoded page fragment
(scene 2 event), and Hartley independently derived a structural property from it.
That causal chain lives in the claim history and event history of multiple entities,
not in a pair of claims about a single property.

A Guardian receiving only `knowledge = ignorant` → `knowledge = deduced`, plus the
events between those scenes, cannot reason about this correctly. It lacks the
context about why Hartley had the fragment and what he was doing with it.

The same problem applies to the Cipher Device location. If the Guardian sees only:

```
Scene 5: Cipher Device.location = Meinhardt's safe
Scene 9: Cipher Device.location = Clara's satchel
```

It needs to know whether a transfer event exists, but it also needs to understand
that Meinhardt explicitly told Clara the device stays in the safe (scene 6), which
makes the unexplained transfer a more serious violation, not a benign omission.
That context lives in claims and events across the same entity — not in a pair.

**The deeper problem:** Continuity isn't a property of two claims. It's a property
of a state trajectory. The pair is where a problem is *detected*, not where it
should be *reasoned about*. Collapsing the reasoning to the detection unit loses
most of the available evidence.

Additional failure modes:

- **Repeated tokens:** If ten claims concern the same object, the same events get
  reconstructed in multiple calls, once per pair.
- **No trajectory view:** An object that moves A → B → C → A across 12 scenes is
  hard to reason about if you only ever see one transition at a time.
- **Some contradictions are not pairwise obvious:** A character who possesses an
  object in scene 2, transfers it in scene 5, and uses it again in scene 9 may not
  show up as a pair at all if intermediate `valid_to_scene` updates were applied —
  but the overall trajectory is still problematic.

---

### Option B — Full story input

The other extreme considered: send the Guardian the entire screenplay (or all 89+
claims from the full extraction) and ask it to find problems.

**Why it was considered:**

Simplest to implement. No context assembly step. The Guardian has all the information
and can reason freely.

**Why it was rejected:**

1. A full feature film extracts 500+ claims. That is expensive and noisy.
2. The structured extraction *is* the compression. The Story Analyst's job was to
   convert natural language into a tractable structured form. Bypassing that by
   feeding raw text to the Guardian undoes that work entirely.
3. ClickHouse is the memory substrate. Its job is candidate discovery and context
   retrieval. A Guardian that ignores it is not using the architecture.
4. Gemini should not be doing database-scale search. It should be doing reasoning
   over a curated evidence package.
5. The demo with 14 scenes is not the product. A real universe with 10 films and
   200 episodes cannot fit in a single prompt.

---

### Option C — State history dossier per entity+property candidate (adopted)

**What was adopted:**

The Guardian receives a **dossier** — a bounded, structured evidence package built
around a specific suspicious transition. The dossier is constructed by application
code after the detection query returns candidates. The Guardian reasons over the
dossier and returns a verdict.

The dossier contains:

1. **Candidate transition** — the two conflicting claims that triggered investigation.
   Their entity, property, values, scenes, confidence, source lines.
2. **Full property history** — all claims for the same entity+property pair, in
   chronological order. This gives the Guardian the trajectory, not just the pair.
3. **All entity claims within the relevant scene window** — all properties for the
   focus entity between the candidate scenes (inclusive). This enables cross-property
   reasoning: if `Cipher Device.key_count` changed in the same scene range, that
   context appears without requiring the code to know it's relevant.
4. **Events involving the entity** — all events where the entity appears as subject
   or object, between the candidate scenes. These are the causal/explanatory layer.
5. **Story unit and canon metadata** — title, period, canon tier, temporal relation
   (for cross-unit dossiers).

**Why this works:**

- The context window is per-entity-per-property-candidate, not per-scene and not
  per-movie. For a typical film, a single candidate dossier contains ~10–20 claims
  and ~5–10 events. That is small, precise, and cheap.
- Gemini sees the trajectory, not the pair. It can reason about whether the overall
  evolution of a state is coherent, not just whether two strings differ.
- The code that builds the dossier is deterministic. The reasoning over the dossier
  is probabilistic. These are correctly separated.
- Cross-property reasoning is available without a relevance-scoring algorithm:
  including all claims for the entity within the scene window gives Gemini the
  signal it needs, at the cost of a few extra rows rather than a complex classifier.

**The entity resolution caveat:**

The dossier is only as good as the entity resolution performed by the Story Analyst
during ingestion. If "Clara Voss" (scene 1) and "Clara" (scenes 2–5) were written
as separate universe entities, the dossier for `Clara Voss` will be incomplete.
The Story Analyst's fuzzy name matching (exact → case-insensitive → Levenshtein ≤ 2)
is the mechanism that prevents this. The Guardian has no way to detect or recover
from poor entity resolution.

---

## The Guardian's mental model (as expressed in the system prompt)

The original system prompt said: "Here are two claims. Does any event explain the
change?" This frames the Guardian as a claim-pair classifier.

The adopted system prompt frames the Guardian as a story-continuity investigator:

> "You are examining whether the story's established state transitions remain
> internally coherent. You are not asking whether two strings are different. You
> are asking whether the chronological evidence provides a coherent explanation
> for how the earlier state became the later state."

The decision procedure:

1. Establish the states (what was true before, what is claimed after)
2. Establish chronology (which state comes first)
3. Search for explanation in recorded events
4. Check related evidence across properties
5. Test whether both states can coherently coexist in sequence
6. Assess evidence quality (confidence)
7. Classify: `normal_transition`, `confirmed`, or `ambiguous`
8. Assess severity (for confirmed/ambiguous only)
9. Recommend a concrete resolution (for confirmed/ambiguous only)

The `ambiguous` category is treated as a first-class outcome, not a fallback.
Absence of an event does not prove contradiction — extraction is incomplete by
nature. When evidence is insufficient, `ambiguous` is the correct verdict.

---

## Verdict rules

These are unchanged from the original spec and are enforced in `reasoner.ts`,
not in the prompt.

### Confidence downgrade

If `conflictType = "confirmed"` and either candidate claim has `confidence ≤ 0.70`,
the result is downgraded to `"ambiguous"` before the finding is written.

Rationale: low-confidence evidence must not produce a confirmed finding. The
downgrade is applied in code, not by Gemini, so it is deterministic.

### Write rules

| Verdict | `update_claim_valid_to` | `write_finding` |
|---|---|---|
| `normal_transition` | yes — earlier claim gets `valid_to_scene = sceneB` | no |
| `confirmed` | yes | yes |
| `ambiguous` | yes | yes |

The Guardian never creates claims, deletes claims, or modifies any field other
than `valid_to_scene` and `superseded_by_canon`.

### Severity definitions

- **high** — physical impossibility: object in two places simultaneously, dead
  character acts, entity violates an established rule.
- **medium** — unexplained change: object moves without carrying event, character
  acquires knowledge without information-exchange event.
- **low** — minor inconsistency explainable by offscreen action: prop position,
  minor descriptive mismatch.

---

## Pipeline position

```
Story Analyst ingestion (sequential, scene by scene)
        ↓
  ClickHouse: claims + events written
        ↓
  findWithinUnitConflicts() ← deterministic SQL
        ↓
  For each candidate pair:
    buildEntityDossier()    ← deterministic, application code
        ↓
    Guardian reasoner       ← Gemini, probabilistic
        ↓
    writeFinding() / updateClaimValidTo()
        ↓
  within-unit pass complete
        ↓
  findCrossUnitConflicts()  ← deterministic SQL  [Task 11]
        ↓
  canon tier check          ← deterministic      [Task 11]
        ↓
  temporal resolution       ← Gemini or cached   [Task 11]
        ↓
  Guardian reasoner (cross-unit dossier)          [Task 11]
```

---

## What was deferred

### Guardian parallelism

The architecture diagram proposed concurrent Guardian invocations — one per
entity+property candidate — rather than sequential processing.

**Why it was deferred:**

For the demo with 14 scenes and a handful of candidates, sequential processing
is fast enough and considerably easier to debug. The parallel design requires
error isolation per-candidate (one Guardian failure should not halt others),
result collection, and potential deduplication if two candidates share a claim.
None of these are complex problems, but they add surface area that is not needed
for the hackathon target.

**What is needed to implement it:**

Use `Promise.allSettled()` over the candidate array rather than sequential `await`.
Each candidate's errors must be caught individually and logged. The merge step
must handle the case where two candidates produced findings that reference the
same claim pair (deduplicate by `claim_a_id + claim_b_id`).

See **GAP-004** in `backend/ARCHITECTURAL_GAPS.md`.

### Cross-property relevance scoring

The adopted dossier includes all claims for the focus entity within the candidate
scene window, regardless of property. This is a deliberately coarse inclusion
policy — it provides cross-property context without requiring a classifier to
decide which properties are relevant.

**Why it was deferred:**

The coarse policy works for the demo. For a large universe with entities that have
hundreds of properties spanning multiple films, including all claims for the entity
in a large scene window could make the dossier unwieldy. A relevance scorer would
reduce noise, but defining "relevant" without ground truth is a hard problem.

**What is needed to implement it:**

Either a heuristic (include properties whose values changed in the same scene
range as the candidate), or a semantic similarity step (embed all property names
and include those closest to the candidate property). Neither is worth building
before there is evidence that the coarse policy is causing problems.

See **GAP-005** in `backend/ARCHITECTURAL_GAPS.md`.

### Finding merger / synthesis layer

For within-unit, no deduplication is needed — each dossier is per entity+property,
and the same claim pair will not appear in two dossiers. For cross-unit with large
universes, two different property conflicts on the same entity pair might eventually
warrant a synthesis layer that groups related findings. This was not designed.

See **GAP-006** in `backend/ARCHITECTURAL_GAPS.md`.

### Event enrichment for cross-unit dossiers

For within-unit, the relevant events are straightforwardly
`getEventsBetweenScenes(storyUnitId, sceneA, sceneB)`. For cross-unit, the
"events between the claims" spans two different story units, potentially separated
by decades of in-universe time. What "between" means across units is not defined.

The decision deferred to Task 11 planning: for cross-unit dossiers, include events
from unitA from sceneA to the end of unitA, plus events from unitB from the start
of unitB to sceneB. This covers the relevant narrative windows for each unit
without trying to establish a literal inter-unit event timeline.

---

## Files

```
backend/src/agents/continuity-guardian/
├── prompt.ts        — buildDossierPrompt(dossier, scope): string
├── reasoner.ts      — reasonAboutDossier(dossier, scope): GuardianVerdict
├── dossier.ts       — buildEntityDossier(candidate, storyUnitId): EntityDossier
├── within-unit.ts   — runWithinUnitPass(storyUnitId): GuardianSummary
├── cross-unit.ts    — runCrossUnitPass(universeId): GuardianSummary   [Task 11]
├── temporal.ts      — resolveTemporalOrder(unitAId, unitBId): TemporalRelationType  [Task 11]
└── agent.ts         — analyzeUnit() / analyzeUniverse()
```

Note: `dossier.ts` is a new file not in the original spec. The original spec had
no dossier assembly step — prompt and reasoner called MCP operations directly.
The dossier assembly is now its own module because:

1. It is deterministic application code, not agent reasoning — it belongs in its
   own file for testability.
2. It makes the boundary between "what ClickHouse provides" and "what Gemini sees"
   explicit and inspectable.
3. It can be tested without a Gemini call: build a dossier, assert its contents,
   separately test that the prompt renders it correctly.
