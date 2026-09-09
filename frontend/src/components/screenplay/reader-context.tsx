"use client";

import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildAnnotations, type TextAnnotation } from "@/lib/annotations";
import { streamFindingFix } from "@/lib/api/fix-stream";
import type { Finding, FindingConflict, FindingStatus } from "@/lib/domain";
import type { DocLine, SceneAnchor } from "@/lib/screenplay";

export type ViewMode = "read" | "review";

export type FixState =
  | { status: "idle" }
  | {
      status: "running";
      findingId: string;
      scene: number;
      text: string;
    }
  | {
      status: "done";
      findingId: string;
      scene: number;
      text: string;
      oldText: string;
    }
  | {
      status: "error";
      findingId: string;
      scene: number;
      text: string;
      message: string;
    };

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
  fix: FixState;
  startFix: (findingId: string, scene: number) => void;
  cancelFix: () => void;
  dismissFix: () => void;
};

const ReaderContext = createContext<ReaderContextValue | null>(null);

export function ScreenplayReaderProvider({
  lines,
  scenes,
  findings,
  unitId,
  onStatusChange,
  children,
}: {
  lines: DocLine[];
  scenes: SceneAnchor[];
  findings: Finding[];
  unitId?: string;
  onStatusChange?: (findingId: string, status: FindingStatus) => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>("review");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<FindingConflict>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, FindingStatus>>({});
  const [fix, setFix] = useState<FixState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const statusSignature = findings
    .map((finding) => `${finding.id}:${finding.status}`)
    .join("|");
  const [seenSignature, setSeenSignature] = useState(statusSignature);

  if (seenSignature !== statusSignature) {
    setSeenSignature(statusSignature);
    setOverrides({});
  }

  const startFix = useCallback(
    function startFix(findingId: string, scene: number) {
      if (!unitId) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setFix({ status: "running", findingId, scene, text: "" });

      void streamFindingFix(
        unitId,
        findingId,
        {
          onDelta: (text) =>
            setFix((previous) =>
              previous.status === "running"
                ? { ...previous, text: previous.text + text }
                : previous,
            ),
          onDone: ({ oldText, newText }) =>
            setFix({
              status: "done",
              findingId,
              scene,
              text: newText,
              oldText,
            }),
          onError: (message) =>
            setFix({ status: "error", findingId, scene, text: "", message }),
        },
        controller.signal,
      ).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          setFix({ status: "idle" });
          return;
        }
        const message = err instanceof Error ? err.message : "Fix failed";
        setFix((previous) => {
          if (previous.status === "running") {
            return {
              status: "error",
              findingId,
              scene,
              text: previous.text,
              message,
            };
          }
          return previous;
        });
      });
    },
    [unitId],
  );

  const cancelFix = useCallback(function cancelFix() {
    abortRef.current?.abort();
    setFix({ status: "idle" });
  }, []);

  const dismissFix = useCallback(function dismissFix() {
    abortRef.current?.abort();
    setFix({ status: "idle" });
  }, []);

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
      const status = overrides[finding.id] ?? finding.status;
      if (status === "open") counts[finding.conflict] += 1;
    }
    return counts;
  }, [findings, overrides]);

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

  const statusOf = useCallback(
    function statusOf(findingId: string): FindingStatus {
      const override = overrides[findingId];
      if (override) return override;
      const finding = findings.find((f) => f.id === findingId);
      return finding?.status ?? "open";
    },
    [overrides, findings],
  );

  const setStatus = useCallback(
    function setStatus(findingId: string, status: FindingStatus) {
      setOverrides((previous) => ({ ...previous, [findingId]: status }));
      onStatusChange?.(findingId, status);
    },
    [onStatusChange],
  );

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
            (a) => !hidden.has(a.conflict) && statusOf(a.findingId) === "open",
          ),
      hidden,
      toggleConflict,
      selected,
      selectedFinding,
      selectAnnotation,
      statusOf,
      setStatus,
      findingCounts,
      fix,
      startFix,
      cancelFix,
      dismissFix,
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
      findingCounts,
      selectAnnotation,
      toggleConflict,
      statusOf,
      setStatus,
      fix,
      startFix,
      cancelFix,
      dismissFix,
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
