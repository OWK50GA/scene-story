import { Router } from "express";
import {
  analyzeStoryUnitHttp,
  askStoryUnitHttp,
  createStoryUnitHttp,
  fixFindingHttp,
  getIngestionStatusHttp,
  getIngestionStatusStreamHttp,
  getScenesForUnitHttp,
  getClaimsForUnitHttp,
  ingestFileHttp,
  upload,
} from "../controllers/units.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Story Units
 *   description: Individual films or episodes within a project
 */

/**
 * @swagger
 * /units:
 *   post:
 *     summary: Create a story unit
 *     description: >
 *       Creates a new story unit (film, episode, etc.) inside a project.
 *       After creation, upload the screenplay via POST /units/{id}/ingest
 *       to begin the extraction pipeline.
 *     tags: [Story Units]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - projectId
 *               - universeId
 *               - title
 *               - unitType
 *               - inUniversePeriod
 *               - releaseOrder
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *               universeId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *                 example: The Voss Cipher
 *               unitType:
 *                 type: string
 *                 enum: [film, episode, short, other]
 *               seasonNumber:
 *                 type: integer
 *                 nullable: true
 *               episodeNumber:
 *                 type: integer
 *                 nullable: true
 *               inUniversePeriod:
 *                 type: string
 *                 example: "1943"
 *                 description: >
 *                   Required. Human-readable in-universe time period.
 *                   Provide inUniverseDateStart/End as well for precise date ordering.
 *               inUniverseDateStart:
 *                 type: integer
 *                 nullable: true
 *                 example: 1943
 *                 description: In-universe year the story begins (integer).
 *               inUniverseDateEnd:
 *                 type: integer
 *                 nullable: true
 *               releaseOrder:
 *                 type: integer
 *                 minimum: 0
 *                 example: 1
 *                 description: Global release position within the universe (used for temporal ordering).
 *     responses:
 *       201:
 *         description: Story unit created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 story_unit:
 *                   $ref: '#/components/schemas/StoryUnit'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/", createStoryUnitHttp);

/**
 * @swagger
 * /units/{id}/ingest:
 *   post:
 *     summary: Upload a screenplay and start the ingestion pipeline
 *     description: >
 *       Accepts a screenplay file (PDF, plain text, or Fountain format) as
 *       multipart/form-data. Parses it into scenes, inserts them into ClickHouse,
 *       and starts the Story Analyst extraction pipeline asynchronously.
 *
 *       Returns 202 immediately. Use GET /units/{id}/status to poll for completion,
 *       or connect to GET /units/{id}/ingest-stream for real-time SSE progress.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Story unit ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Screenplay file. Accepted formats — PDF (.pdf), plain text (.txt), Fountain (.fountain). Max 10 MB.
 *     responses:
 *       202:
 *         description: Ingestion started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     story_unit_id:
 *                       type: string
 *                       format: uuid
 *                     scene_count:
 *                       type: integer
 *                       description: Number of scenes parsed from the file.
 *                     ingestion_status:
 *                       type: string
 *                       example: ingesting
 *       400:
 *         description: No file provided or unsupported file type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: File could not be parsed into scenes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/ingest", upload.single("file"), ingestFileHttp);

/**
 * @swagger
 * /units/{id}/status:
 *   get:
 *     summary: Get ingestion status for a story unit
 *     description: >
 *       Returns the current ingestion status, scene count, claim count, and
 *       the list of scene numbers that failed extraction. Use this to poll
 *       for completion when not using the SSE stream.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Ingestion status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     story_unit_id:
 *                       type: string
 *                       format: uuid
 *                     ingestion_status:
 *                       type: string
 *                       enum: [pending, ingesting, complete, failed]
 *                     scene_count:
 *                       type: integer
 *                     claim_count:
 *                       type: integer
 *                     failed_scenes:
 *                       type: array
 *                       items:
 *                         type: integer
 *                       description: Scene numbers that failed extraction.
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id/status", getIngestionStatusHttp);

/**
 * @swagger
 * /units/{id}/ingest-stream:
 *   get:
 *     summary: Stream ingestion progress via Server-Sent Events
 *     description: >
 *       Opens an SSE connection that emits events as the pipeline processes each scene.
 *       Connect after calling POST /units/{id}/ingest.
 *
 *       **Event types:**
 *
 *       `scene_complete` — emitted after each successfully processed scene.
 *       Data: `{ scene_number, claims_written, status: "complete" }`
 *
 *       `scene_failed` — emitted when a scene fails extraction after retry.
 *       Data: `{ scene_number, reason }`
 *
 *       `ingestion_complete` — emitted when all scenes are done. Stream closes after this.
 *       Data: `{ scene_count, claim_count, failed_scenes: number[], ingestion_status }`
 *
 *       If the unit has already finished ingestion, a synthetic `ingestion_complete`
 *       event is sent immediately and the stream closes.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: SSE stream opened
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-Sent Events stream
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Ingestion has not been started — POST to /ingest first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id/ingest-stream", getIngestionStatusStreamHttp);

/**
 * @swagger
 * /units/{id}/analyze:
 *   post:
 *     summary: Run the within-unit Guardian pass
 *     description: >
 *       Triggers the Continuity Guardian to compare claims within a single
 *       story unit. Detects property value conflicts between scenes of the
 *       same film or episode. Runs synchronously.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Analysis complete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/GuardianSummary'
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/analyze", analyzeStoryUnitHttp);
router.post("/:id/findings/:findingId/fix", fixFindingHttp);

/**
 * @swagger
 * /units/{id}/scenes:
 *   get:
 *     summary: List all scenes for a story unit
 *     description: >
 *       Returns every scene for the unit in scene-number order, including
 *       the raw screenplay text. Used by the screenplay reader to render
 *       the script with highlight anchoring.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Scenes for the unit
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     scenes:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Scene'
 *                     scene_count:
 *                       type: integer
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id/scenes", getScenesForUnitHttp);

/**
 * @swagger
 * /units/{id}/claims:
 *   get:
 *     summary: List all claims extracted from a story unit
 *     description: >
 *       Returns every claim written during ingestion for this unit, enriched
 *       with entity name, source_scene_number, confidence, source_type, and
 *       source_line. Used by the Story State screen with scene filtering.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Claims for the unit
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     claims:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Claim'
 *                     claim_count:
 *                       type: integer
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id/claims", getClaimsForUnitHttp);

/**
 * @swagger
 * /units/{id}/ask:
 *   post:
 *     summary: Ask the Audience Companion a question about this story unit
 *     description: >
 *       Answers a viewer question using only the structured story memory
 *       extracted from this story unit, up to and including the specified scene.
 *       The spoiler boundary is enforced at data retrieval time — facts from
 *       scenes beyond up_to_scene are never present in the answer context.
 *     tags: [Story Units]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Story unit ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - up_to_scene
 *             properties:
 *               question:
 *                 type: string
 *                 example: "Where is the Cipher Device?"
 *               up_to_scene:
 *                 type: integer
 *                 minimum: 0
 *                 example: 7
 *                 description: >
 *                   Spoiler boundary. Only facts from scenes 1 through this
 *                   number are included in the answer context.
 *     responses:
 *       200:
 *         description: Answer from the Audience Companion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                 epistemic_state:
 *                   type: string
 *                   enum: [known, partial, unknown]
 *                 facts_used:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Stable fact IDs from the story memory that support the answer.
 *                 not_known_aspects:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Aspects of the question that the story has not established yet.
 *                 boundary:
 *                   type: object
 *                   properties:
 *                     story_unit_id:
 *                       type: string
 *                       format: uuid
 *                     up_to_scene:
 *                       type: integer
 *                 boundary_enforced:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Story unit not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/ask", askStoryUnitHttp);

export default router;
