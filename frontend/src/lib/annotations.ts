import type { Finding } from "@/lib/domain";
import {
  type DocLine,
  findClaimLine,
  type SceneAnchor,
} from "@/lib/screenplay";

export type AnnotationSide = "a" | "b";

export type TextAnnotation = {
  key: string;
  findingId: string;
  side: AnnotationSide;
  scene: number;
  lineIndex: number;
  fallbackScene: boolean;
  severity: Finding["severity"];
  conflict: Finding["conflict"];
};

export function buildAnnotations(
  lines: DocLine[],
  scenes: SceneAnchor[],
  findings: Finding[],
): TextAnnotation[] {
  const annotations: TextAnnotation[] = [];

  for (const finding of findings) {
    for (const side of ["a", "b"] as const) {
      const claim = side === "a" ? finding.claimA : finding.claimB;
      const anchor = scenes.find((s) => s.scene === claim.scene);
      if (anchor === undefined) continue;

      let lineIndex = findClaimLine(lines, claim.scene, claim.sourceLine);
      let fallbackScene = false;

      if (lineIndex === null) {
        lineIndex = anchor.firstLine;
        fallbackScene = true;
      }

      annotations.push({
        key: `${finding.id}-${side}`,
        findingId: finding.id,
        side,
        scene: claim.scene,
        lineIndex,
        fallbackScene,
        severity: finding.severity,
        conflict: finding.conflict,
      });
    }
  }

  return annotations;
}
