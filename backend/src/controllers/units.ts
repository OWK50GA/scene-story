import { Request, Response } from "express";
import EventEmitter from "events";
import multer, { type FileFilterCallback } from "multer";
import type { Request as ExpressRequest } from "express";
import {
  createStoryUnit,
  CreateStoryUnitInput,
  getStoryUnit,
  getFailedSceneNumbers,
  insertScene,
  getScenesForUnit,
  getClaimsForUnit,
  getFinding,
  getClaim,
} from "../mcp/clickhouse/operations.js";
import {
  ContinuityFinding,
  MCPOperationError,
  Scene,
  Claim,
  StoryUnit,
} from "../types/index.js";
import { z } from "zod";
import { GuardianSummary } from "../agents/director/orchestration.js";
import { director } from "../agents/director/agent.js";
import { companionAgent } from "../agents/audience-companion/agent.js";
import { parseScreenplay, ParseError } from "../parser/index.js";
import { handleError } from "../lib/handle-error.js";
import { streamSceneFix } from "../agents/story-analyst/fix-scene.js";

// ---------------------------------------------------------------------------
// Per-unit pipeline emitter registry
//
// ingestFileHttp creates an EventEmitter, registers it here, and passes it
// to director.ingestStoryUnit(). The SSE handler looks it up by unit ID.
// The emitter is removed once ingestion_complete fires or the pipeline errors.
// ---------------------------------------------------------------------------

const pipelineEmitters = new Map<string, EventEmitter>();

// ---------------------------------------------------------------------------
// Multer — memory storage, 10 MB limit, screenplay file types only
// ---------------------------------------------------------------------------

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(
    _req: ExpressRequest,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) {
    const allowed = ["text/plain", "application/pdf"];
    const allowedExt = ["txt", "pdf", "fountain"];
    const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: ${file.mimetype}. Accepted: PDF, plain text, Fountain.`,
        ),
      );
    }
  },
});

const StoryUnitParamSchema = z.object({
  id: z.uuid(),
});

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
function serialiseGuardianSummary(s: GuardianSummary) {
  return {
    findings_count: s.findingsCount,
    findings: s.findings.map(serialiseFinding),
  };
}

export async function createStoryUnitHttp(req: Request, res: Response) {
  const parsed = CreateStoryUnitInput.safeParse(req.body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue.path[0])}: ${issue.message}`,
    });
  }

  const data = parsed.data;

  if (!data.inUniverseDateStart && !data.inUniverseDateEnd) {
    if (data.inUniversePeriod.length < 1) {
      return res.status(400).json({
        status: "error",
        message:
          "Provide precise dates for universe start and end, or a string period",
      });
    }
  }

  try {
    const storyUnit = await createStoryUnit(data);

    return res.status(201).json({
      status: "success",
      story_unit: serialiseStoryUnit(storyUnit),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function ingestFileHttp(req: Request, res: Response) {
  const parsedParam = StoryUnitParamSchema.safeParse(req.params);
  if (!parsedParam.success) {
    const issue = parsedParam.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({
      status: "error",
      message:
        "No file uploaded. Send the screenplay as multipart/form-data field 'file'.",
    });
  }

  const { id: storyUnitId } = parsedParam.data;

  // Guard: reject if an ingest is already active for this unit.
  if (pipelineEmitters.has(storyUnitId)) {
    return res.status(409).json({
      status: "error",
      message: "Ingestion is already in progress for this story unit.",
      code: "ingestion.already_running",
    });
  }

  // Also reject if the unit has already completed ingestion.
  let unit: StoryUnit;
  try {
    unit = await getStoryUnit(storyUnitId);
  } catch (err) {
    return handleError(err, res);
  }

  if (
    unit.ingestionStatus === "ingesting" ||
    unit.ingestionStatus === "complete"
  ) {
    return res.status(409).json({
      status: "error",
      message: `Cannot ingest: story unit is already in status "${unit.ingestionStatus}".`,
      code: "ingestion.invalid_status",
    });
  }

  // Parse the screenplay.
  let parsed;
  try {
    parsed = await parseScreenplay(file.buffer, {
      mimeType: file.mimetype,
      filename: file.originalname,
    });
  } catch (err) {
    if (err instanceof ParseError) {
      return res.status(422).json({
        status: "error",
        message: err.message,
        code: "parse.no_scenes_found",
      });
    }
    return handleError(err, res);
  }

  if (parsed.scenes.length === 0) {
    return res.status(422).json({
      status: "error",
      message:
        "The uploaded file parsed successfully but contains no scene headings.",
      code: "parse.no_scenes_found",
    });
  }

  // Insert all scenes into ClickHouse.
  // Do this before starting the pipeline so every scene row exists before
  // the Director begins processing (required by the sequential context model).
  try {
    for (const scene of parsed.scenes) {
      await insertScene({
        storyUnitId,
        projectId: unit.projectId,
        universeId: unit.universeId,
        sceneNumber: scene.sceneNumber,
        heading: scene.heading,
        rawText: scene.rawText,
      });
    }
  } catch (err) {
    return handleError(err, res);
  }

  // Kick off ingestion — fire and forget. The client polls /status or
  // connects to /ingest-stream for progress.
  const emitter = new EventEmitter();
  pipelineEmitters.set(storyUnitId, emitter);

  // Clean up registry and notify any connected SSE clients if the pipeline
  // throws unexpectedly. runIngestionPipeline never throws by contract, but
  // this guards against future changes and prevents unhandled rejections.
  const pipeline = director.ingestStoryUnit(storyUnitId, emitter);
  pipeline
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      emitter.emit("ingestion_failed", { message });
    })
    .finally(() => pipelineEmitters.delete(storyUnitId));

  return res.status(202).json({
    status: "success",
    data: {
      story_unit_id: storyUnitId,
      scene_count: parsed.scenes.length,
      ingestion_status: "ingesting",
    },
  });
}

export async function getIngestionStatusHttp(req: Request, res: Response) {
  const parsed = StoryUnitParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const unit = await getStoryUnit(parsed.data.id);
    const failedScenes = await getFailedSceneNumbers(parsed.data.id);

    return res.status(200).json({
      status: "success",
      data: {
        story_unit_id: unit.storyUnitId,
        ingestion_status: unit.ingestionStatus,
        scene_count: unit.sceneCount,
        claim_count: unit.claimCount,
        failed_scenes: failedScenes,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function getIngestionStatusStreamHttp(
  req: Request,
  res: Response,
) {
  const parsed = StoryUnitParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  const { id: storyUnitId } = parsed.data;

  // Helper: write a single SSE event to the response stream.
  function writeEvent(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Check whether the unit is already in a terminal state.
  // If so, synthesise a final event and close — no need to attach to the emitter.
  let unit: StoryUnit;
  try {
    unit = await getStoryUnit(storyUnitId);
  } catch (err) {
    if (err instanceof MCPOperationError && err.code.endsWith("not_found")) {
      return res
        .status(404)
        .json({ status: "error", message: err.message, code: err.code });
    }
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }

  if (
    unit.ingestionStatus === "complete" ||
    unit.ingestionStatus === "failed"
  ) {
    const failedScenes = await getFailedSceneNumbers(storyUnitId).catch(
      () => [] as number[],
    );
    // Set SSE headers then immediately send the terminal event and close.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    writeEvent("ingestion_complete", {
      scene_count: unit.sceneCount,
      claim_count: unit.claimCount,
      failed_scenes: failedScenes,
      ingestion_status: unit.ingestionStatus,
    });
    return res.end();
  }

  // Check whether an active pipeline emitter exists for this unit.
  const emitter = pipelineEmitters.get(storyUnitId);
  if (!emitter) {
    // Unit exists but ingestion hasn't started yet (status: "pending").
    return res.status(409).json({
      status: "error",
      message:
        "Ingestion has not been started for this story unit. POST to /ingest first.",
      code: "ingestion.not_started",
    });
  }

  // Capture as a narrowed const so nested functions can reference it safely.
  const activeEmitter: EventEmitter = emitter;

  // ── Open the SSE stream ───────────────────────────────────────────────────

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial comment so the client knows the connection is live.
  res.write(": connected\n\n");

  // ── Wire emitter events to the response stream ────────────────────────────

  function onSceneComplete(data: unknown) {
    writeEvent("scene_complete", data);
  }

  function onSceneFailed(data: unknown) {
    writeEvent("scene_failed", data);
  }

  function onIngestionComplete(data: unknown) {
    writeEvent("ingestion_complete", data);
    cleanup();
    res.end();
  }

  function onIngestionFailed(data: unknown) {
    writeEvent("ingestion_failed", data);
    cleanup();
    res.end();
  }

  function cleanup() {
    activeEmitter.off("scene_complete", onSceneComplete);
    activeEmitter.off("scene_failed", onSceneFailed);
    activeEmitter.off("ingestion_complete", onIngestionComplete);
    activeEmitter.off("ingestion_failed", onIngestionFailed);
  }

  emitter.on("scene_complete", onSceneComplete);
  emitter.on("scene_failed", onSceneFailed);
  emitter.on("ingestion_complete", onIngestionComplete);
  emitter.on("ingestion_failed", onIngestionFailed);

  // Clean up listeners if the client disconnects before ingestion finishes.
  req.on("close", cleanup);
}

export async function analyzeStoryUnitHttp(req: Request, res: Response) {
  const parsed = StoryUnitParamSchema.safeParse(req.params);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue.path[0])}: ${issue.message}`,
    });
  }

  try {
    const analysis = await director.analyzeUnit(parsed.data.id);

    return res.status(200).json({
      status: "success",
      data: serialiseGuardianSummary(analysis),
    });
  } catch (err) {
    return handleError(err, res);
  }
}

// ---------------------------------------------------------------------------
// Scene serialiser
// ---------------------------------------------------------------------------

function serialiseScene(s: Scene) {
  return {
    scene_id: s.sceneId,
    story_unit_id: s.storyUnitId,
    scene_number: s.sceneNumber,
    heading: s.heading,
    raw_text: s.rawText,
    ingestion_status: s.ingestionStatus,
  };
}

// ---------------------------------------------------------------------------
// Claim serialiser — full enriched shape for the Story State screen
// ---------------------------------------------------------------------------

function serialiseClaim(c: Claim & { entityName?: string }) {
  return {
    claim_id: c.claimId,
    universe_entity_id: c.universeEntityId,
    entity_name: c.entityName ?? null,
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

// ---------------------------------------------------------------------------
// GET /units/:id/scenes
// ---------------------------------------------------------------------------

export async function getScenesForUnitHttp(req: Request, res: Response) {
  const parsed = StoryUnitParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    // Verify unit exists first so we return 404 rather than an empty array.
    await getStoryUnit(parsed.data.id);
    const scenes = await getScenesForUnit(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: {
        scenes: scenes.map(serialiseScene),
        scene_count: scenes.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

// ---------------------------------------------------------------------------
// GET /units/:id/claims
// ---------------------------------------------------------------------------

export async function getClaimsForUnitHttp(req: Request, res: Response) {
  const parsed = StoryUnitParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    await getStoryUnit(parsed.data.id);
    const claims = await getClaimsForUnit(parsed.data.id);
    return res.status(200).json({
      status: "success",
      data: {
        claims: claims.map(serialiseClaim),
        claim_count: claims.length,
      },
    });
  } catch (err) {
    return handleError(err, res);
  }
}

// ---------------------------------------------------------------------------
// POST /units/:id/ask
// ---------------------------------------------------------------------------

const AskStoryUnitBodySchema = z.object({
  question: z.string().min(1, "question must not be empty"),
  up_to_scene: z.number().int().nonnegative(),
});

export async function askStoryUnitHttp(req: Request, res: Response) {
  const parsedParam = StoryUnitParamSchema.safeParse(req.params);
  if (!parsedParam.success) {
    const issue = parsedParam.error.issues[0];
    return res.status(400).json({
      error: `${String(issue?.path[0])}: ${issue?.message}`,
      code: "validation.invalid_param",
    });
  }

  const parsedBody = AskStoryUnitBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    const issue = parsedBody.error.issues[0];
    return res.status(400).json({
      error: `${String(issue?.path[0])}: ${issue?.message}`,
      code: "validation.invalid_body",
    });
  }

  const { id: storyUnitId } = parsedParam.data;
  const { question, up_to_scene: upToScene } = parsedBody.data;

  try {
    // Verify the unit exists before calling the Companion.
    await getStoryUnit(storyUnitId);

    const answer = await companionAgent.askUnit(storyUnitId, upToScene, question);

    return res.status(200).json({
      answer: answer.answer,
      epistemic_state: answer.epistemicState,
      facts_used: answer.factsUsed,
      not_known_aspects: answer.notKnownAspects,
      boundary: {
        story_unit_id: storyUnitId,
        up_to_scene: upToScene,
      },
      boundary_enforced: answer.boundaryEnforced,
    });
  } catch (err) {
    return handleError(err, res);
  }
}


const FixFindingParamSchema = z.object({
  id: z.uuid(),
  findingId: z.uuid(),
});

function writeSse(res: Response, payload: Record<string, unknown>) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * POST /api/units/:id/findings/:findingId/fix
 *
 * Streams an AI-proposed rewrite of the scene that establishes the flagged
 * contradiction. Preview only: nothing is persisted. The client reconciles
 * the proposal against the current scene text and, later, the findings
 * status lifecycle.
 */
export async function fixFindingHttp(req: Request, res: Response) {
  const parsed = FixFindingParamSchema.safeParse(req.params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      status: "error",
      message: `${String(issue?.path[0])}: ${issue?.message}`,
    });
  }

  try {
    const unit = await getStoryUnit(parsed.data.id);
    const finding = await getFinding(parsed.data.findingId);

    if (finding.storyUnitIdA !== unit.storyUnitId) {
      return res.status(404).json({
        status: "error",
        message: `Finding ${parsed.data.findingId} not found for this unit`,
        code: "finding.not_found",
      });
    }

    const [claimA, claimB] = await Promise.all([
      getClaim(finding.claimAId),
      getClaim(finding.claimBId),
    ]);

    const sceneNumber =
      claimB.sourceSceneNumber !== claimA.sourceSceneNumber
        ? claimB.sourceSceneNumber
        : claimA.sourceSceneNumber;

    const scenes = await getScenesForUnit(unit.storyUnitId);
    const scene = scenes.find((s) => s.sceneNumber === sceneNumber);
    if (!scene) {
      return res.status(422).json({
        status: "error",
        message: `Scene ${sceneNumber} was not found for this unit`,
        code: "fix.scene_not_found",
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    writeSse(res, {
      type: "meta",
      unit_id: unit.storyUnitId,
      unit_title: unit.title,
      finding_id: finding.findingId,
      scene: sceneNumber,
      claims: [
        { scene: claimA.sourceSceneNumber, property: claimA.property, value: claimA.value },
        { scene: claimB.sourceSceneNumber, property: claimB.property, value: claimB.value },
      ],
    });

    let newText = "";
    try {
      for await (const delta of streamSceneFix({
        unit,
        finding,
        claimA,
        claimB,
        sceneNumber,
        heading: scene.heading,
        rawText: scene.rawText,
      })) {
        if (res.writableEnded) break;
        newText += delta;
        writeSse(res, { type: "delta", text: delta });
      }
      writeSse(res, {
        type: "done",
        scene: sceneNumber,
        oldText: scene.rawText,
        newText,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeSse(res, { type: "error", message });
    } finally {
      res.end();
    }
  } catch (err) {
    return handleError(err, res);
  }
}
