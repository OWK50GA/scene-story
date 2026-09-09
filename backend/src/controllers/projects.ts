import { Request, Response } from "express";
import z from "zod";
import {
  createProject,
  getFindingsForProject,
  getStoryUnitsForProject,
  getClaim,
  getFinding,
  updateFindingStatus,
  getProject,
  listProjects,
  getProjectSummary,
  type ProjectSummary,
} from "../mcp/clickhouse/operations.js";
import type {
  Claim,
  ContinuityFinding,
  FindingStatus,
  Project,
  StoryUnit,
} from "../types/index.js";
import { MCPOperationError } from "../types/index.js";
import { handleError } from "../lib/handle-error.js";

// ---------------------------------------------------------------------------
// Param / body schemas
// ---------------------------------------------------------------------------

const ProjectParamSchema = z.object({
  id: z.uuid(),
});

const FindingParamSchema = z.object({
  id: z.uuid(), // project id
  findingId: z.uuid(),
});

// universeId comes from the URL param (:id), not the body.
const CreateProjectBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["film", "series", "crossover", "other"]),
  canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const PatchFindingStatusSchema = z.object({
  status: z.enum(["open", "marked_intentional", "resolved"]),
});

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

function serialiseProject(p: Project) {
  return {
    project_id: p.projectId,
    universe_id: p.universeId,
    name: p.name,
    type: p.type,
    canon_tier: p.canonTier,
    created_at: p.createdAt,
  };
}

function serialiseProjectSummary(s: ProjectSummary) {
  return {
    project_id: s.projectId,
    universe_id: s.universeId,
    name: s.name,
    type: s.type,
    canon_tier: s.canonTier,
    created_at: s.createdAt,
    universe_name: s.universeName,
    unit_count: s.unitCount,
    claim_count: s.claimCount,
  };
}

function serialiseStoryUnit(s: StoryUnit) {
  return {
    story_unit_id: s.storyUnitId,
    project_id: s.projectId,
    universe_id: s.universeId,
    title: s.title,
    unit_type: s.unitType,
    season_number: s.seasonNumber,
    episode_number: s.episodeNumber,
    in_universe_period: s.inUniversePeriod,
    in_universe_date_start: s.inUniverseDateStart,
    in_universe_date_end: s.inUniverseDateEnd,
    release_order: s.releaseOrder,
    ingestion_status: s.ingestionStatus,
    scene_count: s.sceneCount,
    claim_count: s.claimCount,
  };
}

function serialiseClaim(c: Claim) {
  return {
    claim_id: c.claimId,
    universe_entity_id: c.universeEntityId,
    story_unit_id: c.storyUnitId,
    source_scene_number: c.sourceSceneNumber,
    property: c.property,
    value: c.value,
    source_type: c.sourceType,
    confidence: c.confidence,
    confidence_rationale: c.confidenceRationale,
    source_line: c.sourceLine,
    valid_from_scene: c.validFromScene,
    valid_to_scene: c.validToScene,
    in_universe_period: c.inUniversePeriod,
    canon_tier: c.canonTier,
    superseded_by_canon: c.supersededByCanon,
  };
}

function serialiseFinding(
  f: ContinuityFinding,
  claimA?: Claim,
  claimB?: Claim,
) {
  return {
    finding_id: f.findingId,
    universe_id: f.universeId,
    project_id: f.projectId,
    story_unit_id_a: f.storyUnitIdA,
    story_unit_id_b: f.storyUnitIdB,
    claim_a_id: f.claimAId,
    claim_b_id: f.claimBId,
    claim_a: claimA ? serialiseClaim(claimA) : null,
    claim_b: claimB ? serialiseClaim(claimB) : null,
    conflict_type: f.conflictType,
    severity: f.severity,
    scope: f.scope,
    explanation: f.explanation,
    resolution_suggestion: f.resolutionSuggestion,
    status: f.status,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function createProjectHttp(req: Request, res: Response) {
  const parsedParam = ProjectParamSchema.safeParse(req.params);
  if (!parsedParam.success) {
    const issue = parsedParam.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const parsedBody = CreateProjectBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const project = await createProject({
      universeId: parsedParam.data.id,
      ...parsedBody.data,
    });
    return res.status(201).json({
      status: "success",
      data: serialiseProject(project),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getProjectHttp(req: Request, res: Response) {
  const parsed = ProjectParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const summary = await getProjectSummary(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: serialiseProjectSummary(summary),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function listProjectsHttp(_req: Request, res: Response) {
  try {
    const projects = await listProjects();
    return res.status(200).json({
      status: "success",
      data: {
        projects: projects.map(serialiseProjectSummary),
        project_count: projects.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getFindingsForProjectHttp(req: Request, res: Response) {
  const parsed = ProjectParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const projectFindings = await getFindingsForProject(parsed.data.id);

    // Resolve claim content in parallel for all findings.
    const enriched = await Promise.all(
      projectFindings.map(async (f) => {
        const [claimA, claimB] = await Promise.all([
          getClaim(f.claimAId).catch((err: unknown) => {
            if (
              err instanceof MCPOperationError &&
              err.code === "claim.not_found"
            )
              return undefined;
            throw err;
          }),
          getClaim(f.claimBId).catch((err: unknown) => {
            if (
              err instanceof MCPOperationError &&
              err.code === "claim.not_found"
            )
              return undefined;
            throw err;
          }),
        ]);
        return serialiseFinding(f, claimA, claimB);
      }),
    );

    return res.status(200).json({
      status: "success",
      data: {
        findings: enriched,
        finding_count: enriched.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getStoryUnitsForProjectHttp(req: Request, res: Response) {
  const parsed = ProjectParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    // Verify project exists so we return 404 rather than an empty array.
    await getProject(parsed.data.id);
    const units = await getStoryUnitsForProject(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: {
        story_units: units.map(serialiseStoryUnit),
        unit_count: units.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function patchFindingStatusHttp(req: Request, res: Response) {
  const parsedParam = FindingParamSchema.safeParse(req.params);
  if (!parsedParam.success) {
    const issue = parsedParam.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const parsedBody = PatchFindingStatusSchema.safeParse(req.body);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const { id: projectId, findingId } = parsedParam.data;
  const { status } = parsedBody.data;

  try {
    // Fetch the finding first — verifies it exists and belongs to this project.
    const finding = await getFinding(findingId);
    if (finding.projectId !== projectId) {
      return res.status(404).json({
        status: "error",
        message: `Finding ${findingId} not found`,
        code: "finding.not_found",
      });
    }

    await updateFindingStatus(findingId, status as FindingStatus);
    return res.status(200).json({
      status: "success",
      data: { finding_id: findingId, status },
    });
  } catch (err) {
    if (err instanceof MCPOperationError && err.code === "finding.not_found") {
      return res
        .status(404)
        .json({ status: "error", message: err.message, code: err.code });
    }
    return handleError(err, res);
  }
}
