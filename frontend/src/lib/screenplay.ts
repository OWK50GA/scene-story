export type LineRole =
  | "heading"
  | "transition"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "action"
  | "meta";

export type DocLine = {
  index: number;
  role: LineRole;
  scene: number;
  paraStart: boolean;
  text: string;
};

export type SceneAnchor = {
  scene: number;
  heading: string;
  firstLine: number;
  lastLine: number;
};

const HEADING_RE =
  /^\s*(?:INT|EXT|INT\.?\/EXT|EXT\.?\/INT|I\/E|EST)\.?[\s./]+.+$/i;

const TRANSITION_RE =
  /^(?:FADE (?:IN|OUT)|CUT TO:|DISSOLVE TO:|SMASH CUT TO:|.*TO BLACK\.?)\s*:?$/i;

const CHARACTER_RE =
  /^[A-Z][A-Z0-9&.'\-\s()]*(?:\(CONT'D\)|\(O\.S\.\)|\(V\.O\.\)|\(OFF\)|\(ON\))?$/;

function classifyLine(text: string, prevRole: LineRole | null): LineRole {
  if (HEADING_RE.test(text)) return "heading";
  if (TRANSITION_RE.test(text)) return "transition";
  if (/^\(/.test(text)) return "parenthetical";
  if (text.length <= 45 && CHARACTER_RE.test(text) && prevRole !== "dialogue")
    return "character";
  if (prevRole === "character" || prevRole === "parenthetical")
    return "dialogue";
  return "action";
}

export function parseScreenplay(raw: string): {
  lines: DocLine[];
  scenes: SceneAnchor[];
} {
  const rawLines = raw.split("\n");
  const lines: DocLine[] = [];
  const scenes: SceneAnchor[] = [];

  let scene = 0;
  let lastContent = false;
  let prevRole: LineRole | null = null;

  for (let i = 0; i < rawLines.length; i += 1) {
    const text = rawLines[i].trim();
    if (text === "") {
      lastContent = false;
      continue;
    }

    const role = classifyLine(text, prevRole);

    if (role === "heading") {
      scene += 1;
      const anchor: SceneAnchor = {
        scene,
        heading: text,
        firstLine: lines.length,
        lastLine: lines.length,
      };
      scenes.push(anchor);
    }

    if (scene === 0 && role !== "heading" && role !== "action") {
      prevRole = null;
      continue;
    }

    lines.push({
      index: lines.length,
      role: scene === 0 ? "meta" : role,
      scene,
      paraStart: !lastContent,
      text,
    });

    if (scene > 0 && scenes.length > 0) {
      scenes[scenes.length - 1].lastLine = lines.length - 1;
    }

    prevRole = scene === 0 ? null : role;
    lastContent = true;
  }

  return { lines, scenes };
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2014\u2013]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function lineIndexesWithinScene(
  lines: DocLine[],
  scene: number,
  start: number,
  end: number,
): DocLine[] {
  return lines.filter(
    (line) =>
      line.scene === scene &&
      line.role !== "heading" &&
      line.index >= start &&
      line.index <= end,
  );
}

export function findClaimLine(
  lines: DocLine[],
  scene: number,
  quote: string,
): number | null {
  const needleWords = normalizeText(quote).split(" ");
  if (needleWords.length < 2) return null;

  const sceneLines = lineIndexesWithinScene(
    lines,
    scene,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );

  const normalizedLines = sceneLines.map((line) => ({
    index: line.index,
    norm: normalizeText(line.text),
  }));

  // A source quote may wrap across the physical lines of the fixture, so try
  // progressively shorter prefixes until one fits on a single rendered line.
  for (let size = needleWords.length; size >= 3; size -= 1) {
    const needle = needleWords.slice(0, size).join(" ");
    const match = normalizedLines.find((entry) => entry.norm.includes(needle));
    if (match !== undefined) return match.index;
  }

  return null;
}
