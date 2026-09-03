import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "./prompt.js";
import type { Scene, StoryUnit } from "../../types/index.js";

// =============================================================================
// buildExtractionPrompt — pure function, no I/O
// =============================================================================

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeUnit(overrides: Partial<StoryUnit> = {}): StoryUnit {
  return {
    storyUnitId: "unit-1",
    projectId: "project-1",
    universeId: "universe-1",
    title: "The Voss Cipher",
    unitType: "film",
    seasonNumber: null,
    episodeNumber: null,
    inUniversePeriod: "1943",
    inUniverseDateStart: 1943,
    inUniverseDateEnd: null,
    releaseOrder: 1,
    ingestionStatus: "pending",
    sceneCount: 14,
    claimCount: 0,
    ...overrides,
  };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    sceneId: "scene-7",
    storyUnitId: "unit-1",
    projectId: "project-1",
    universeId: "universe-1",
    sceneNumber: 7,
    heading: "INT. ARCHIVE ROOM - NIGHT",
    rawText: "Clara opens the safe and removes the Cipher Device.",
    summary: "",
    ingestionStatus: "pending",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExtractionPrompt", () => {
  it("returns a non-empty string", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(100);
  });

  it("includes the scene number in the output", () => {
    const result = buildExtractionPrompt({
      scene: makeScene({ sceneNumber: 7 }),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("7");
  });

  it("includes the scene heading in the output", () => {
    const result = buildExtractionPrompt({
      scene: makeScene({ heading: "INT. ARCHIVE ROOM - NIGHT" }),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("INT. ARCHIVE ROOM - NIGHT");
  });

  it("includes the story unit title in the output", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit({ title: "The Voss Cipher" }),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("The Voss Cipher");
  });

  it("includes the in-universe period in the output", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit({ inUniversePeriod: "1943" }),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("1943");
  });

  it("includes the scene raw text in the scene block", () => {
    const rawText = "Clara opens the safe and removes the Cipher Device.";
    const result = buildExtractionPrompt({
      scene: makeScene({ rawText }),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain(rawText);
  });

  it("uses first-scene fallback when contextSummary is empty", () => {
    const result = buildExtractionPrompt({
      scene: makeScene({ sceneNumber: 1 }),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    // The known-state block should say no entities recorded yet
    expect(result).toContain("No entities have been recorded yet");
    expect(result).toContain("first scene");
  });

  it("does NOT use the first-scene fallback when contextSummary is provided", () => {
    const summary = "- Clara Voss: location = \"Archive Room\" (established scene 3, confidence 1.00)";
    const result = buildExtractionPrompt({
      scene: makeScene({ sceneNumber: 7 }),
      unit: makeUnit(),
      contextSummary: summary,
      sceneTotal: 14,
    });
    expect(result).not.toContain("No entities have been recorded yet");
    expect(result).toContain(summary);
  });

  it("includes the total scene count", () => {
    const result = buildExtractionPrompt({
      scene: makeScene({ sceneNumber: 7 }),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("14");
  });

  it("includes inUniverseDateStart when provided", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit({ inUniverseDateStart: 1943 }),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("1943");
  });

  it("shows 'not specified' when inUniverseDateStart is null", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit({ inUniverseDateStart: null }),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("not specified");
  });

  it("ends with the JSON-only instruction", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result.trimEnd()).toContain("Return JSON only.");
  });

  it("includes the END OF CURRENT SCENE boundary marker", () => {
    const result = buildExtractionPrompt({
      scene: makeScene(),
      unit: makeUnit(),
      contextSummary: "",
      sceneTotal: 14,
    });
    expect(result).toContain("END OF CURRENT SCENE");
  });

  it("is deterministic — same inputs produce identical output", () => {
    const input = {
      scene: makeScene(),
      unit: makeUnit(),
      contextSummary: "some context",
      sceneTotal: 14,
    };
    expect(buildExtractionPrompt(input)).toBe(buildExtractionPrompt(input));
  });
});
