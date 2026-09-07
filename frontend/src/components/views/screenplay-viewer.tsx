"use client";

import {
  BookOpen,
  CheckCircle2,
  CircleOff,
  Eye,
  EyeOff,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { buildAnnotations, type TextAnnotation } from "@/lib/annotations";
import {
  CONFLICT_LABEL,
  type Finding,
  type FindingConflict,
  type FindingSeverity,
  type FindingStatus,
  SEVERITY_LABEL,
} from "@/lib/domain";
import {
  type DocLine,
  type LineRole,
  type SceneAnchor,
} from "@/lib/screenplay";
import { cn } from "@/lib/utils";

type ViewMode = "read" | "review";

const lineClass: Record<LineRole, string> = {
  meta: "text-[12px] text-muted-foreground",
  heading: "mt-7 font-semibold uppercase",
  transition: "mt-6 text-right uppercase",
  character: "mt-4 ml-[28%] font-semibold uppercase",
  parenthetical: "ml-[34%] text-sm italic",
  dialogue: "mx-[18%]",
  action: "",
};

function roleSpacing(line: DocLine): string {
  if (line.paraStart) return "";
  if (line.role === "action" || line.role === "dialogue") return "mt-[0.35em]";
  return "";
}

const tone: Record<
  FindingSeverity,
  { band: string; text: string; solid: string }
> = {
  high: {
    band: "bg-red-100/90 hover:bg-red-200/80 border-l-red-600 dark:bg-red-950/70 dark:hover:bg-red-900/70 dark:border-l-red-400",
    text: "text-red-700 dark:text-red-300",
    solid: "border-l-red-600 dark:border-l-red-400",
  },
  medium: {
    band: "bg-amber-100/80 hover:bg-amber-200/70 border-l-amber-600 dark:bg-yellow-950/70 dark:hover:bg-yellow-900/70 dark:border-l-yellow-400",
    text: "text-amber-700 dark:text-yellow-300",
    solid: "border-l-amber-600 dark:border-l-yellow-400",
  },
  low: {
    band: "bg-stone-200/70 hover:bg-stone-300/60 border-l-stone-500 dark:bg-stone-800/70 dark:hover:bg-stone-700/60 dark:border-l-stone-400",
    text: "text-stone-600 dark:text-stone-300",
    solid: "border-l-stone-500 dark:border-l-stone-400",
  },
};

const CONFLICT_COUNT: Record<FindingConflict, string> = {
  confirmed: "Confirmed",
  ambiguous: "Possible",
};

function FindingDetail({
  finding,
  fallback,
  status,
  onStatus,
}: {
  finding: Finding;
  fallback: boolean;
  status: FindingStatus;
  onStatus: (status: FindingStatus) => void;
}) {
  const [showFix, setShowFix] = useState(false);
  const sev = tone[finding.severity];

  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-snug">{finding.title}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-[11px] tracking-widest uppercase",
            sev.text,
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
              onClick={() => onStatus("marked_intentional")}
            >
              <CircleOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Intentional
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("resolved")}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Resolve
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => setShowFix((v) => !v)}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Fix with AI
            </Button>
          </>
        )}
      </div>

      {showFix ? (
        <div className="mt-3 border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed">
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            suggested revision
          </p>
          <p className="mt-1">{finding.suggestion}</p>
        </div>
      ) : null}
    </div>
  );
}

function ScriptLine({
  line,
  annotation,
  selected,
  onClick,
}: {
  line: DocLine;
  annotation?: TextAnnotation;
  selected: boolean;
  onClick: () => void;
}) {
  const base = cn(lineClass[line.role], roleSpacing(line));
  if (annotation === undefined) {
    return <p className={base}>{line.text}</p>;
  }

  const sev = tone[annotation.severity];
  const dashed = annotation.conflict === "ambiguous";
  const marker = cn(
    "border-l-[3px]",
    dashed ? "border-l-dashed" : "border-l-solid",
    selected ? "ring-2 ring-inset ring-primary/70" : sev.solid,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        "block w-full border-l-[3px] border-l-transparent px-1 text-left transition-colors",
        sev.band,
        marker,
      )}
    >
      {line.text}
    </button>
  );
}

export function ScreenplayViewer({
  lines,
  scenes,
  findings,
  title,
}: {
  lines: DocLine[];
  scenes: SceneAnchor[];
  findings: Finding[];
  title: string;
}) {
  const [mode, setMode] = useState<ViewMode>("review");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<FindingConflict>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, FindingStatus>>(
    Object.fromEntries(findings.map((f) => [f.id, f.status])),
  );

  const annotations = useMemo(
    () => buildAnnotations(lines, scenes, findings),
    [lines, scenes, findings],
  );

  const byLine = useMemo(() => {
    const map = new Map<number, TextAnnotation[]>();
    for (const ann of annotations) {
      const list = map.get(ann.lineIndex) ?? [];
      list.push(ann);
      map.set(ann.lineIndex, list);
    }
    return map;
  }, [annotations]);

  const selected = useMemo(() => {
    if (selectedKey === null) return null;
    return annotations.find((a) => a.key === selectedKey) ?? null;
  }, [selectedKey, annotations]);

  const selectedFinding =
    selected === null
      ? null
      : (findings.find((f) => f.id === selected.findingId) ?? null);

  const openFinding = findings.find((f) => f.status === "open");
  const findingCounts = useMemo(() => {
    const out: Record<FindingConflict, number> = { confirmed: 0, ambiguous: 0 };
    for (const f of findings) {
      if (f.status === "open") out[f.conflict] += 1;
    }
    return out;
  }, [findings]);

  function toggleCategory(conflict: FindingConflict) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(conflict)) next.delete(conflict);
      else next.add(conflict);
      return next;
    });
  }

  function selectAnnotation(ann: TextAnnotation) {
    setSelectedKey((prev) => (prev === ann.key ? null : ann.key));
    requestAnimationFrame(() => {
      document
        .getElementById(`line-${ann.lineIndex}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function setFindingStatus(id: string, status: FindingStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Viewer mode"
            className="flex border border-border bg-background p-0.5"
          >
            {(
              [
                ["review", "Review", ScanSearch],
                ["read", "Read", BookOpen],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs tracking-wide",
                  mode === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode === "review" ? (
          <div className="flex items-center gap-3">
            {(Object.keys(findingCounts) as FindingConflict[]).map(
              (conflict) => {
                const visible = !hidden.has(conflict);
                const Icon = visible ? Eye : EyeOff;
                return (
                  <button
                    key={conflict}
                    type="button"
                    onClick={() => toggleCategory(conflict)}
                    className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span
                      className={cn(
                        "uppercase tracking-widest",
                        conflict === "confirmed" && "text-red-600",
                        conflict === "ambiguous" && "text-amber-600",
                      )}
                    >
                      {CONFLICT_COUNT[conflict]}
                    </span>
                    <span>{visible ? findingCounts[conflict] : "off"}</span>
                  </button>
                );
              },
            )}
          </div>
        ) : (
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            clean copy
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <div className="border border-border bg-background shadow-sm">
            <div className="border-b border-border px-6 py-3">
              <p className="text-sm font-semibold">{title}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {scenes.length} scenes · screenplay
              </p>
            </div>
            <div
              id="script-document"
              className="scroll-stable max-h-[70vh] overflow-y-auto px-8 py-8"
            >
              <div className="mx-auto w-full max-w-[34rem] font-mono text-[15px] leading-[1.55]">
                {lines.map((line) => {
                  const list = byLine.get(line.index) ?? [];
                  const visible = list.find((a) => !hidden.has(a.conflict));

                  if (mode === "read" || visible === undefined) {
                    return (
                      <p
                        key={line.index}
                        className={cn(lineClass[line.role], roleSpacing(line))}
                      >
                        {line.text}
                      </p>
                    );
                  }

                  return (
                    <span
                      key={line.index}
                      id={`line-${line.index}`}
                      className="block"
                    >
                      <ScriptLine
                        line={line}
                        annotation={visible}
                        selected={selected?.key === visible.key}
                        onClick={() => selectAnnotation(visible)}
                      />
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {mode === "review" ? (
          <aside className="hidden lg:block">
            <div className="border border-border bg-background">
              <div className="border-b border-border px-5 py-3">
                <p className="text-sm font-semibold">Findings</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {annotations.length} highlights ·{" "}
                  {findings.filter((f) => f.status === "open").length} open
                </p>
              </div>
              <div className="scroll-stable max-h-[70vh] overflow-y-auto">
                {findings.map((finding) => {
                  const anns = annotations.filter(
                    (a) => a.findingId === finding.id,
                  );
                  const isSelected = selected?.findingId === finding.id;
                  const status = statuses[finding.id] ?? finding.status;
                  if (anns.length === 0) return null;
                  return (
                    <div
                      key={finding.id}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        isSelected && "bg-muted/40",
                        status !== "open" && "opacity-60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectAnnotation(anns[0])}
                        className={cn(
                          "flex w-full items-center gap-2 border-l-[3px] px-5 py-3 text-left",
                          tone[finding.severity].solid,
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
                      {isSelected && selectedFinding !== null ? (
                        <FindingDetail
                          finding={selectedFinding}
                          fallback={anns.some((a) => a.fallbackScene)}
                          status={status}
                          onStatus={(s) => setFindingStatus(finding.id, s)}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {openFinding === undefined ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No open findings. Marked findings are hidden from the
                    document.
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
