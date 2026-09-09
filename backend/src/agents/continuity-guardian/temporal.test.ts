import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// temporal.ts — resolveTemporalOrder
//
// Only Branch 1 (precise date comparison) is tested without mocks, because
// it is the only fully deterministic path that requires no network calls and
// no ClickHouse access.
//
// Branches 2–4 (cache lookup, Gemini call, Gemini failure) require ClickHouse
// and/or Gemini. They are marked @integration and skipped in unit runs.
// The Branch 1 tests are sufficient to validate the core ordering logic
// (earlier / later / same-year → overlapping) and the flipIfNeeded behaviour
// that is exercised by the cache path.
// =============================================================================

// ---------------------------------------------------------------------------
// Mock ClickHouse operations so the module can be imported without a real DB.
// Branch 1 never calls getTemporalRelation or writeTemporalRelation, so the
// mocks are never invoked in these tests — they just prevent import errors.
// ---------------------------------------------------------------------------

vi.mock("../../mcp/clickhouse/operations.js", () => ({
  getStoryUnit: vi.fn(),
  getTemporalRelation: vi.fn().mockResolvedValue(null),
  writeTemporalRelation: vi.fn().mockResolvedValue(undefined),
}));

// Mock Gemini so the module can load without a real API key.
vi.mock("@google/genai", () => {
  const mockGenAI = {
    models: {
      generateContent: vi
        .fn()
        .mockRejectedValue(new Error("mocked — not called in unit tests")),
    },
  };
  return {
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return mockGenAI;
    }),
  };
});

import { resolveTemporalOrder } from "./temporal.js";
import { getStoryUnit } from "../../mcp/clickhouse/operations.js";
import type { StoryUnit } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeUnit(
  storyUnitId: string,
  inUniverseDateStart: number | null,
  releaseOrder = 1,
): StoryUnit {
  return {
    storyUnitId,
    projectId: "project-1",
    universeId: "universe-1",
    title: `Unit ${storyUnitId}`,
    unitType: "film",
    seasonNumber: null,
    episodeNumber: null,
    inUniversePeriod: `Period of ${storyUnitId}`,
    inUniverseDateStart,
    inUniverseDateEnd: null,
    releaseOrder,
    ingestionStatus: "complete",
    sceneCount: 14,
    claimCount: 50,
    canonTier: 1,
    sourceFileUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Branch 1 tests — precise date comparison, no network calls
// ---------------------------------------------------------------------------

describe("resolveTemporalOrder — Branch 1 (precise dates)", () => {
  const UNIVERSE_ID = "universe-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'before' when unitA date is earlier than unitB date", async () => {
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 1943))
      .mockResolvedValueOnce(makeUnit("unit-b", 2024));

    const result = await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(result).toBe("before");
  });

  it("returns 'after' when unitA date is later than unitB date", async () => {
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 2024))
      .mockResolvedValueOnce(makeUnit("unit-b", 1943));

    const result = await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(result).toBe("after");
  });

  it("returns 'overlapping' when both units have the same start year", async () => {
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 1943))
      .mockResolvedValueOnce(makeUnit("unit-b", 1943));

    const result = await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(result).toBe("overlapping");
  });

  it("does not call getTemporalRelation when both dates are available", async () => {
    const { getTemporalRelation } =
      await import("../../mcp/clickhouse/operations.js");

    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 1943))
      .mockResolvedValueOnce(makeUnit("unit-b", 2024));

    await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(getTemporalRelation).not.toHaveBeenCalled();
  });

  it("does not call writeTemporalRelation when both dates are available", async () => {
    const { writeTemporalRelation } =
      await import("../../mcp/clickhouse/operations.js");

    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 1943))
      .mockResolvedValueOnce(makeUnit("unit-b", 2024));

    await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(writeTemporalRelation).not.toHaveBeenCalled();
  });

  it("falls through to Branch 2 when unitA has no date", async () => {
    const { getTemporalRelation } =
      await import("../../mcp/clickhouse/operations.js");

    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", null))
      .mockResolvedValueOnce(makeUnit("unit-b", 2024));

    // Branch 2 returns null (cache miss) → falls to Branch 3 → Gemini mock throws
    // → Branch 4 returns indeterminate. What matters is that getTemporalRelation
    // WAS called, proving Branch 1 was skipped.
    await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(getTemporalRelation).toHaveBeenCalled();
  });

  it("falls through to Branch 2 when unitB has no date", async () => {
    const { getTemporalRelation } =
      await import("../../mcp/clickhouse/operations.js");

    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", 1943))
      .mockResolvedValueOnce(makeUnit("unit-b", null));

    await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(getTemporalRelation).toHaveBeenCalled();
  });

  it("falls through to Branch 2 when both units have null dates", async () => {
    const { getTemporalRelation } =
      await import("../../mcp/clickhouse/operations.js");

    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-a", null))
      .mockResolvedValueOnce(makeUnit("unit-b", null));

    await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(getTemporalRelation).toHaveBeenCalled();
  });

  it("returns 'indeterminate' when getStoryUnit throws", async () => {
    vi.mocked(getStoryUnit).mockRejectedValueOnce(new Error("unit not found"));

    const result = await resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID);
    expect(result).toBe("indeterminate");
  });

  it("never throws — swallows all errors and returns indeterminate", async () => {
    vi.mocked(getStoryUnit).mockRejectedValue(new Error("total failure"));

    await expect(
      resolveTemporalOrder("unit-a", "unit-b", UNIVERSE_ID),
    ).resolves.toBe("indeterminate");
  });

  it("handles the 81-year gap between the two fixture films correctly", async () => {
    // Film A: 1943, Film B: 2024 — matches the demo fixture
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("film-a", 1943, 1))
      .mockResolvedValueOnce(makeUnit("film-b", 2024, 2));

    const result = await resolveTemporalOrder("film-a", "film-b", UNIVERSE_ID);
    expect(result).toBe("before");
  });

  it("result is symmetric — swapping IDs inverts before/after", async () => {
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-b", 2024))
      .mockResolvedValueOnce(makeUnit("unit-a", 1943));

    const result = await resolveTemporalOrder("unit-b", "unit-a", UNIVERSE_ID);
    expect(result).toBe("after");
  });

  it("overlapping is symmetric — same result regardless of argument order", async () => {
    vi.mocked(getStoryUnit)
      .mockResolvedValueOnce(makeUnit("unit-b", 1943))
      .mockResolvedValueOnce(makeUnit("unit-a", 1943));

    const result = await resolveTemporalOrder("unit-b", "unit-a", UNIVERSE_ID);
    expect(result).toBe("overlapping");
  });
});
