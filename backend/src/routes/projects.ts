import { Router } from "express";
import {
  createProjectHttp,
  getFindingsForProjectHttp,
  getStoryUnitsForProjectHttp,
  patchFindingStatusHttp,
  getProjectHttp,
  listProjectsHttp,
} from "../controllers/projects.js";
import { createStoryUnitHttp } from "../controllers/units.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Creative works (films, series) within a universe
 */

/**
 * @swagger
 * /projects/{id}/units:
 *   post:
 *     summary: Create a story unit within a project
 *     description: >
 *       Creates a new story unit (film, episode, etc.) inside the given project.
 *       After creation, upload the screenplay via POST /units/{id}/ingest
 *       to begin the extraction pipeline.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
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
router.get("/", listProjectsHttp);
router.get("/:id", getProjectHttp);
router.post("/:id/units", createStoryUnitHttp);

/**
 * @swagger
 * /projects/{id}/units:
 *   get:
 *     summary: List all story units in a project
 *     description: >
 *       Returns every story unit belonging to this project, ordered by
 *       release_order. Used to populate the unit selector in the UI.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Story units for the project
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
 *                     story_units:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/StoryUnit'
 *                     unit_count:
 *                       type: integer
 *       404:
 *         description: Project not found
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
router.get("/:id/units", getStoryUnitsForProjectHttp);

/**
 * @swagger
 * /projects/{id}/findings:
 *   get:
 *     summary: Get all continuity findings for a project
 *     description: >
 *       Returns all findings (both within-unit and cross-unit) that belong to
 *       this project. Each finding includes the resolved claim_a and claim_b
 *       objects so the frontend can render Claim A vs Claim B directly.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Findings for the project
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
 *                     findings:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ContinuityFinding'
 *                     finding_count:
 *                       type: integer
 *       400:
 *         description: Invalid project ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Project not found
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
router.get("/:id/findings", getFindingsForProjectHttp);

/**
 * @swagger
 * /projects/{id}/findings/{findingId}:
 *   patch:
 *     summary: Update the status of a continuity finding
 *     description: >
 *       Sets the status of a finding to open, marked_intentional, or resolved.
 *       Used by the Findings screen Mark intentional / Resolve actions.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
 *       - in: path
 *         name: findingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Finding ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, marked_intentional, resolved]
 *     responses:
 *       200:
 *         description: Finding status updated
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
 *                     finding_id:
 *                       type: string
 *                       format: uuid
 *                     status:
 *                       type: string
 *                       enum: [open, marked_intentional, resolved]
 *       400:
 *         description: Invalid ID or status value
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
router.patch("/:id/findings/:findingId", patchFindingStatusHttp);

export default router;
