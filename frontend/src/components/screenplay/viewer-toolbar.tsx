"use client";

import { BookOpen, Eye, EyeOff, ScanSearch } from "lucide-react";

import { CONFLICT_LEGEND } from "@/components/screenplay/presentation";
import {
  useScreenplayReader,
  type ViewMode,
} from "@/components/screenplay/reader-context";
import type { FindingConflict } from "@/lib/domain";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: ViewMode; label: string; icon: typeof BookOpen }> =
  [
    { value: "review", label: "Review", icon: ScanSearch },
    { value: "read", label: "Read", icon: BookOpen },
  ];

const CONFLICT_COLOR: Record<FindingConflict, string> = {
  confirmed: "text-red-600 dark:text-red-400",
  ambiguous: "text-amber-600 dark:text-yellow-400",
};

export function ReaderToolbar() {
  const { mode, setMode, hidden, toggleConflict, findingCounts } =
    useScreenplayReader();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="tablist"
        aria-label="Viewer mode"
        className="flex border border-border bg-background p-0.5"
      >
        {MODES.map(({ value, label, icon: Icon }) => {
          const isActive = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setMode(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs tracking-wide",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {mode === "review" ? (
        <CategoryToggles
          hidden={hidden}
          onToggle={toggleConflict}
          counts={findingCounts}
        />
      ) : (
        <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          clean copy
        </span>
      )}
    </div>
  );
}

function CategoryToggles({
  hidden,
  onToggle,
  counts,
}: {
  hidden: Set<FindingConflict>;
  onToggle: (conflict: FindingConflict) => void;
  counts: Record<FindingConflict, number>;
}) {
  return (
    <div className="flex items-center gap-3">
      {(Object.keys(counts) as FindingConflict[]).map((conflict) => {
        const visible = !hidden.has(conflict);
        const Icon = visible ? Eye : EyeOff;
        return (
          <button
            key={conflict}
            type="button"
            onClick={() => onToggle(conflict)}
            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span
              className={cn(
                "uppercase tracking-widest",
                CONFLICT_COLOR[conflict],
              )}
            >
              {CONFLICT_LEGEND[conflict]}
            </span>
            <span>{visible ? counts[conflict] : "off"}</span>
          </button>
        );
      })}
    </div>
  );
}
