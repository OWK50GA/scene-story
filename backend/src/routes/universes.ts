import { Router } from "express";
import {
  analyzeUniverseHttp,
  askAboutUniverseHttp,
  createUniverseHttp,
  getUniverseFindingsHttp,
  getUniverseHttp,
  getWorldStateHttp,
  listUniversesHttp,
} from "../controllers/universes.js";
import { createProjectHttp } from "../controllers/projects.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Universes
 *   description: Shared fictional worlds and their state
 */

/**
 * @swagger
 * /universes:
 *   post:
 *     summary: Create a new universe
 *     tags: [Universes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: The Voss Universe
 *               description:
 *                 type: string
 *                 example: A world of wartime espionage and its modern legacy.
 *     responses:
 *       201:
 *         description: Universe created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: success
 *                 - $ref: '#/components/schemas/Universe'
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
router.post("/", createUniverseHttp);

/**
 * @swagger
 * /universes:
 *   get:
 *     summary: List all universes
 *     tags: [Universes]
 *     responses:
 *       200:
 *         description: List of universes
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
 *                     universes:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Universe'
 *                     universe_count:
 *                       type: integer
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/", listUniversesHttp);

/**
 * @swagger
 * /universes/{id}:
 *   get:
 *     summary: Get a universe by ID
 *     tags: [Universes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Universe found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/Universe'
 *       404:
 *         description: Universe not found
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
router.get("/:id", getUniverseHttp);

/**
 * @swagger
 * /universes/{id}/world-state:
 *   get:
 *     summary: Get the current world state of a universe
 *     description: >
 *       Returns all active (non-superseded) claims across all entities in the universe,
 *       grouped as a flat list of property–value pairs with their source unit and period.
 *     tags: [Universes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Current world state
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
 *                     entries:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/WorldStateEntry'
 *                     entry_count:
 *                       type: integer
 *       404:
 *         description: Universe not found
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
router.get("/:id/world-state", getWorldStateHttp);

/**
 * @swagger
 * /universes/{id}/analyze:
 *   post:
 *     summary: Run the cross-unit Guardian pass for a universe
 *     description: >
 *       Triggers the Continuity Guardian to compare claims across all story units
 *       in the universe. Detects property value conflicts that span multiple films
 *       or episodes. Runs synchronously — response is returned when analysis completes.
 *     tags: [Universes]
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
 *         description: Universe not found
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
router.post("/:id/analyze", analyzeUniverseHttp);

/**
 * @swagger
 * /universes/{id}/ask:
 *   post:
 *     summary: Ask a question about the universe within a spoiler boundary
 *     description: >
 *       Delegates the question to the Audience Companion. Only claims within
 *       the viewer's spoiler boundary are used to construct the answer — the
 *       boundary is enforced at the SQL level before any LLM processing.
 *     tags: [Universes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - boundary
 *             properties:
 *               question:
 *                 type: string
 *                 example: Where was the Cipher Device last seen?
 *               boundary:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/SpoilerBoundaryEntry'
 *     responses:
 *       200:
 *         description: Answer within spoiler boundary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/CompanionAnswer'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Universe not found
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
router.post("/:id/ask", askAboutUniverseHttp);

/**
 * @swagger
 * /universes/{id}/findings:
 *   get:
 *     summary: Get all cross-unit continuity findings for a universe
 *     description: >
 *       Returns findings with scope=cross_unit detected by the Guardian.
 *       Within-unit findings are scoped to individual projects and story units.
 *     tags: [Universes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Cross-unit findings
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
 *       404:
 *         description: Universe not found
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
router.get("/:id/findings", getUniverseFindingsHttp);

/**
 * @swagger
 * /universes/{id}/projects:
 *   post:
 *     summary: Create a project within a universe
 *     tags: [Universes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Universe ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - canonTier
 *             properties:
 *               name:
 *                 type: string
 *                 example: The Voss Cipher
 *               type:
 *                 type: string
 *                 enum: [film, series, crossover, other]
 *               canonTier:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: "1 = primary canon, 2 = secondary, 3 = non-canon"
 *     responses:
 *       201:
 *         description: Project created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/Project'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Universe not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Not yet implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/projects", createProjectHttp);

export default router;
