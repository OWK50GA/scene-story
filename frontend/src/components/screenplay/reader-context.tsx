"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
} from "react";

import { buildAnnotations, type TextAnnotation } from "@/lib/annotations";
import type { Finding, FindingConflict, FindingStatus } from "@/lib/domain";
import type { DocLine, SceneAnchor } from "@/lib/screenplay";

export type ViewMode = "read" | "review";

type ReaderContextValue = {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  lines: DocLine[];
  sceneCount: number;
  findings: Finding[];
  annotations: TextAnnotation[];
  annotationsForFinding: (findingId: string) => TextAnnotation[];
  annotationForLine: (lineIndex: number) => TextAnnotation | undefined;
  hidden: Set<FindingConflict>;
  toggleConflict: (conflict: FindingConflict) => void;
  selected: TextAnnotation | null;
  selectedFinding: Finding | null;
  selectAnnotation: (annotation: TextAnnotation | null) => void;
  statusOf: (findingId: string) => FindingStatus;
  setStatus: (findingId: string, status: FindingStatus) => void;
  findingCounts: Record<FindingConflict, number>;
};

const ReaderContext = createContext<ReaderContextValue | null>(null);

export function ScreenplayReaderProvider({
  lines,
  scenes,
  findings,
  children,
}: {
  lines: DocLine[];
  scenes: SceneAnchor[];
  findings: Finding[];
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>("review");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<FindingConflict>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, FindingStatus>>(
    Object.fromEntries(findings.map((finding) => [finding.id, finding.status])),
  );

  const annotations = useMemo(
    () => buildAnnotations(lines, scenes, findings),
    [lines, scenes, findings],
  );

  const byLine = useMemo(() => {
    const map = new Map<number, TextAnnotation[]>();
    for (const annotation of annotations) {
      const list = map.get(annotation.lineIndex) ?? [];
      list.push(annotation);
      map.set(annotation.lineIndex, list);
    }
    return map;
  }, [annotations]);

  const byFinding = useMemo(() => {
    const map = new Map<string, TextAnnotation[]>();
    for (const annotation of annotations) {
      const list = map.get(annotation.findingId) ?? [];
      list.push(annotation);
      map.set(annotation.findingId, list);
    }
    return map;
  }, [annotations]);

  const selected = useMemo(() => {
    if (selectedKey === null) return null;
    return (
      annotations.find((annotation) => annotation.key === selectedKey) ?? null
    );
  }, [selectedKey, annotations]);

  const selectedFinding = useMemo(() => {
    if (selected === null) return null;
    return (
      findings.find((finding) => finding.id === selected.findingId) ?? null
    );
  }, [selected, findings]);

  const findingCounts = useMemo(() => {
    const counts: Record<FindingConflict, number> = {
      confirmed: 0,
      ambiguous: 0,
    };
    for (const finding of findings) {
      const status = statuses[finding.id] ?? finding.status;
      if (status === "open") counts[finding.conflict] += 1;
    }
    return counts;
  }, [findings, statuses]);

  const selectAnnotation = useCallback(function selectAnnotation(
    annotation: TextAnnotation | null,
  ) {
    setSelectedKey((previous) =>
      annotation === null || previous === annotation.key
        ? null
        : annotation.key,
    );
    if (annotation !== null) {
      requestAnimationFrame(() => {
        document
          .getElementById(`line-${annotation.lineIndex}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }, []);

  const toggleConflict = useCallback(function toggleConflict(
    conflict: FindingConflict,
  ) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(conflict)) next.delete(conflict);
      else next.add(conflict);
      return next;
    });
  }, []);

  const setStatus = useCallback(function setStatus(
    findingId: string,
    status: FindingStatus,
  ) {
    setStatuses((previous) => ({ ...previous, [findingId]: status }));
  }, []);

  const value = useMemo<ReaderContextValue>(
    () => ({
      mode,
      setMode,
      lines,
      sceneCount: scenes.length,
      findings,
      annotations,
      annotationsForFinding: (findingId) => byFinding.get(findingId) ?? [],
      annotationForLine: (lineIndex) =>
        byLine
          .get(lineIndex)
          ?.find(
            (a) =>
              !hidden.has(a.conflict) &&
              (statuses[a.findingId] ?? "open") === "open",
          ),
      hidden,
      toggleConflict,
      selected,
      selectedFinding,
      selectAnnotation,
      statusOf: (findingId) => statuses[findingId] ?? "open",
      setStatus,
      findingCounts,
    }),
    [
      mode,
      lines,
      scenes,
      findings,
      annotations,
      byFinding,
      byLine,
      hidden,
      selected,
      selectedFinding,
      statuses,
      findingCounts,
      selectAnnotation,
      toggleConflict,
      setStatus,
    ],
  );

  return (
    <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
  );
}

export function useScreenplayReader(): ReaderContextValue {
  const value = use(ReaderContext);
  if (value === null) {
    throw new Error(
      "useScreenplayReader must be used within ScreenplayReaderProvider",
    );
  }
  return value;
}
