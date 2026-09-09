"use client";

import { Fragment } from "react";

import { lineClass, SEVERITY_TONE } from "@/components/screenplay/presentation";
import { useScreenplayReader } from "@/components/screenplay/reader-context";
import { SceneFixPanel } from "@/components/screenplay/scene-fix-panel";
import type { DocLine } from "@/lib/screenplay";
import { cn } from "@/lib/utils";

function ScriptLine({ line }: { line: DocLine }) {
  const { mode, annotationForLine, selected, selectAnnotation } =
    useScreenplayReader();

  const annotation =
    mode === "read" ? undefined : annotationForLine(line.index);

  if (annotation === undefined) {
    return <p className={lineClass(line)}>{line.text}</p>;
  }

  const tone = SEVERITY_TONE[annotation.severity];
  const isSelected = selected?.key === annotation.key;
  const dashed = annotation.conflict === "ambiguous";

  return (
    <button
      type="button"
      onClick={() => selectAnnotation(annotation)}
      className={cn(
        lineClass(line),
        "block w-full border-l-[3px] border-l-transparent px-1 text-left transition-colors",
        tone.band,
        dashed ? "border-l-dashed" : "border-l-solid",
        isSelected ? "ring-2 ring-inset ring-primary/70" : tone.solid,
      )}
    >
      {line.text}
    </button>
  );
}

export function ScreenplayPaper({
  title,
  sceneCount,
}: {
  title: string;
  sceneCount: number;
}) {
  const { lines, fix } = useScreenplayReader();
  const fixScene = fix.status === "idle" ? undefined : fix.scene;

  return (
    <div className="min-w-0">
      <div className="border border-border bg-background shadow-sm">
        <div className="border-b border-border px-6 py-3">
          <p className="text-sm font-semibold">{title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {sceneCount} scenes · screenplay
          </p>
        </div>
        <div
          id="script-document"
          className="scroll-stable max-h-[70vh] overflow-y-auto px-6 py-8 md:px-12"
        >
          <div className="mx-auto w-full max-w-[36rem] font-script text-[15px] leading-[1.5] md:text-base">
            {lines.map((line, index) => {
              const previous = lines[index - 1];
              const isFirstOfScene =
                previous === undefined || previous.scene !== line.scene;
              const showFix =
                fixScene !== undefined &&
                isFirstOfScene &&
                line.scene === fixScene;
              return (
                <Fragment key={line.index}>
                  <span id={`line-${line.index}`} className="block">
                    <ScriptLine line={line} />
                  </span>
                  {showFix ? <SceneFixPanel /> : null}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
