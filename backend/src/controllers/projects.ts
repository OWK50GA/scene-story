import { Request, Response } from "express";
import z from "zod";
import { createProject, getFindingsForProject } from "../mcp/clickhouse/operations.js";
import { ContinuityFinding, MCPOperationError, Project } from "../types/index.js";

const ProjectParamSchema = z.object({
    id: z.uuid(),
})

const CreateProjectInput = z.object({
  universeId: z.uuid(),
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

function serializeProject(p: Project) {
    return {
        project_id: p.projectId,
        universe_id: p.universeId,
        name: p.name,
        type: p.type,
        canon_tier: p.canonTier,
        created_at: p.createdAt,
    }
}

function handleError(err: unknown, res: Response) {
  if (err instanceof MCPOperationError) {
    const status = err.code.endsWith("not_found") ? 404 : 400;
    return res.status(status).json({
      status: "error",
      message: err.message,
      code: err.code,
    });
  }
  return res.status(500).json({
    status: "error",
    message: "Internal Server Error",
  });
}

// TODO: implement in Task 13 — create a project within a universe.
export async function createProjectHttp(req: Request, res: Response) {
    const parsed = CreateProjectInput.safeParse(req.body)

    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return res.status(400).json({
        status: "error",
        message: `${String(issue?.path[0])}: ${issue?.message}`,
        });
    }

    const input = parsed.data;

    try {
        const project = await createProject(input);
        return res.status(201).json({
            status: "success",
            ...serializeProject(project),
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
            message: `${String(issue.path[0])}: ${issue.message}`,
        });
    }

    const { id } = parsed.data;

    try {
        const projectFindings = await getFindingsForProject(id);

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
