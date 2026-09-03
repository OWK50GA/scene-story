import { describe, it, expect } from "vitest";
import { SceneExtractionSchema, CONFIDENCE_RANGES } from "./index.js";

// =============================================================================
// CONFIDENCE_RANGES constants
// =============================================================================

describe("CONFIDENCE_RANGES", () => {
  it("explicit range is 0.9–1.0", () => {
    expect(CONFIDENCE_RANGES.explicit.min).toBe(0.9);
    expect(CONFIDENCE_RANGES.explicit.max).toBe(1.0);
  });

  it("implied range is 0.75–0.89", () => {
    expect(CONFIDENCE_RANGES.implied.min).toBe(0.75);
    expect(CONFIDENCE_RANGES.implied.max).toBe(0.89);
  });

  it("inferred range is 0.0–0.6", () => {
    expect(CONFIDENCE_RANGES.inferred.min).toBe(0.0);
    expect(CONFIDENCE_RANGES.inferred.max).toBe(0.6);
  });

  it("explicit max is the ceiling (1.0)", () => {
    expect(CONFIDENCE_RANGES.explicit.max).toBeLessThanOrEqual(1.0);
  });

  it("there is a forbidden gap between inferred max and implied min", () => {
    // No valid confidence exists between 0.60 and 0.75
    expect(CONFIDENCE_RANGES.inferred.max).toBeLessThan(CONFIDENCE_RANGES.implied.min);
  });
});

// =============================================================================
// SceneExtractionSchema — Zod validation
// =============================================================================

// Minimal valid extraction that satisfies all required fields
const validExtraction = {
  entities: [
    {
      canonicalName: "Clara Voss",
      entityType: "character",
      description: "A field operative in 1943 Geneva.",
      parentEntityName: null,
    },
  ],
  claims: [
    {
      entityName: "Clara Voss",
      property: "location",
      value: "Archive Room",
      sourceType: "explicit",
      confidence: 0.95,
      confidenceRationale: "The stage direction places her in the Archive Room.",
      sourceLine: "Clara opens the safe.",
    },
  ],
  events: [
    {
      subject: "Clara Voss",
      action: "opens safe",
      object: "Safe",
      description: "Clara opens the safe and retrieves the Cipher Device.",
    },
  ],
};

describe("SceneExtractionSchema", () => {
  // ── Valid cases ────────────────────────────────────────────────────────────

  it("accepts a fully valid extraction", () => {
    const result = SceneExtractionSchema.safeParse(validExtraction);
    expect(result.success).toBe(true);
  });

  it("accepts empty entities, claims, and events arrays", () => {
    const result = SceneExtractionSchema.safeParse({
      entities: [],
      claims: [],
      events: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts explicit confidence of 0.91 (within 0.90–1.00)", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, sourceType: "explicit", confidence: 0.91 }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts implied confidence of 0.80 (within 0.75–0.89)", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, sourceType: "implied", confidence: 0.80 }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts inferred confidence of 0.50 (within 0.0–0.60)", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, sourceType: "inferred", confidence: 0.50 }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts null parentEntityName on an entity", () => {
    const input = {
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0]!, parentEntityName: null }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts a string parentEntityName on an entity", () => {
    const input = {
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0]!, parentEntityName: "Operative" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  it("accepts null object on an event", () => {
    const input = {
      ...validExtraction,
      events: [{ ...validExtraction.events[0]!, object: null }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(true);
  });

  // ── Invalid cases ──────────────────────────────────────────────────────────

  it("rejects a claim with missing sourceLine", () => {
    const badClaim = { ...validExtraction.claims[0] };
    // @ts-expect-error intentional deletion
    delete badClaim.sourceLine;
    const input = { ...validExtraction, claims: [badClaim] };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an entity with an unknown entityType", () => {
    const input = {
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0]!, entityType: "animal" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a claim with an unknown sourceType", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, sourceType: "speculative" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects confidence above 1.0", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, confidence: 1.1 }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects confidence below 0.0", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, confidence: -0.1 }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a claim with empty entityName", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, entityName: "" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an entity with empty canonicalName", () => {
    const input = {
      ...validExtraction,
      entities: [{ ...validExtraction.entities[0]!, canonicalName: "" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a claim with empty property", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, property: "" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a claim with empty value", () => {
    const input = {
      ...validExtraction,
      claims: [{ ...validExtraction.claims[0]!, value: "" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an event with empty subject", () => {
    const input = {
      ...validExtraction,
      events: [{ ...validExtraction.events[0]!, subject: "" }],
    };
    expect(SceneExtractionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects input missing the entities array", () => {
    const { entities: _entities, ...rest } = validExtraction;
    expect(SceneExtractionSchema.safeParse(rest).success).toBe(false);
  });
});
