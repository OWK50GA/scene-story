import { describe, it, expect } from "vitest";
import { buildDossierPrompt, STATIC_SYSTEM_PROMPT } from "./prompt.js";
import type { EntityDossier, ResolvedEvent } from "./dossier.js";
import type { Claim, UniverseEntity, StoryUnit } from "../../types/index.js";

// =============================================================================
// Fixtures
// =============================================================================

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    claimId: "claim-a",
    universeEntityId: "entity-1",
    universeId: "universe-1",
    projectId: "project-1",
    storyUnitId: "unit-1",
    sourceSceneNumber: 5,
    property: "location",
    value: "Meinhardt's safe",
    inUniversePeriod: "World War II, 1943",
    inUniverseDateStart: 1943,
    inUniverseDateEnd: null,
    validFromScene: 5,
    validToScene: null,
    sourceType: "explicit",
    confidence: 1.0,
    confidenceRationale: "Directly stated in narration.",
    rawExtraction: "{}",
    sourceLine: "He locks the Cipher Device in his safe.",
    canonTier: 1,
    supersededByCanon: false,
    supersedingClaimId: null,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<UniverseEntity> = {}): UniverseEntity {
  return {
    entityId: "entity-1",
    universeId: "universe-1",
    canonicalName: "Cipher Device",
    entityType: "object",
    parentEntityId: null,
    description: "An encryption machine of German design.",
    firstAppearanceUnitId: "unit-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeStoryUnit(overrides: Partial<StoryUnit> = {}): StoryUnit {
  return {
    storyUnitId: "unit-1",
    projectId: "project-1",
    universeId: "universe-1",
    title: "The Voss Cipher",
    unitType: "film",
    seasonNumber: null,
    episodeNumber: null,
    inUniversePeriod: "World War II, 1943",
    inUniverseDateStart: 1943,
    inUniverseDateEnd: null,
    releaseOrder: 1,
    ingestionStatus: "complete",
    sceneCount: 14,
    claimCount: 89,
    canonTier: 1,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ResolvedEvent> = {}): ResolvedEvent {
  return {
    eventId: "event-1",
    storyUnitId: "unit-1",
    projectId: "project-1",
    universeId: "universe-1",
    sceneNumber: 7,
    action: "removes",
    description: "Meinhardt removes the Cipher Device from his safe.",
    inUniversePeriod: "World War II, 1943",
    subjectName: "Colonel Meinhardt",
    objectName: "Cipher Device",
    ...overrides,
  };
}

function makeDossier(overrides: Partial<EntityDossier> = {}): EntityDossier {
  const claimA = makeClaim({ claimId: "claim-a", validFromScene: 5, value: "Meinhardt's safe" });
  const claimB = makeClaim({ claimId: "claim-b", validFromScene: 9, value: "Clara's satchel" });

  return {
    focusEntity: makeEntity(),
    candidateProperty: "location",
    candidateTransition: { claimA, claimB },
    propertyHistory: [claimA, claimB],
    entityClaimsInWindow: [claimA, claimB],
    relevantEvents: [],
    storyUnit: makeStoryUnit(),
    ...overrides,
  };
}

// =============================================================================
// STATIC_SYSTEM_PROMPT
// =============================================================================

describe("STATIC_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof STATIC_SYSTEM_PROMPT).toBe("string");
    expect(STATIC_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it("contains the Guardian identity section", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("CONTINUITY GUARDIAN");
  });

  it("contains all 20 sections", () => {
    for (let i = 1; i <= 20; i++) {
      expect(STATIC_SYSTEM_PROMPT).toContain(`SECTION ${i}`);
    }
  });

  it("contains the three verdict types", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("normal_transition");
    expect(STATIC_SYSTEM_PROMPT).toContain("confirmed");
    expect(STATIC_SYSTEM_PROMPT).toContain("ambiguous");
  });

  it("contains the confidence threshold rule", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("0.70");
  });

  it("contains the output JSON schema", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("conflictType");
    expect(STATIC_SYSTEM_PROMPT).toContain("resolutionSuggestion");
    expect(STATIC_SYSTEM_PROMPT).toContain("severity");
    expect(STATIC_SYSTEM_PROMPT).toContain("explanation");
  });

  it("contains the decision procedure steps", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("SECTION 18");
    expect(STATIC_SYSTEM_PROMPT).toContain("Establish the states");
  });

  it("contains the absence-is-not-contradiction rule", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("SECTION 15");
    expect(STATIC_SYSTEM_PROMPT).toContain("does NOT mean");
  });
});

// =============================================================================
// buildDossierPrompt — pure function, no I/O
// =============================================================================

describe("buildDossierPrompt", () => {
  it("returns a non-empty string", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(200);
  });

  it("includes the focus entity name", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("Cipher Device");
  });

  it("includes the entity type", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("object");
  });

  it("includes the candidate property", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("location");
  });

  it("includes the story unit title", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("The Voss Cipher");
  });

  it("includes the in-universe period", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("World War II, 1943");
  });

  it("includes the canon tier", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("1");
  });

  it("includes the INVESTIGATION header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("INVESTIGATION");
  });

  it("includes the CANDIDATE TRANSITION section", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("CANDIDATE TRANSITION");
  });

  it("includes Claim A label", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("Claim A (earlier)");
  });

  it("includes Claim B label", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("Claim B (later)");
  });

  it("includes claimA scene number", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("5");
  });

  it("includes claimB scene number", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("9");
  });

  it("includes claimA value", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("Meinhardt's safe");
  });

  it("includes claimB value", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("Clara's satchel");
  });

  it("includes claimA source line", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("He locks the Cipher Device in his safe.");
  });

  it("includes claimA source type", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("explicit");
  });

  it("includes confidence formatted to two decimal places", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("1.00");
  });

  it("includes the FULL PROPERTY HISTORY section header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("FULL PROPERTY HISTORY");
  });

  it("includes property name in the history header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("FULL PROPERTY HISTORY — location");
  });

  it("shows '(no history records found)' when propertyHistory is empty", () => {
    const result = buildDossierPrompt(makeDossier({ propertyHistory: [] }));
    expect(result).toContain("(no history records found)");
  });

  it("includes ALL ENTITY CLAIMS IN WINDOW section header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("ALL ENTITY CLAIMS IN WINDOW");
  });

  it("includes the window scene range in the claims section header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("scenes 5–9");
  });

  it("shows '(no claims in this window)' when entityClaimsInWindow is empty", () => {
    const result = buildDossierPrompt(
      makeDossier({ entityClaimsInWindow: [] }),
    );
    expect(result).toContain("(no claims in this window)");
  });

  it("groups entity window claims by property name", () => {
    const dossier = makeDossier({
      entityClaimsInWindow: [
        makeClaim({ property: "location", value: "safe", validFromScene: 5 }),
        makeClaim({ property: "key_count", value: "one", validFromScene: 6 }),
      ],
    });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("[location]");
    expect(result).toContain("[key_count]");
  });

  it("includes the EVENTS section header", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain("EVENTS INVOLVING");
    expect(result).toContain("CIPHER DEVICE");
  });

  it("shows absence message when relevantEvents is empty", () => {
    const result = buildDossierPrompt(makeDossier({ relevantEvents: [] }));
    expect(result).toContain(
      "no events involving this entity found in this scene window",
    );
    expect(result).toContain(
      "absence of a recorded event does not prove no event occurred",
    );
  });

  it("renders event subject name when events are present", () => {
    const dossier = makeDossier({ relevantEvents: [makeEvent()] });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("Colonel Meinhardt");
  });

  it("renders event action when events are present", () => {
    const dossier = makeDossier({ relevantEvents: [makeEvent()] });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("removes");
  });

  it("renders event object name when events are present", () => {
    const dossier = makeDossier({ relevantEvents: [makeEvent()] });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("Cipher Device");
  });

  it("renders event description", () => {
    const dossier = makeDossier({ relevantEvents: [makeEvent()] });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain(
      "Meinhardt removes the Cipher Device from his safe.",
    );
  });

  it("renders event with null object correctly (no arrow)", () => {
    const event = makeEvent({ objectName: null });
    const dossier = makeDossier({ relevantEvents: [event] });
    const result = buildDossierPrompt(dossier);
    // Should not contain " → null" or an arrow with nothing after it
    expect(result).not.toContain("→ null");
    expect(result).not.toContain("→ undefined");
  });

  it("includes the temporal relation when provided", () => {
    const dossier = makeDossier({ temporalRelation: "before" });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("Temporal relation to other unit: before");
  });

  it("does not include temporal relation line when undefined", () => {
    const dossier = makeDossier({ temporalRelation: undefined });
    const result = buildDossierPrompt(dossier);
    expect(result).not.toContain("Temporal relation to other unit");
  });

  it("includes the closing investigation instruction", () => {
    const result = buildDossierPrompt(makeDossier());
    expect(result).toContain(
      "Investigate the candidate transition using the evidence above.",
    );
    expect(result).toContain("Return exactly one JSON object. No other text.");
  });

  it("marks a closed claim with its closing scene", () => {
    const claimA = makeClaim({
      claimId: "claim-a",
      validFromScene: 5,
      validToScene: 9,
      value: "Meinhardt's safe",
    });
    const claimB = makeClaim({
      claimId: "claim-b",
      validFromScene: 9,
      value: "Clara's satchel",
    });
    const dossier = makeDossier({
      propertyHistory: [claimA, claimB],
    });
    const result = buildDossierPrompt(dossier);
    expect(result).toContain("[closed at scene 9]");
  });

  it("is deterministic — same inputs produce identical output", () => {
    const dossier = makeDossier();
    expect(buildDossierPrompt(dossier)).toBe(buildDossierPrompt(dossier));
  });

  it("different entity names produce different outputs", () => {
    const dossierA = makeDossier({
      focusEntity: makeEntity({ canonicalName: "Cipher Device" }),
    });
    const dossierB = makeDossier({
      focusEntity: makeEntity({ canonicalName: "Red Ledger" }),
    });
    expect(buildDossierPrompt(dossierA)).not.toBe(buildDossierPrompt(dossierB));
  });

  it("different temporal relations produce different outputs", () => {
    const dossierBefore = makeDossier({ temporalRelation: "before" });
    const dossierAfter = makeDossier({ temporalRelation: "after" });
    expect(buildDossierPrompt(dossierBefore)).not.toBe(
      buildDossierPrompt(dossierAfter),
    );
  });

  it("includes all three within-unit temporal relation values when tested", () => {
    for (const rel of ["before", "after", "overlapping"] as const) {
      const result = buildDossierPrompt(makeDossier({ temporalRelation: rel }));
      expect(result).toContain(rel);
    }
  });
});
