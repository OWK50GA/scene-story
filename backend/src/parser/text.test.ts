import { describe, it, expect } from "vitest";
import {
  parseScreenplayText,
  parseScreenplayTextOrThrow,
  ParseError,
} from "./text.js";

// =============================================================================
// parseScreenplayText — pure function, no I/O
// =============================================================================

describe("parseScreenplayText", () => {
  // ---------------------------------------------------------------------------
  // Edge cases: empty / no headings
  // ---------------------------------------------------------------------------

  it("returns empty scenes and empty preamble for empty string", () => {
    const result = parseScreenplayText("");
    expect(result.scenes).toHaveLength(0);
    expect(result.preamble).toBe("");
  });

  it("returns empty scenes and empty preamble for whitespace-only input", () => {
    const result = parseScreenplayText("   \n\n  ");
    expect(result.scenes).toHaveLength(0);
    expect(result.preamble).toBe("");
  });

  it("returns zero scenes and full text as preamble when no headings are present", () => {
    const input = "FADE IN:\n\nSome narrative text without a heading.\n\nMore text.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(0);
    // FADE IN: is a transition — it gets stripped from the preamble only
    // when it's inside a scene body. The preamble is the raw accumulated lines.
    expect(result.preamble).toContain("Some narrative text without a heading.");
  });

  // ---------------------------------------------------------------------------
  // Heading variant matching — all four variants (INT./EXT./INT.\/EXT./EXT.\/INT.)
  // ---------------------------------------------------------------------------

  it("recognises INT. heading", () => {
    const input = "INT. OFFICE - DAY\n\nA cluttered desk.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.heading).toBe("INT. OFFICE - DAY");
  });

  it("recognises EXT. heading", () => {
    const input = "EXT. STREET - NIGHT\n\nRain falls on cobblestones.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.heading).toBe("EXT. STREET - NIGHT");
  });

  it("recognises INT./EXT. heading", () => {
    const input = "INT./EXT. MOVING CAR - DAY\n\nThe car moves through traffic.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.heading).toBe("INT./EXT. MOVING CAR - DAY");
  });

  it("recognises EXT./INT. heading", () => {
    const input = "EXT./INT. TRAIN STATION - EVENING\n\nPassengers board.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.heading).toBe("EXT./INT. TRAIN STATION - EVENING");
  });

  it("is case-insensitive for headings", () => {
    const input = "int. basement - night\n\nDark and damp.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.heading).toBe("int. basement - night");
  });

  // ---------------------------------------------------------------------------
  // Sequential scene numbering
  // ---------------------------------------------------------------------------

  it("numbers scenes sequentially starting at 1", () => {
    const input = [
      "INT. OFFICE - DAY",
      "Alice works.",
      "",
      "EXT. STREET - NIGHT",
      "Bob walks.",
      "",
      "INT./EXT. MOVING CAR - DAY",
      "Carol drives.",
    ].join("\n");

    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]!.sceneNumber).toBe(1);
    expect(result.scenes[1]!.sceneNumber).toBe(2);
    expect(result.scenes[2]!.sceneNumber).toBe(3);
  });

  it("assigns correct headings to each numbered scene", () => {
    const input = [
      "INT. VAULT - NIGHT",
      "Dark.",
      "",
      "EXT. ROOFTOP - DAWN",
      "Bright.",
    ].join("\n");

    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.heading).toBe("INT. VAULT - NIGHT");
    expect(result.scenes[1]!.heading).toBe("EXT. ROOFTOP - DAWN");
  });

  // ---------------------------------------------------------------------------
  // Preamble capture
  // ---------------------------------------------------------------------------

  it("captures lines before the first heading as preamble", () => {
    const input = [
      "THE VOSS CIPHER",
      "Written by Anonymous",
      "1943",
      "",
      "INT. ARCHIVE ROOM - DAY",
      "Dusty shelves.",
    ].join("\n");

    const result = parseScreenplayText(input);
    expect(result.preamble).toContain("THE VOSS CIPHER");
    expect(result.preamble).toContain("Written by Anonymous");
    expect(result.preamble).toContain("1943");
    expect(result.scenes).toHaveLength(1);
  });

  it("returns empty preamble when first line is a heading", () => {
    const input = "INT. OFFICE - DAY\n\nJohn sits.";
    const result = parseScreenplayText(input);
    expect(result.preamble).toBe("");
    expect(result.scenes).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Transition stripping — all 8 variants
  // ---------------------------------------------------------------------------

  it("strips CUT TO: from scene body", () => {
    const input = "INT. OFFICE - DAY\n\nJohn sits.\n\nCUT TO:\n\nEXT. STREET - NIGHT\n\nRain.";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("CUT TO:");
    expect(result.scenes[1]!.rawText).not.toContain("CUT TO:");
  });

  it("strips DISSOLVE TO: from scene body", () => {
    const input = "INT. LAB - DAY\n\nExperiment runs.\n\nDISSOLVE TO:";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("DISSOLVE TO:");
  });

  it("strips SMASH CUT TO: from scene body", () => {
    const input = "INT. ROOM - NIGHT\n\nExplosion.\n\nSMASH CUT TO:";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("SMASH CUT TO:");
  });

  it("strips MATCH CUT TO: from scene body", () => {
    const input = "EXT. FIELD - DAY\n\nA hand reaches up.\n\nMATCH CUT TO:";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("MATCH CUT TO:");
  });

  it("strips FADE TO: from scene body", () => {
    const input = "INT. DINING ROOM - EVENING\n\nSupper is served.\n\nFADE TO:";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("FADE TO:");
  });

  it("strips FADE TO BLACK. from scene body", () => {
    const input = "INT. CELL - NIGHT\n\nDarkness closes in.\n\nFADE TO BLACK.";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("FADE TO BLACK.");
  });

  it("strips FADE OUT. from scene body", () => {
    const input = "EXT. HARBOUR - DAWN\n\nThe boat leaves.\n\nFADE OUT.";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("FADE OUT.");
  });

  it("strips FADE IN: from scene body", () => {
    const input = "INT. APARTMENT - MORNING\n\nFADE IN:\n\nSunlight streams in.";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).not.toContain("FADE IN:");
    expect(result.scenes[0]!.rawText).toContain("Sunlight streams in.");
  });

  it("preserves non-transition content while stripping all 8 transition variants", () => {
    const transitions = [
      "CUT TO:",
      "DISSOLVE TO:",
      "SMASH CUT TO:",
      "MATCH CUT TO:",
      "FADE TO:",
      "FADE TO BLACK.",
      "FADE OUT.",
      "FADE IN:",
    ];

    const body = transitions.join("\n");
    const input = `INT. OFFICE - DAY\n\nReal content here.\n\n${body}`;
    const result = parseScreenplayText(input);

    const rawText = result.scenes[0]!.rawText;
    expect(rawText).toContain("Real content here.");
    for (const t of transitions) {
      expect(rawText).not.toContain(t);
    }
  });

  // ---------------------------------------------------------------------------
  // Body content preservation
  // ---------------------------------------------------------------------------

  it("preserves internal blank lines (beat breaks) within a scene", () => {
    const input = [
      "INT. OFFICE - DAY",
      "",
      "John enters.",
      "",
      "He sits at his desk.",
      "",
      "He opens a file.",
    ].join("\n");

    const result = parseScreenplayText(input);
    const rawText = result.scenes[0]!.rawText;
    // Internal blank lines should be preserved
    expect(rawText).toContain("John enters.");
    expect(rawText).toContain("He sits at his desk.");
    expect(rawText).toContain("He opens a file.");
    // The blank lines between them should still be there
    expect(rawText).toMatch(/John enters\.\n\nHe sits/);
  });

  it("trims leading and trailing blank lines from scene body", () => {
    const input = "INT. OFFICE - DAY\n\n\n\nJohn sits.\n\n\n";
    const result = parseScreenplayText(input);
    expect(result.scenes[0]!.rawText).toBe("John sits.");
  });

  it("produces empty rawText for a heading with no body", () => {
    const input = "INT. OFFICE - DAY\n\nEXT. STREET - NIGHT\n\nRain.";
    const result = parseScreenplayText(input);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.rawText).toBe("");
    expect(result.scenes[1]!.rawText).toBe("Rain.");
  });
});

// =============================================================================
// parseScreenplayTextOrThrow
// =============================================================================

describe("parseScreenplayTextOrThrow", () => {
  it("throws ParseError when input has no headings", () => {
    expect(() => parseScreenplayTextOrThrow("No headings here.")).toThrow(ParseError);
  });

  it("throws ParseError for empty input", () => {
    expect(() => parseScreenplayTextOrThrow("")).toThrow(ParseError);
  });

  it("returns normally when at least one heading is found", () => {
    const input = "INT. OFFICE - DAY\n\nJohn sits.";
    expect(() => parseScreenplayTextOrThrow(input)).not.toThrow();
    const result = parseScreenplayTextOrThrow(input);
    expect(result.scenes).toHaveLength(1);
  });

  it("ParseError has name 'ParseError'", () => {
    try {
      parseScreenplayTextOrThrow("no headings");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).name).toBe("ParseError");
    }
  });
});
