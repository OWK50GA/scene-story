import { GoogleGenAI } from "@google/genai";

import { config } from "../../config/index.js";
import { GEMINI_MODEL } from "../../config/models.js";
import type { Claim, ContinuityFinding, StoryUnit } from "../../types/index.js";

const genai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

export type SceneFixContext = {
  unit: StoryUnit;
  finding: ContinuityFinding;
  claimA: Claim;
  claimB: Claim;
  /** The scene being revised (source scene of the second claim). */
  sceneNumber: number;
  heading: string;
  rawText: string;
};

const SYSTEM_PROMPT = `You are a professional screenwriter revising a single scene of a screenplay to remove a continuity error.

Rewrite ONLY the body of the target scene so the contradiction no longer exists while keeping the scene dramatically intact:
- Keep characters, their voices, the location, and the intended story beats.
- Resolve the conflict in the least invasive way that is consistent with the rest of the story.
- If the error is a mistaken value (a prop that moved, a wrong location, an impossible timeline), correct that detail.
- If the conflict is genuinely intentional or ambiguous, make the intent explicit in the scene text instead of removing it.
- Output ONLY the corrected scene text (action lines and dialogue). No slugline, no commentary, no markdown, no headers.`;

function buildUserPrompt(ctx: SceneFixContext): string {
  const claimA = ctx.claimA;
  const claimB = ctx.claimB;
  return [
    `Project: ${ctx.unit.title}`,
    `In-universe period: ${ctx.unit.inUniversePeriod ?? "unspecified"}`,
    "",
    `The Continuity Guardian flagged a conflict between two established facts:`,
    `- Scene ${claimA.sourceSceneNumber}: ${claimA.property} = "${claimA.value}"`,
    `- Scene ${claimB.sourceSceneNumber}: ${claimB.property} = "${claimB.value}"`,
    "",
    `Guardian explanation: ${ctx.finding.explanation}`,
    ctx.finding.resolutionSuggestion
      ? `Suggested action: ${ctx.finding.resolutionSuggestion}`
      : null,
    "",
    `Target scene ${ctx.sceneNumber} to rewrite:`,
    ctx.heading,
    ctx.rawText,
    "",
    `Output the corrected text for scene ${ctx.sceneNumber} only.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function* streamSceneFix(
  ctx: SceneFixContext,
): AsyncGenerator<string> {
  const stream = await genai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(ctx)}` }],
      },
    ],
    config: { temperature: 0.4, maxOutputTokens: 4096 },
  });

  // chunk.text arrives as incremental deltas, not cumulative text.
  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (text.length > 0) {
      yield text;
    }
  }
}
