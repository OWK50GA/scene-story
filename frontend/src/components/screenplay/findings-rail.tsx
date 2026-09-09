"use client";

import { CheckCircle2, CircleOff, LoaderCircle, Sparkles } from "lucide-react";

import { SEVERITY_TONE } from "@/components/screenplay/presentation";
import { useScreenplayReader } from "@/components/screenplay/reader-context";
import { Button } from "@/components/ui/button";
import { CONFLICT_LABEL, type Finding, SEVERITY_LABEL } from "@/lib/domain";
import { cn } from "@/lib/utils";

function FindingDetails({
  finding,
  fallback,
}: {
  finding: Finding;
  fallback: boolean;
}) {
  const { statusOf, setStatus, startFix, fix } = useScreenplayReader();
  const status = statusOf(finding.id);
  const tone = SEVERITY_TONE[finding.severity];
  const isGeneratingThis =
    fix.status === "running" && fix.findingId === finding.id;
  const fixScene =
    finding.claimB.scene !== finding.claimA.scene
      ? finding.claimB.scene
      : finding.claimA.scene;
  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-snug">{finding.title}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-[11px] tracking-widest uppercase",
            tone.text,
          )}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          {CONFLICT_LABEL[finding.conflict]}
        </span>
        {status !== "open" ? (
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            · {status}
          </span>
        ) : null}
        {fallback ? (
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            · scene anchor
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <div className="grid gap-2 md:grid-cols-2">
          {(
            [
              ["A", finding.claimA],
              ["B", finding.claimB],
            ] as const
          ).map(([side, claim]) => (
            <div key={side} className="border-l-2 border-border pl-2">
              <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                claim {side} · scene {claim.scene}
              </p>
              <p className="mt-0.5 text-xs leading-snug">
                <span className="font-semibold">{claim.entity}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {claim.property}
                </span>
                <br />
                {claim.value}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {finding.explanation}
        </p>

        <p className="text-xs leading-relaxed">
          <span className="font-semibold">Suggested action.</span>{" "}
          <span className="text-muted-foreground">{finding.suggestion}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status !== "open" ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {status}
          </span>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus(finding.id, "marked_intentional")}
            >
              <CircleOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Intentional
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus(finding.id, "resolved")}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Resolve
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={isGeneratingThis}
              onClick={() => startFix(finding.id, fixScene)}
            >
              {isGeneratingThis ? (
                <LoaderCircle
                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                  aria-hidden
                />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {isGeneratingThis ? "Generating…" : "Fix with AI"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const { annotationsForFinding, selected, selectAnnotation, statusOf } =
    useScreenplayReader();

  const anns = annotationsForFinding(finding.id);
  const selectedFinding = selected?.findingId === finding.id;
  const status = statusOf(finding.id);
  if (anns.length === 0) return null;

  return (
    <div
      className={cn(
        "border-b border-border last:border-b-0",
        selectedFinding && "bg-muted/40",
        status !== "open" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => selectAnnotation(anns[0])}
        className={cn(
          "flex w-full items-center gap-2 border-l-[3px] px-5 py-3 text-left",
          SEVERITY_TONE[finding.severity].solid,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {finding.title}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            {SEVERITY_LABEL[finding.severity]} ·{" "}
            {CONFLICT_LABEL[finding.conflict]}
            {status !== "open" ? ` · ${status}` : ""}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {anns[0].scene}
        </span>
      </button>

      {selectedFinding ? (
        <FindingDetails
          finding={finding}
          fallback={anns.some((a) => a.fallbackScene)}
        />
      ) : null}
    </div>
  );
}

export function FindingsRail() {
  const { mode, findings, annotations, statusOf, hidden } =
    useScreenplayReader();

  if (mode !== "review") return null;

  const openCount = findings.filter(
    (finding) => statusOf(finding.id) === "open",
  ).length;
  const visibleHighlightCount = annotations.filter(
    (annotation) =>
      statusOf(annotation.findingId) === "open" &&
      !hidden.has(annotation.conflict),
  ).length;
  const hasOpen = openCount > 0;

  return (
    <aside className="hidden lg:block">
      <div className="border border-border bg-background">
        <div className="border-b border-border px-5 py-3">
          <p className="text-sm font-semibold">Findings</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {visibleHighlightCount} highlights · {openCount} open
          </p>
        </div>
        <div className="scroll-stable max-h-[70vh] overflow-y-auto">
          {findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
          {!hasOpen ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No open findings. Marked findings are hidden from the document.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
