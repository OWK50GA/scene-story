// =============================================================================
// Screenplay text parser
//
// Accepts a plain-text string in standard screenplay format and splits it into
// numbered scenes. This is a pure function — no I/O, no network calls, no DB.
//
// Expected input format (industry standard spec script):
//   - Scene headings start with INT., EXT., INT./EXT., or EXT./INT.
//   - Transition lines (CUT TO:, DISSOLVE TO:, etc.) are boilerplate and stripped
//   - Anything before the first heading is a preamble (title page, metadata)
//
// The parser makes no attempt to interpret the scene content — that is the
// Story Analyst agent's job. It only segments and cleans the raw text.
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single parsed scene from a screenplay.
 *
 * sceneNumber starts at 1. The preamble is never included in this list —
 * it is returned separately in ParseResult so callers can log it but
 * never accidentally pass it to the ingestion pipeline.
 *
 * heading is the full heading line exactly as it appeared in the source,
 * trimmed of leading/trailing whitespace.
 *
 * rawText is the scene body — everything after the heading line up to
 * (but not including) the next heading. Transition lines are stripped.
 * Leading and trailing blank lines are trimmed, but internal blank lines
 * (paragraph breaks within a scene) are preserved.
 */
export type ParsedScene = {
  sceneNumber: number;
  heading: string;
  rawText: string;
};

/**
 * The result of parsing a complete screenplay text.
 *
 * scenes: the numbered scenes (1-based), ready for ingestion.
 * preamble: the raw text before scene 1 (title page, metadata blocks, etc.).
 *           May be an empty string if the document starts with a heading.
 *           Never passed to the ingestion pipeline — surfaced here for logging.
 */
export type ParseResult = {
  scenes: ParsedScene[];
  preamble: string;
};

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/**
 * Matches a standard screenplay scene heading at the start of a line.
 * Case-insensitive so INT./int./Int. all match.
 *
 * Covers:
 *   INT.        — interior
 *   EXT.        — exterior
 *   INT./EXT.   — interior then exterior (or reverse)
 *   EXT./INT.   — exterior then interior
 *
 * The heading continues to the end of the line. The remainder of the
 * scene (action lines, dialogue) follows on subsequent lines.
 */
const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.)\s+.*/i;

/**
 * Transition lines to strip from scene bodies.
 * These are boilerplate formatting directives, not story content.
 *
 * Matches the whole line when it is exactly one of these phrases
 * (optionally with trailing whitespace). The match is case-insensitive
 * and anchored to the start of the line.
 *
 * Covered transitions:
 *   CUT TO:
 *   DISSOLVE TO:
 *   SMASH CUT TO:
 *   MATCH CUT TO:
 *   FADE TO:
 *   FADE TO BLACK.
 *   FADE OUT.
 *   FADE IN:
 *
 * A deliberate choice: FADE OUT. and FADE IN: are stripped because they
 * are formatting conventions, not narrative facts. If a story establishes
 * something through a fade (rare), it will still be in the surrounding
 * action lines — the transition label itself carries no claim.
 */
const TRANSITION_RE =
  /^(CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE TO:|FADE TO BLACK\.|FADE OUT\.|FADE IN:)\s*$/im;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a line is a scene heading.
 */
function isHeading(line: string): boolean {
  return SCENE_HEADING_RE.test(line.trim());
}

/**
 * Strips transition lines from a block of scene text.
 * Removes the whole line (including its newline) when it is a transition.
 */
function stripTransitions(text: string): string {
  return text
    .split("\n")
    .filter((line) => !TRANSITION_RE.test(line))
    .join("\n");
}

/**
 * Trims leading and trailing blank lines from a text block while preserving
 * internal blank lines (which represent paragraph / beat breaks in scenes).
 */
function trimBlankLines(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * parseScreenplayText
 *
 * Splits a plain-text screenplay string into scenes and a preamble.
 *
 * Algorithm:
 *   1. Split the input into lines.
 *   2. Walk line by line. When a scene heading is found, start a new scene
 *      and assign it the next sequential number.
 *   3. All lines before the first heading accumulate into the preamble.
 *   4. After collecting all raw scene blocks, strip transition lines and
 *      trim blank lines from each scene body.
 *   5. Return { scenes, preamble }.
 *
 * Edge cases:
 *   - Input with no headings: returns { scenes: [], preamble: <full text> }.
 *     The caller should treat this as a parse failure for ingestion purposes.
 *   - Empty input: returns { scenes: [], preamble: "" }.
 *   - A heading with no following body: produces a scene with rawText: "".
 *
 * @param text  The full plain-text screenplay content.
 * @returns     ParseResult with numbered scenes and the preamble string.
 */
export function parseScreenplayText(text: string): ParseResult {
  if (!text || text.trim() === "") {
    return { scenes: [], preamble: "" };
  }

  const lines = text.split("\n");

  // Accumulate preamble lines (before the first heading)
  const preambleLines: string[] = [];

  // Each entry is { heading, bodyLines[] }
  type RawScene = { heading: string; bodyLines: string[] };
  const rawScenes: RawScene[] = [];

  let currentScene: RawScene | null = null;

  for (const line of lines) {
    if (isHeading(line)) {
      // Start a new scene
      currentScene = { heading: line.trim(), bodyLines: [] };
      rawScenes.push(currentScene);
    } else if (currentScene === null) {
      // Still in the preamble
      preambleLines.push(line);
    } else {
      // Inside a scene — accumulate body
      currentScene.bodyLines.push(line);
    }
  }

  // Build the final ParsedScene array (1-based scene numbers)
  const scenes: ParsedScene[] = rawScenes.map((raw, index) => {
    const bodyText = raw.bodyLines.join("\n");
    const cleaned = trimBlankLines(stripTransitions(bodyText));
    return {
      sceneNumber: index + 1,
      heading: raw.heading,
      rawText: cleaned,
    };
  });

  const preamble = trimBlankLines(preambleLines.join("\n"));

  return { scenes, preamble };
}

/**
 * parseScreenplayTextOrThrow
 *
 * Same as parseScreenplayText but throws a ParseError when the input
 * produces zero scenes. Useful for callers that want to treat a
 * non-screenplay file as an error rather than an empty result.
 *
 * @throws ParseError  if no scene headings are found.
 */
export function parseScreenplayTextOrThrow(text: string): ParseResult {
  const result = parseScreenplayText(text);
  if (result.scenes.length === 0) {
    throw new ParseError(
      "No scene headings found. " +
        "The file does not appear to be in standard screenplay format " +
        "(expected lines starting with INT., EXT., INT./EXT., or EXT./INT.)."
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when a text input cannot be parsed into any scenes.
 * Distinct from a runtime error — this is a user-input problem.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
