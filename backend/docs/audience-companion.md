# Audience Companion — Design Reasoning

This document records the design thinking behind the Audience Companion component
of Bloodraven. It covers what the Companion is, what abilities it has, how those
abilities are served, what was decided and why, and what was deferred. It is a
living record, not a tutorial.

---

## What the Companion is for

Bloodraven's memory layer exists at two levels of use. The Guardian uses it to
detect problems in the story. The Companion uses it to answer questions about
the story — specifically, questions from a reader who is working through the
screenplay one scene at a time and wants to understand what they have read.

The Companion's promise:

> Ask anything about the story you've reached. Bloodraven knows what has been
> established, what has changed, and what hasn't been revealed yet.

The key distinction from a general LLM chatbot: the Companion is not answering
from parametric knowledge about stories or genres. It is answering from the
structured story memory that the Story Analyst extracted from this specific
screenplay. When it says "the Cipher Device is in Meinhardt's safe," it is
citing a specific claim extracted from a specific scene, not inferring from
context. That distinction is the product.

---

## The nine abilities

The Companion has nine explicit abilities. These are encoded in the system prompt.
They are product behaviour — they do not map one-to-one to code structures.

### 1. Entity/object explanation
"Who is Hartley?", "What is the Cipher Device?", "What do we know about the
Red Ledger?"

Answer from entity summaries and relevant claims. Cite source type (explicit,
implied, inferred). Only explain what has been established at or before the
current scene boundary.

### 2. Relationship explanation
"What is Clara's relationship with Hartley?", "How does Meinhardt know Clara?"

Answer from claims and events that establish relationships between entities.
The answer must distinguish between:
- **explicitly established** — a scene states the relationship directly
- **reasonably implied** — the evidence strongly suggests it but doesn't state it
- **not established** — the screenplay has not addressed this

The Companion must not invent motivations. "Clara trusts Hartley because she
respects his expertise" is an invention unless a scene establishes it. "Clara
trusts Hartley" + "Clara gives Hartley access to the fragment" are established
facts. The relationship between those facts is for the reader to draw.

### 3. Causal/story explanation
"Why did Clara come here?", "How did they get the device?", "What caused this?"

This is probably the most valuable ability and the most technically demanding.
The Companion must reconstruct an explanation from the chain of events and
facts, not simply find a sentence that matches the question.

For "How did Clara get the device?", the correct answer traces: Meinhardt kept
the device in his safe (scene 5), instructed nobody to move it (scene 6), and
then the device appeared in Clara's satchel without a recorded transfer event
(scene 9). The Companion should note the absence of a recorded transfer if one
is not in the data — that is itself informative.

This ability requires historical facts (the full claim chain) and events, not
just the current state. See the Historical mode section below.

### 4. Current-state questions
"Where is the Cipher Device?", "Who has the Red Ledger?", "What does Hartley know?"

Answer from the latest established claim per property per entity at the boundary.
Cite the scene number where the current state was established.

### 5. "What do we know so far"
"What do we know about the Cipher Device so far?"

Different from ability 1. This asks for an aggregate picture across all
established claims up to the boundary, not just a definition. The Companion
should present all known properties — location, key count, activation mechanism,
physical description — grouped coherently.

### 6. Catch-up
"Catch me up.", "Catch me up from scene 4 to scene 9."

The Companion summarises the important developments between two scene points,
in chronological order. It is not a full screenplay summary — it is the delta.
Which entities changed state? Which events moved the story forward? What should
the reader know to continue from scene N?

This ability requires summary mode (all events + high-confidence claims).

### 7. What should I remember
"What should I remember before continuing?"

Subtly different from catch-up. The Companion identifies the small set of story
facts that are most likely to matter going forward, based only on what has been
established. It is a forward-looking relevance filter on the established record.

In practice: claims with a recent `valid_from_scene` and entities that appear
in multiple events are likely load-bearing. The system prompt instructs Gemini
to identify these.

### 8. Clarification/ambiguity
"The screenplay hasn't established that yet."
"We know Hartley knows the location, but not how he learned it."

This ability is what distinguishes Bloodraven from a chatbot. A chatbot fills
gaps. Bloodraven knows where the gaps are and names them.

The Companion must be explicitly comfortable with partial answers. The three
epistemic states — known, partial, unknown — are not error conditions. They are
first-class response states. The system prompt dedicates a section to this.

### 9. Evidence
Every answer populates `factsUsed` with the IDs of the specific facts from the
pack that support each statement. The frontend can use these IDs to link back to
the source screenplay line (`sourceLine` field on each `PackFact`).

The `factsUsed ⊆ pack fact IDs` constraint is enforced deterministically in
`answerer.ts` after Gemini returns. Gemini cannot reference a fact outside the
pack. This is not a prompt instruction — it is a guard in code.

---

## The spoiler boundary

The spoiler boundary is the fundamental invariant. It is not an ability — all
nine abilities operate inside it.

For the unit-level endpoint (`POST /api/units/:id/ask`), the boundary is a
single integer: `up_to_scene`. The Companion knows scenes 1–N. Scenes N+1 onward
do not exist for it — the facts are not in its context, not suppressed by
instruction.

This is the defense-in-depth principle: the boundary is enforced at data
retrieval time, not at prompt time. A prompt that says "don't mention scene 10"
can be bypassed. A context pack that simply does not contain scene 10 data cannot.

The SQL-level enforcement in `getCompanionFacts` (existing) and
`getHistoricalClaimsForEntities` (new) both filter by `source_scene_number <=
upToScene`. Entity name leakage is prevented by also filtering on
`first_appearance_unit_id` — an entity whose first appearance is beyond the
boundary is excluded entirely.

---

## The mode/ability distinction

This was the central design question. The nine abilities are product behaviour —
what the Companion can do. The three context modes are retrieval strategy — what
data gets assembled into the pack. They are different concerns.

Early designs conflated them. The corrected model:

```
Nine abilities (what the Companion promises)
        │
Question classifier (which mode does this question need?)
        │
Pack builder in the correct mode (what data does Gemini need?)
        │
Gemini with system prompt encoding all nine abilities
        │
Spoiler-safe answer with factsUsed, epistemicState, notKnownAspects
```

The system prompt encodes all nine abilities regardless of mode. The mode
determines the data; the prompt determines the behaviour.

---

## Context modes

### Why three modes

A single context strategy cannot serve all nine abilities well.

- Current-state questions ("where is X?") are well-served by the latest claim
  per property — one row per entity+property, fast, minimal tokens.
- Causal questions ("how did X get there?") require the full claim chain. If you
  only give Gemini the latest state, it cannot reconstruct the path. You lose
  the history that explains causation.
- Summary/catch-up questions need all events and high-confidence claims, plus
  orientation through scene digests. Deduplication would remove the narrative
  progression.

Serving all nine abilities with a single deduplicated current-state context
would break abilities 3, 6, and 7 — the most compelling demo moments.

### Current-state mode (default)
Triggered by: anything not matching historical or summary triggers.

Context: deduplicated latest claim per entity+property (`isHistorical: false`
on all facts). Fast. Used for abilities 1, 4, 5.

### Historical mode
Triggered by: "how", "why", "what caused", "how did", "when did", "where did",
"what happened to"

Context: full claim chain including superseded claims (`isHistorical: true` on
superseded facts), plus events for resolved entities with one-hop expansion.

Entity resolution from the question text:
1. Lowercase the question
2. Match against `canonicalName` and `aliases` for each entity in the boundary
3. If no matches: fall back to all entities in the boundary

One-hop event expansion: for each event involving a matched entity, also include
the other entity in that event. "How did Clara get the device?" resolves Clara
and the Cipher Device. The events between them (including the missing transfer
event) are included. One hop is sufficient for v1 — a full graph traversal would
over-expand for the hackathon target.

### Summary mode
Triggered by: "catch me up", "what should i remember", "what do we know",
"so far", "everything about", "tell me about", "remind me"

Summary triggers are checked before historical triggers. They are more specific.

Context: all events within the boundary + all claims with `confidence >= 0.75`
+ scene digests. No deduplication. Used for abilities 6 and 7.

---

## Scene digests

Scene digests are the orientation layer of the context pack. They are not the
evidence — the fact table is the evidence. They help Gemini understand narrative
flow before reading the structured facts.

A scene digest is a deterministic 1–3 sentence description of a scene's
meaningful events and state changes, built from events and claim changes without
a Gemini call.

Format principle: events first (what happened), significant state changes second
(what changed as a result). Flexible rather than rigid template — a template like
`[Character] [action]` breaks for scenes where the important thing is an object
discovery or a revealed fact rather than a character action.

Good example:
> Scene 6: Clara places the Cipher Device in the safe. The device's location
> changes to the safe. Meinhardt orders everyone not to move it.

Bad example:
> Scene 6: Clara secretly protects the device because she no longer trusts
> Meinhardt.

The second example interprets rather than describes. The digest must not add
interpretation the data does not support.

---

## The epistemic state model

Three states, not a boolean:

- **known** — the answer is directly supported by explicit or implied claims
  within the boundary. `factsUsed` is non-empty. `notKnownAspects` is empty.
- **partial** — some aspects are established, others are not. The answer names
  both. `notKnownAspects` lists the gaps explicitly.
- **unknown** — the boundary contains nothing that answers this question.
  `factsUsed` is empty. The answer is: "The screenplay hasn't established that yet."

`epistemicState` is determined by Gemini from the facts provided. The backend
does not try to reproduce this determination — that is semantic reasoning. What
the backend enforces deterministically:

- `factsUsed ⊆ pack.facts.map(f => f.factId)` — in `guardFactsUsed()` in `answerer.ts`
- If any fact IDs are stripped by the guard, `epistemicState` is downgraded to `"partial"`
- The available facts, entity summaries, and scene digests are within the boundary

The Companion prompt dedicates explicit instructions to the partial state:

> "If you can answer some aspects of the question but not others, answer the
> aspects you can and explicitly name what remains unknown. Use the partial
> epistemic state. Do not round up to known or down to unknown."

---

## What was rejected

### Sending raw screenplay text to Gemini

Rejected. The Story Analyst's job is to convert natural language into a
tractable structured form. Bypassing that by feeding raw text to the Companion
undoes that work. The demo story is stronger if Bloodraven answers from structured
memory, not from re-reading the document.

### A single flat list of current-state facts

Rejected because it breaks causal and catch-up abilities. See mode discussion above.

### AI-driven entity resolution from question text

Rejected for v1. Deterministic alias matching is cheaper, predictable, and
easier to defend in the hackathon context. An LLM-based entity resolution step
would add latency and a failure mode with no clear benefit at this scale.

### Separate mini-agents per ability

Rejected. One Companion with one behavioral contract and one context builder is
simpler and easier to reason about. The mode classifier and pack builder handle
the variation; the Companion agent does not need to branch at the agent level.

### `notKnownAspects` determined by backend logic

Rejected. Determining whether Gemini's answer is partial is semantic reasoning —
the backend should not try to reproduce it. The backend enforces what it can
enforce: boundary, available facts, valid fact IDs, schema. Gemini determines
what was and was not answerable.

---

## What was deferred

### Alias management

In v1, entity aliases are parsed from the entity's `description` field or
defaulted to the canonical name only. A proper `aliases` column in
`universe_entities` with user-managed alias lists is the correct long-term design.
Alias management is deferred to post-hackathon.

### Multi-unit context packs

The `ask()` method on `AudienceCompanionAgent` accepts a multi-unit boundary list
(for the universe-level endpoint). In v1, it builds the pack from the first
boundary entry. A proper multi-unit pack would merge facts across all boundary
entries, resolve cross-unit entity identity, and order events by in-universe time.
This is deferred — the unit-level `askUnit()` method is the primary demo path.

### Suggested questions per scene

A compelling UI feature: deterministic question suggestions that change based on
the current scene and boundary. At early scenes: "Who is Hartley?", "What is the
Cipher Device?". At later scenes: "Why is Meinhardt looking for the device?".
These could be generated from the entity summaries and recent events without
Gemini. Deferred to frontend.

### Retrieval expansion beyond one hop

For deeply causal questions in large universes, one-hop event expansion may be
insufficient. A two-hop expansion or a proper entity graph traversal would
improve recall on complex causal chains. Deferred — one hop is sufficient for
the Voss Cipher demo.

---

## Files

```
backend/src/agents/audience-companion/
├── types.ts         — CompanionPack, PackFact, SceneDigest, EntitySummary,
│                      CompanionAnswer, RawGeminiAnswer (Zod), QuestionMode,
│                      EpistemicState
├── classifier.ts    — classifyQuestion(question): QuestionMode
├── pack-builder.ts  — buildPack() + mode builders + resolveEntitiesFromQuestion()
├── answerer.ts      — answerQuestion(), callGemini(), parseAndValidate(),
│                      guardFactsUsed()
├── prompt.ts        — SYSTEM_PROMPT (static) + buildUserTurn()
└── agent.ts         — companionAgent singleton; askUnit() + ask()
```

### Separation rationale

`types.ts` is separate because the Companion's internal types are not shared
with the rest of the backend. `CompanionPack`, `PackFact`, and `SceneDigest`
are Companion-private concerns.

`classifier.ts` is a pure function with no dependencies. It can be tested
in complete isolation and changed without touching the pack builder.

`pack-builder.ts` is deterministic application code, same as `dossier.ts` in
the Guardian. No Gemini calls. No side effects. Independently testable.

`answerer.ts` owns the Gemini boundary — all calls to Gemini and all response
parsing happen here and nowhere else in the Companion.

`prompt.ts` owns the static system prompt. Separating it from `answerer.ts`
means the prompt can be iterated without touching call logic, and vice versa.

`agent.ts` is the public facade. Route handlers and `orchestration.ts` call
`companionAgent` methods only — they never touch the internal files.

---

## Pipeline position

```
POST /api/units/:id/ask
        │
        ▼
  validate { question, up_to_scene } (Zod)
        │
        ▼
  classifier.classifyQuestion(question)
        → QuestionMode
        │
        ▼
  pack-builder.buildPack(storyUnitId, upToScene, question, mode)
        → CompanionPack
        │
   ┌────┴─────────────────────────────────┐
   │  Mode: current_state                 │
   │    getCompanionFacts()               │
   │    deduplicate to latest per prop    │
   │                                      │
   │  Mode: historical                    │
   │    resolveEntitiesFromQuestion()     │
   │    getHistoricalClaimsForEntities()  │
   │    getEventsForEntities()            │
   │    one-hop event expansion           │
   │                                      │
   │  Mode: summary                       │
   │    getCompanionFacts() (all)         │
   │    getEventsForEntities() (all)      │
   │    confidence filter >= 0.75         │
   │                                      │
   │  All modes:                          │
   │    buildEntitySummaries()            │
   │    buildSceneDigests()               │
   └────┬─────────────────────────────────┘
        │
        ▼
  answerer.answerQuestion(pack, question)
        │
   ┌────┴─────────────────────────────────┐
   │  buildUserTurn(pack, question)       │
   │  callGemini(SYSTEM_PROMPT, userTurn) │
   │  parseAndValidate(raw)               │
   │  guardFactsUsed(answer, pack)        │
   └────┬─────────────────────────────────┘
        │
        ▼
  agent.ts emits metrics + logs
        │
        ▼
  CompanionAnswer
  { answer, epistemicState, factsUsed,
    notKnownAspects, boundary, boundaryEnforced }
```
