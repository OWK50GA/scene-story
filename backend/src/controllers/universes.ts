import { Request, Response } from "express";
import { z } from "zod";
import {
  createUniverse,
  getCrossUnitFindingsForUniverse,
  getUniverse,
  getWorldState,
  listUniverses,
} from "../mcp/clickhouse/operations.js";
import type {
  Universe,
  ContinuityFinding,
  WorldStateEntry,
} from "../types/index.js";
import { MCPOperationError } from "../types/index.js";
import { director } from "../agents/director/agent.js";
import type {
  CompanionAnswer,
  GuardianSummary,
} from "../agents/director/orchestration.js";
import { handleError } from "../lib/handle-error.js";

// ---------------------------------------------------------------------------
// Schema for validating the :id route param (reused across all handlers)
// ---------------------------------------------------------------------------

const UniverseParamSchema = z.object({
  id: z.uuid(),
});

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

const CreateUniverseSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

const AskAboutUniverseSchema = z.object({
  question: z.string().min(1),
  boundary: z.array(
    z.object({
      story_unit_id: z.uuid(),
      up_to_scene: z.coerce.number().int().nonnegative(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Response serialisers — camelCase domain objects → snake_case wire format
// ---------------------------------------------------------------------------

function serialiseUniverse(u: Universe) {
  return {
    universe_id: u.universeId,
    name: u.name,
    description: u.description,
    created_at: u.createdAt,
  };
}

function serialiseFinding(f: ContinuityFinding) {
  return {
    finding_id: f.findingId,
    universe_id: f.universeId,
    project_id: f.projectId,
    story_unit_id_a: f.storyUnitIdA,
    story_unit_id_b: f.storyUnitIdB,
    claim_a_id: f.claimAId,
    claim_b_id: f.claimBId,
    conflict_type: f.conflictType,
    severity: f.severity,
    scope: f.scope,
    explanation: f.explanation,
    resolution_suggestion: f.resolutionSuggestion,
    status: f.status,
  };
}

function serialiseWorldStateEntry(e: WorldStateEntry) {
  return {
    entity_id: e.entityId,
    entity_name: e.entityName,
    property: e.property,
    value: e.value,
    source_unit_title: e.sourceUnitTitle,
    in_universe_period: e.inUniversePeriod,
    canon_tier: e.canonTier,
  };
}

function serialiseGuardianSummary(s: GuardianSummary) {
  return {
    findings_count: s.findingsCount,
    findings: s.findings.map(serialiseFinding),
  };
}

function serialiseCompanionAnswer(a: CompanionAnswer) {
  return {
    answer: a.answer,
    claims_used: a.claimsUsed.map((c) => ({
      entity_name: c.entityName,
      property: c.property,
      value: c.value,
      source_unit_title: c.sourceUnitTitle,
      scene_number: c.sceneNumber,
    })),
    boundary_enforced: a.boundaryEnforced,
    boundary_summary: a.boundarySummary,
  };
}

// ---------------------------------------------------------------------------
// Error handler — delegated to shared lib
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function createUniverseHttp(req: Request, res: Response) {
  const parsed = CreateUniverseSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const universe = await createUniverse(parsed.data);
    return res.status(201).json({
      status: "success",
      ...serialiseUniverse(universe),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function listUniversesHttp(req: Request, res: Response) {
  try {
    const universes = await listUniverses();
    return res.status(200).json({
      status: "success",
      data: {
        universes: universes.map(serialiseUniverse),
        universe_count: universes.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getUniverseHttp(req: Request, res: Response) {
  const parsed = UniverseParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const universe = await getUniverse(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: serialiseUniverse(universe),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getWorldStateHttp(req: Request, res: Response) {
  const parsed = UniverseParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const state = await getWorldState(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: {
        entries: state.map(serialiseWorldStateEntry),
        entry_count: state.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

// Note: this is synchronous for now. Revisit as SSE once Guardian runtime is known.
export async function analyzeUniverseHttp(req: Request, res: Response) {
  const parsed = UniverseParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const summary = await director.analyzeUniverse(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: serialiseGuardianSummary(summary),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function askAboutUniverseHttp(req: Request, res: Response) {
  const parsedParam = UniverseParamSchema.safeParse(req.params);
  const parsedBody = AskAboutUniverseSchema.safeParse(req.body);

  if (!parsedParam.success) {
    const issue = parsedParam.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const { question, boundary } = parsedBody.data;
  const { id: universeId } = parsedParam.data;

  try {
    const answer = await director.askCompanion(
      universeId,
      question,
      boundary.map((b) => ({
        storyUnitId: b.story_unit_id,
        upToScene: b.up_to_scene,
      })),
    );
    return res.status(200).json({
      status: "success",
      data: serialiseCompanionAnswer(answer),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getUniverseFindingsHttp(req: Request, res: Response) {
  const parsed = UniverseParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const findings = await getCrossUnitFindingsForUniverse(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: {
        findings: findings.map(serialiseFinding),
        finding_count: findings.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}
