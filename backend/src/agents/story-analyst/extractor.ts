import { GoogleGenAI } from "@google/genai";
import { config } from "../../config/index.js";
import {
  SceneExtractionSchema,
  ExtractionError,
  type SceneExtraction,
  type Scene,
  type StoryUnit,
} from "../../types/index.js";
import { buildExtractionPrompt, type ExtractionPromptInput } from "./prompt.js";

// =============================================================================
// Story Analyst — Scene Extractor
//
// extractScene is the single public entry point. It:
//   1. Builds the prompt via buildExtractionPrompt
//   2. Calls Gemini with responseMimeType: "application/json"
//   3. Parses and validates the response against SceneExtractionSchema
//   4. On failure, retries once with the identical prompt
//   5. On second failure, throws ExtractionError with the raw response attached
//
// The caller (Task 8 agent) is responsible for:
//   - Providing the contextSummary (from get_current_state)
//   - Handling ExtractionError (mark scene failed, continue pipeline)
//   - Writing the returned SceneExtraction to ClickHouse
// =============================================================================

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

// -----------------------------------------------------------------------------
// Gemini client
//
// Instantiated once at module load. The API key comes from the validated
// config so a missing key fails at startup, not mid-pipeline.
// -----------------------------------------------------------------------------

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * extractScene
 *
 * Calls Gemini to extract structured story facts from a single scene.
 * Retries once on parse or validation failure. Throws ExtractionError
 * on second failure — never swallows the error silently.
 *
 * @param scene           The scene to extract. Must have heading and rawText.
 * @param unit            The story unit the scene belongs to. Used for prompt
 *                        context (title, in-universe period, date).
 * @param contextSummary  Pre-formatted known-state string from get_current_state.
 *                        Pass "" for scene 1.
 * @param sceneTotal      Total number of scenes in the unit. Used for positional
 *                        context in the prompt ("scene N of M").
 * @returns               Validated SceneExtraction ready for entity resolution
 *                        and ClickHouse writes.
 * @throws ExtractionError  If both attempts fail validation.
 */
export async function extractScene(
  scene: Scene,
  unit: StoryUnit,
  contextSummary: string,
  sceneTotal: number,
): Promise<SceneExtraction> {
  const promptInput: ExtractionPromptInput = {
    scene,
    unit,
    contextSummary,
    sceneTotal,
  };

  const prompt = buildExtractionPrompt(promptInput);

  let lastRaw = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;

    try {
      raw = await callGemini(prompt);
    } catch (err) {
      // Network or timeout error — treat as a failed attempt
      lastRaw = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) continue;
      throw new ExtractionError(
        scene.sceneId,
        lastRaw,
        `Gemini call failed after ${MAX_ATTEMPTS} attempts for scene ${scene.sceneNumber}: ${lastRaw}`,
      );
    }

    lastRaw = raw;

    const result = parseAndValidate(raw);

    if (result.ok) {
      return result.data;
    }

    // Validation failed — log attempt and either retry or throw
    if (attempt < MAX_ATTEMPTS) {
      // Single retry with the same prompt, no backoff needed for one retry
      continue;
    }

    throw new ExtractionError(
      scene.sceneId,
      lastRaw,
      `SceneExtraction schema validation failed after ${MAX_ATTEMPTS} attempts ` +
        `for scene ${scene.sceneNumber} (${scene.heading}). ` +
        `Last error: ${result.error}`,
    );
  }

  // TypeScript requires a return here; the loop above always returns or throws.
  throw new ExtractionError(
    scene.sceneId,
    lastRaw,
    `extractScene: unreachable state for scene ${scene.sceneNumber}`,
  );
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * callGemini
 *
 * Fires a single Gemini request with a hard 30-second timeout.
 * Returns the raw text content of the response.
 * Throws if the model returns an empty response or times out.
 */
async function callGemini(prompt: string): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gemini request timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    ),
  );

  const geminiPromise = genai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
    },
  });

  const response = await Promise.race([geminiPromise, timeoutPromise]);

  const text = response.text;

  if (!text || text.trim() === "") {
    throw new Error("Gemini returned an empty response");
  }

  return text.trim();
}

/**
 * parseAndValidate
 *
 * Attempts to JSON.parse the raw string, then validates it against
 * SceneExtractionSchema. Returns a discriminated union result so the
 * caller can decide whether to retry or throw without try/catch nesting.
 */
type ParseResult =
  { ok: true; data: SceneExtraction } | { ok: false; error: string };

function parseAndValidate(raw: string): ParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = SceneExtractionSchema.safeParse(parsed);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; "),
  };
}
