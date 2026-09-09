/**
 * models.ts — central Gemini model configuration
 *
 * Change GEMINI_MODEL here to switch every agent at once.
 * The benchmark script (scripts/benchmark-model.ts) overrides this at
 * runtime via the GEMINI_MODEL_OVERRIDE env var so you can test candidates
 * without touching this file.
 *
 * Current candidates:
 *   gemini-3.5-flash  — frontier-level, fast, agentic-optimised
 *   gemini-3.6-flash  — next iteration
 *   gemini-3.7-flash  — current default; higher reasoning quality, moderate latency increase
 *   gemini-3.8-flash  — latest; highest quality, unknown latency profile
 */

export const GEMINI_MODEL: string =
  process.env.GEMINI_MODEL_OVERRIDE ?? "gemini-3.7-flash";
