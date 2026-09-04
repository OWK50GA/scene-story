import { describe, it, expect } from "vitest";
import { levenshtein, formatContextSummary } from "./agent.js";
import type { UniverseEntity } from "../../types/index.js";

// =============================================================================
// levenshtein — pure DP function
// =============================================================================

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("clara", "clara")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("returns length of b when a is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns length of a when b is empty", () => {
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 1 for a single-character substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("returns 1 for a single insertion", () => {
    expect(levenshtein("car", "cart")).toBe(1);
  });

  it("returns 1 for a single deletion", () => {
    expect(levenshtein("cart", "car")).toBe(1);
  });

  it("returns exactly 2 for two edits", () => {
    // "voss" → "boss" (substitute v→b) → "bos" (delete one s): 2 edits
    expect(levenshtein("voss", "bos")).toBe(2);
  });

  it("returns 3 (bail value) when distance exceeds 2", () => {
    // "abc" vs "xyz" — three substitutions
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  it("bails early (returns 3) when length difference alone exceeds 2", () => {
    // length diff = 4, short-circuits before any DP work
    expect(levenshtein("a", "abcde")).toBe(3);
  });

  it("is case-sensitive — callers must lowercase before calling", () => {
    // "Clara" vs "clara": C !== c, distance = 1
    expect(levenshtein("Clara", "clara")).toBe(1);
    // After caller-side lowercasing, distance is 0
    expect(levenshtein("clara", "clara")).toBe(0);
  });

  it("handles typical screenplay name variant within threshold ≤ 2", () => {
    // "Meinhardt" vs "Meinhard" — one deletion
    expect(levenshtein("meinhardt", "meinhard")).toBe(1);
  });

  it("treats transposition as two edits (standard DP, not Damerau)", () => {
    expect(levenshtein("ab", "ba")).toBe(2);
  });
});

// =============================================================================
// formatContextSummary — pure formatter, no I/O
// =============================================================================

function makeEntity(
  entityId: string,
  canonicalName: string,
  parentEntityId: string | null = null,
): UniverseEntity {
  return {
    entityId,
    universeId: "universe-1",
    canonicalName,
    entityType: "character",
    parentEntityId,
    description: "",
    firstAppearanceUnitId: null,
    createdAt: new Date(),
  };
}

describe("formatContextSummary", () => {
  it("returns empty string when stateRows is empty", () => {
    expect(formatContextSummary([], [])).toBe("");
  });

  it("formats a single direct claim correctly", () => {
    const entities = [makeEntity("e1", "Clara Voss")];
    const stateRows = [
      {
        entityName: "Clara Voss",
        universeEntityId: "e1",
        parentEntityId: null,
        property: "location",
        value: "Archive Room",
        sourceSceneNumber: 3,
        confidence: 1.0,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    expect(result).toContain(`- Clara Voss: location = "Archive Room"`);
    expect(result).toContain("established scene 3");
    expect(result).toContain("confidence 1.00");
  });

  it("formats an inherited claim with [inherited from ...] prefix", () => {
    const entities = [
      makeEntity("e1", "Signal Watch"),
      makeEntity("e2", "Clara Voss"),
    ];
    const stateRows = [
      {
        entityName: undefined,
        universeEntityId: "e1",
        parentEntityId: "e2", // non-null → inherited
        property: "condition",
        value: "operational",
        sourceSceneNumber: 2,
        confidence: 0.9,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    expect(result).toContain("[inherited from Clara Voss]");
    expect(result).toContain(`condition = "operational"`);
    expect(result).toContain("confidence 0.90");
  });

  it("groups direct and inherited claims under the same entity block", () => {
    const entities = [
      makeEntity("e1", "Cipher Device"),
      makeEntity("e2", "Safe"),
    ];
    const stateRows = [
      {
        entityName: "Cipher Device",
        universeEntityId: "e1",
        parentEntityId: null,
        property: "location",
        value: "inside the safe",
        sourceSceneNumber: 4,
        confidence: 1.0,
      },
      {
        entityName: undefined,
        universeEntityId: "e1",
        parentEntityId: "e2",
        property: "container",
        value: "iron safe",
        sourceSceneNumber: 1,
        confidence: 0.95,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    expect(result).toContain(`- Cipher Device: location = "inside the safe"`);
    expect(result).toContain("[inherited from Safe]");
  });

  it("falls back to entityId when name is absent from entity map and row has no entityName", () => {
    const stateRows = [
      {
        entityName: undefined,
        universeEntityId: "unknown-id-999",
        parentEntityId: null,
        property: "status",
        value: "active",
        sourceSceneNumber: 1,
        confidence: 0.8,
      },
    ];

    const result = formatContextSummary(stateRows, []);
    expect(result).toContain("unknown-id-999");
    expect(result).toContain(`status = "active"`);
  });

  it("prefers entityName from the row over the entity map value", () => {
    const entities = [makeEntity("e1", "CLARA VOSS")];
    const stateRows = [
      {
        entityName: "Clara Voss",
        universeEntityId: "e1",
        parentEntityId: null,
        property: "role",
        value: "operative",
        sourceSceneNumber: 1,
        confidence: 1.0,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    expect(result).toContain("Clara Voss:");
  });

  it("produces one line per claim across multiple entities", () => {
    const entities = [
      makeEntity("e1", "Clara Voss"),
      makeEntity("e2", "Red Ledger"),
    ];
    const stateRows = [
      {
        entityName: "Clara Voss",
        universeEntityId: "e1",
        parentEntityId: null,
        property: "location",
        value: "Archive Room",
        sourceSceneNumber: 2,
        confidence: 1.0,
      },
      {
        entityName: "Red Ledger",
        universeEntityId: "e2",
        parentEntityId: null,
        property: "possession",
        value: "Meinhardt",
        sourceSceneNumber: 3,
        confidence: 0.95,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Clara Voss");
    expect(lines[1]).toContain("Red Ledger");
  });

  it("formats confidence to exactly two decimal places", () => {
    const entities = [makeEntity("e1", "Vault")];
    const stateRows = [
      {
        entityName: "Vault",
        universeEntityId: "e1",
        parentEntityId: null,
        property: "status",
        value: "locked",
        sourceSceneNumber: 5,
        confidence: 0.9,
      },
    ];

    const result = formatContextSummary(stateRows, entities);
    expect(result).toContain("confidence 0.90");
  });
});
