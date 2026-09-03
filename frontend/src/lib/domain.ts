export type SourceType = "explicit" | "implied" | "inferred";
export type EntityType = "character" | "object" | "location";
export type FindingSeverity = "high" | "medium" | "low";
export type FindingConflict = "confirmed" | "ambiguous";
export type FindingStatus = "open" | "marked_intentional" | "resolved";

export type Claim = {
  id: string;
  entity: string;
  entityType: EntityType;
  property: string;
  value: string;
  scene: number;
  sourceType: SourceType;
  confidence: number;
  sourceLine: string;
};

export type StoryEvent = {
  id: string;
  scene: number;
  subject: string;
  action: string;
  object: string | null;
  description: string;
};

export type Finding = {
  id: string;
  title: string;
  severity: FindingSeverity;
  conflict: FindingConflict;
  claimA: Claim;
  claimB: Claim;
  explanation: string;
  suggestion: string;
  status: FindingStatus;
};

export type SceneSummary = {
  number: number;
  heading: string;
  time: string;
  summary: string;
};

export type StoryUnit = {
  title: string;
  slug: string;
  scenes: SceneSummary[];
  claims: Claim[];
  events: StoryEvent[];
  findings: Finding[];
};

export type IngestEvent =
  | { kind: "scene_complete"; scene: number; claimsWritten: number }
  | { kind: "scene_failed"; scene: number; reason: string }
  | { kind: "ingestion_complete"; sceneCount: number; claimCount: number };

export type CompanionAnswer = {
  answer: string;
  claimsUsed: Claim[];
  notKnown: boolean;
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  explicit: "Explicit",
  implied: "Implied",
  inferred: "Inferred",
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const CONFLICT_LABEL: Record<FindingConflict, string> = {
  confirmed: "Confirmed",
  ambiguous: "Ambiguous",
};
