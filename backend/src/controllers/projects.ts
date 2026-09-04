import { Request, Response } from "express";
import z from "zod";
import { createProject, getFindingsForProject } from "../mcp/clickhouse/operations.js";
import type { ContinuityFinding, Project } from "../types/index.js";
import { handleError } from "../lib/handle-error.js";

const ProjectParamSchema = z.object({
  id: z.uuid(),
});

// universeId comes from the URL param (:id), not the body.
const CreateProjectBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["film", "series", "crossover", "other"]),
  canonTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

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
    return res.status(200).json({
      status: "success",
      data: {
        findings: projectFindings.map(serialiseFinding),
        finding_count: projectFindings.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}
