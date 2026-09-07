import type { FindingSeverity } from "@/lib/domain";
import type { DocLine, LineRole } from "@/lib/screenplay";
import { cn } from "@/lib/utils";

export const ROLE_STYLES: Record<LineRole, string> = {
  meta: "text-foreground",
  heading: "mt-7 font-bold uppercase",
  transition: "mt-6 text-right uppercase",
  character: "mt-4 pl-[26%] pr-[10%] font-bold uppercase",
  parenthetical: "pl-[32%] pr-[20%] text-sm italic",
  dialogue: "pl-[18%] pr-[18%]",
  action: "",
};

export function roleSpacing(line: DocLine): string {
  if (line.paraStart) return "";
  if (line.role === "action" || line.role === "dialogue") return "mt-[0.35em]";
  if (line.role === "meta") return "mt-1";
  return "";
}

export function lineClass(line: DocLine): string {
  return cn(ROLE_STYLES[line.role], roleSpacing(line));
}

export type SeverityTone = {
  band: string;
  text: string;
  solid: string;
};

export const SEVERITY_TONE: Record<FindingSeverity, SeverityTone> = {
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

export const CONFLICT_LEGEND: Record<string, string> = {
  confirmed: "Confirmed",
  ambiguous: "Possible",
};
