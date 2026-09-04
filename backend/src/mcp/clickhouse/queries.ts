// =============================================================================
// DDL — one CREATE TABLE IF NOT EXISTS per table, in dependency order.
// Run these via scripts/migrate.ts, not at server startup.
// =============================================================================

export const DDL = {
  universes: `
    CREATE TABLE IF NOT EXISTS lmm.universes (
      universe_id   String,
      name          String,
      description   String,
      created_at    DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY (universe_id)
  `,

  projects: `
    CREATE TABLE IF NOT EXISTS lmm.projects (
      project_id    String,
      universe_id   String,
      name          String,
      type          Enum8('film'=0, 'series'=1, 'crossover'=2, 'other'=3),
      canon_tier    UInt8,
      created_at    DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, project_id)
  `,

  story_units: `
    CREATE TABLE IF NOT EXISTS lmm.story_units (
      story_unit_id           String,
      project_id              String,
      universe_id             String,
      title                   String,
      unit_type               Enum8('film'=0, 'episode'=1, 'short'=2, 'other'=3),
      season_number           Nullable(UInt16),
      episode_number          Nullable(UInt16),
      in_universe_period      String,
      in_universe_date_start  Nullable(Int32),
      in_universe_date_end    Nullable(Int32),
      release_order           UInt32,
      ingestion_status        Enum8('pending'=0, 'ingesting'=1, 'complete'=2, 'failed'=3),
      scene_count             UInt16 DEFAULT 0,
      claim_count             UInt32 DEFAULT 0
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, project_id, release_order)
  `,

  universe_entities: `
    CREATE TABLE IF NOT EXISTS lmm.universe_entities (
      entity_id                  String,
      universe_id                String,
      canonical_name             String,
      entity_type                Enum8('character'=0, 'object'=1, 'location'=2, 'faction'=3, 'concept'=4),
      parent_entity_id           Nullable(String),
      description                String,
      first_appearance_unit_id   Nullable(String),
      created_at                 DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, entity_id)
  `,

  temporal_relations: `
    CREATE TABLE IF NOT EXISTS lmm.temporal_relations (
      unit_a_id     String,
      unit_b_id     String,
      universe_id   String,
      relation      Enum8('before'=0, 'after'=1, 'overlapping'=2, 'indeterminate'=3),
      reasoning     String,
      created_at    DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, unit_a_id, unit_b_id)
  `,

  scenes: `
    CREATE TABLE IF NOT EXISTS lmm.scenes (
      scene_id          String,
      story_unit_id     String,
      project_id        String,
      universe_id       String,
      scene_number      UInt16,
      heading           String,
      raw_text          String,
      summary           String,
      ingestion_status  Enum8('pending'=0, 'complete'=1, 'failed'=2)
    ) ENGINE = MergeTree()
    ORDER BY (story_unit_id, scene_number)
  `,

  claims: `
    CREATE TABLE IF NOT EXISTS lmm.claims (
      claim_id                  String,
      universe_entity_id        String,
      universe_id               String,
      project_id                String,
      story_unit_id             String,
      source_scene_number       UInt16,
      property                  String,
      value                     String,
      in_universe_period        String,
      in_universe_date_start    Nullable(Int32),
      in_universe_date_end      Nullable(Int32),
      valid_from_scene          UInt16,
      valid_to_scene            Nullable(UInt16),
      source_type               Enum8('explicit'=0, 'implied'=1, 'inferred'=2),
      confidence                Float32,
      confidence_rationale      String,
      raw_extraction            String,
      source_line               String,
      canon_tier                UInt8,
      superseded_by_canon       UInt8 DEFAULT 0,
      superseding_claim_id      Nullable(String)
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, universe_entity_id, property, story_unit_id)
  `,

  events: `
    CREATE TABLE IF NOT EXISTS lmm.events (
      event_id              String,
      story_unit_id         String,
      project_id            String,
      universe_id           String,
      scene_number          UInt16,
      subject_entity_id     String,
      action                String,
      object_entity_id      Nullable(String),
      description           String,
      in_universe_period    String
    ) ENGINE = MergeTree()
    ORDER BY (story_unit_id, scene_number)
  `,

  continuity_findings: `
    CREATE TABLE IF NOT EXISTS lmm.continuity_findings (
      finding_id             String,
      universe_id            String,
      project_id             String,
      story_unit_id_a        String,
      story_unit_id_b        String,
      claim_a_id             String,
      claim_b_id             String,
      conflict_type          Enum8('confirmed'=0, 'ambiguous'=1),
      severity               Enum8('high'=0, 'medium'=1, 'low'=2),
      scope                  Enum8('within_unit'=0, 'cross_unit'=1),
      explanation            String,
      resolution_suggestion  String,
      status                 Enum8('open'=0, 'marked_intentional'=1, 'resolved'=2)
    ) ENGINE = MergeTree()
    ORDER BY (universe_id, finding_id)
  `,
} as const;

// Ordered list for the migration script — dependencies first.
export const DDL_TABLES_IN_ORDER = [
  DDL.universes,
  DDL.projects,
  DDL.story_units,
  DDL.universe_entities,
  DDL.temporal_relations,
  DDL.scenes,
  DDL.claims,
  DDL.events,
  DDL.continuity_findings,
] as const;

// =============================================================================
// Parameterised query strings
//
// All runtime queries live here as exported constants.
// No query strings exist anywhere else in the codebase.
// Parameters use ClickHouse native binding syntax: {param_name: Type}
// =============================================================================

// --- Universes ---------------------------------------------------------------

export const Q = {
  // Universes
  INSERT_UNIVERSE: `
    INSERT INTO lmm.universes (universe_id, name, description, created_at)
    VALUES ({universe_id: String}, {name: String}, {description: String}, now())
  `,

  SELECT_ALL_UNIVERSES: `
    SELECT * FROM lmm.universes ORDER BY created_at DESC
  `,

  SELECT_UNIVERSE: `
    SELECT * FROM lmm.universes
    WHERE universe_id = {universe_id: String}
    LIMIT 1
  `,

  // Projects
  INSERT_PROJECT: `
    INSERT INTO lmm.projects (project_id, universe_id, name, type, canon_tier, created_at)
    VALUES (
      {project_id: String}, {universe_id: String}, {name: String},
      {type: String}, {canon_tier: UInt8}, now()
    )
  `,

  SELECT_PROJECT: `
    SELECT * FROM lmm.projects
    WHERE project_id = {project_id: String}
    LIMIT 1
  `,

  // Story Units
  INSERT_STORY_UNIT: `
    INSERT INTO lmm.story_units (
      story_unit_id, project_id, universe_id, title, unit_type,
      season_number, episode_number,
      in_universe_period, in_universe_date_start, in_universe_date_end,
      release_order, ingestion_status, scene_count, claim_count
    ) VALUES (
      {story_unit_id: String}, {project_id: String}, {universe_id: String},
      {title: String}, {unit_type: String},
      {season_number: Nullable(UInt16)}, {episode_number: Nullable(UInt16)},
      {in_universe_period: String},
      {in_universe_date_start: Nullable(Int32)}, {in_universe_date_end: Nullable(Int32)},
      {release_order: UInt32}, 'pending', 0, 0
    )
  `,

  SELECT_STORY_UNIT: `
    SELECT * FROM lmm.story_units
    WHERE story_unit_id = {story_unit_id: String}
    LIMIT 1
  `,

  SELECT_STORY_UNITS_FOR_UNIVERSE: `
    SELECT * FROM lmm.story_units
    WHERE universe_id = {universe_id: String}
    ORDER BY release_order
  `,

  UPDATE_STORY_UNIT_STATUS: `
    ALTER TABLE lmm.story_units
    UPDATE ingestion_status = {status: String}
    WHERE story_unit_id = {story_unit_id: String}
  `,

  UPDATE_STORY_UNIT_COUNTS: `
    ALTER TABLE lmm.story_units
    UPDATE scene_count = {scene_count: UInt16}, claim_count = {claim_count: UInt32}
    WHERE story_unit_id = {story_unit_id: String}
  `,

  // Universe Entities
  INSERT_UNIVERSE_ENTITY: `
    INSERT INTO lmm.universe_entities (
      entity_id, universe_id, canonical_name, entity_type,
      parent_entity_id, description, first_appearance_unit_id, created_at
    ) VALUES (
      {entity_id: String}, {universe_id: String}, {canonical_name: String},
      {entity_type: String}, {parent_entity_id: Nullable(String)},
      {description: String}, {first_appearance_unit_id: Nullable(String)}, now()
    )
  `,

  SELECT_ENTITY: `
    SELECT * FROM lmm.universe_entities
    WHERE entity_id = {entity_id: String}
    LIMIT 1
  `,

  SELECT_ENTITIES_BY_UNIVERSE: `
    SELECT * FROM lmm.universe_entities
    WHERE universe_id = {universe_id: String}
    ORDER BY canonical_name
  `,

  // Name resolution — exact match
  SELECT_ENTITY_BY_NAME_EXACT: `
    SELECT * FROM lmm.universe_entities
    WHERE universe_id = {universe_id: String}
      AND canonical_name = {name: String}
    LIMIT 1
  `,

  // Name resolution — case-insensitive match
  SELECT_ENTITY_BY_NAME_ILIKE: `
    SELECT * FROM lmm.universe_entities
    WHERE universe_id = {universe_id: String}
      AND lower(canonical_name) = lower({name: String})
    LIMIT 1
  `,

  // Temporal Relations
  INSERT_TEMPORAL_RELATION: `
    INSERT INTO lmm.temporal_relations (
      unit_a_id, unit_b_id, universe_id, relation, reasoning, created_at
    ) VALUES (
      {unit_a_id: String}, {unit_b_id: String}, {universe_id: String},
      {relation: String}, {reasoning: String}, now()
    )
  `,

  SELECT_TEMPORAL_RELATION: `
    SELECT * FROM lmm.temporal_relations
    WHERE universe_id = {universe_id: String}
      AND unit_a_id = {unit_a_id: String}
      AND unit_b_id = {unit_b_id: String}
    LIMIT 1
  `,

  // Scenes
  INSERT_SCENE: `
    INSERT INTO lmm.scenes (
      scene_id, story_unit_id, project_id, universe_id,
      scene_number, heading, raw_text, summary, ingestion_status
    ) VALUES (
      {scene_id: String}, {story_unit_id: String}, {project_id: String},
      {universe_id: String}, {scene_number: UInt16}, {heading: String},
      {raw_text: String}, '', 'pending'
    )
  `,

  SELECT_SCENES_FOR_UNIT: `
    SELECT * FROM lmm.scenes
    WHERE story_unit_id = {story_unit_id: String}
    ORDER BY scene_number
  `,

  SELECT_SCENE: `
    SELECT * FROM lmm.scenes
    WHERE story_unit_id = {story_unit_id: String}
      AND scene_number = {scene_number: UInt16}
    LIMIT 1
  `,

  SELECT_FAILED_SCENES: `
    SELECT scene_number FROM lmm.scenes
    WHERE story_unit_id = {story_unit_id: String}
      AND ingestion_status = 'failed'
    ORDER BY scene_number
  `,

  UPDATE_SCENE_STATUS: `
    ALTER TABLE lmm.scenes
    UPDATE ingestion_status = {status: String}
    WHERE story_unit_id = {story_unit_id: String}
      AND scene_number = {scene_number: UInt16}
  `,

  // Claims
  INSERT_CLAIM: `
    INSERT INTO lmm.claims (
      claim_id, universe_entity_id, universe_id, project_id, story_unit_id,
      source_scene_number, property, value,
      in_universe_period, in_universe_date_start, in_universe_date_end,
      valid_from_scene, valid_to_scene,
      source_type, confidence, confidence_rationale,
      raw_extraction, source_line, canon_tier,
      superseded_by_canon, superseding_claim_id
    ) VALUES (
      {claim_id: String}, {universe_entity_id: String}, {universe_id: String},
      {project_id: String}, {story_unit_id: String},
      {source_scene_number: UInt16}, {property: String}, {value: String},
      {in_universe_period: String},
      {in_universe_date_start: Nullable(Int32)}, {in_universe_date_end: Nullable(Int32)},
      {valid_from_scene: UInt16}, {valid_to_scene: Nullable(UInt16)},
      {source_type: String}, {confidence: Float32}, {confidence_rationale: String},
      {raw_extraction: String}, {source_line: String}, {canon_tier: UInt8},
      0, NULL
    )
  `,

  // Active claims for a list of entities as of a given scene — used for context injection.
  SELECT_ACTIVE_CLAIMS_FOR_ENTITIES: `
    SELECT
      c.claim_id, c.universe_entity_id, c.property, c.value,
      c.source_type, c.confidence, c.valid_from_scene,
      e.canonical_name AS entity_name,
      e.parent_entity_id
    FROM lmm.claims c
    JOIN lmm.universe_entities e ON c.universe_entity_id = e.entity_id
    WHERE c.story_unit_id  = {story_unit_id: String}
      AND c.universe_entity_id IN ({entity_ids: Array(String)})
      AND c.source_scene_number <= {up_to_scene: UInt16}
      AND c.valid_to_scene IS NULL
      AND c.superseded_by_canon = 0
    ORDER BY c.valid_from_scene
  `,

  // All claims for an entity across all story units — entity history view.
  // su columns that share names with claim columns are aliased to avoid collisions.
  SELECT_ENTITY_HISTORY: `
    SELECT
      c.*,
      su.title AS story_unit_title,
      su.in_universe_period    AS su_in_universe_period,
      su.in_universe_date_start AS su_in_universe_date_start,
      su.release_order
    FROM lmm.claims c
    JOIN lmm.story_units su ON c.story_unit_id = su.story_unit_id
    WHERE c.universe_entity_id = {entity_id: String}
    ORDER BY su.in_universe_date_start NULLS LAST, su.release_order, c.valid_from_scene
  `,

  // Within-unit conflict detection — pairs of active claims on the same entity+property
  // within one story unit with different values.
  SELECT_WITHIN_UNIT_CONFLICTS: `
    SELECT
      a.claim_id          AS claim_a_id,
      b.claim_id          AS claim_b_id,
      a.universe_entity_id,
      a.property,
      a.value             AS value_a,
      b.value             AS value_b,
      a.valid_from_scene  AS scene_a,
      b.valid_from_scene  AS scene_b,
      a.confidence        AS confidence_a,
      b.confidence        AS confidence_b
    FROM lmm.claims a
    JOIN lmm.claims b
      ON  a.universe_entity_id = b.universe_entity_id
      AND a.property           = b.property
      AND a.story_unit_id      = b.story_unit_id
      AND a.claim_id           < b.claim_id
      AND a.value              != b.value
    WHERE a.story_unit_id    = {story_unit_id: String}
      AND a.valid_to_scene   IS NULL
      AND b.valid_to_scene   IS NULL
      AND a.superseded_by_canon = 0
      AND b.superseded_by_canon = 0
    ORDER BY a.valid_from_scene
  `,

  // Cross-unit conflict detection — pairs of active claims on the same entity+property
  // across different story units in the same universe with different values.
  SELECT_CROSS_UNIT_CONFLICTS: `
    SELECT
      a.claim_id                AS claim_a_id,
      b.claim_id                AS claim_b_id,
      a.universe_entity_id,
      a.property,
      a.value                   AS value_a,
      b.value                   AS value_b,
      a.story_unit_id           AS unit_a_id,
      b.story_unit_id           AS unit_b_id,
      a.in_universe_date_start  AS date_a,
      b.in_universe_date_start  AS date_b,
      a.in_universe_period      AS period_a,
      b.in_universe_period      AS period_b,
      a.canon_tier              AS tier_a,
      b.canon_tier              AS tier_b,
      a.confidence              AS confidence_a,
      b.confidence              AS confidence_b
    FROM lmm.claims a
    JOIN lmm.claims b
      ON  a.universe_entity_id = b.universe_entity_id
      AND a.property           = b.property
      AND a.story_unit_id      != b.story_unit_id
      AND a.claim_id           < b.claim_id
      AND a.value              != b.value
    WHERE a.universe_id       = {universe_id: String}
      AND a.valid_to_scene    IS NULL
      AND b.valid_to_scene    IS NULL
      AND a.superseded_by_canon = 0
      AND b.superseded_by_canon = 0
    ORDER BY a.in_universe_date_start NULLS LAST
  `,

  // Spoiler boundary query — only claims within the viewer's watched boundary.
  // The WHERE clause for each (story_unit_id, up_to_scene) pair is built
  // dynamically by the operations layer and injected as a pre-validated string.
  SELECT_COMPANION_FACTS_BASE: `
    SELECT
      e.canonical_name    AS entity_name,
      c.property,
      c.value,
      c.valid_from_scene,
      c.source_scene_number,
      c.in_universe_period,
      c.confidence,
      su.title            AS source_unit_title
    FROM lmm.claims c
    JOIN lmm.universe_entities e  ON c.universe_entity_id = e.entity_id
    JOIN lmm.story_units su       ON c.story_unit_id = su.story_unit_id
    WHERE c.universe_id = {universe_id: String}
      AND c.valid_to_scene IS NULL
      AND c.superseded_by_canon = 0
      AND (e.first_appearance_unit_id IN ({watched_unit_ids: Array(String)})
           OR e.first_appearance_unit_id IS NULL)
      AND ({boundary_filter})
    ORDER BY su.in_universe_date_start NULLS LAST, c.valid_from_scene
  `,

  // World state — canonical active claims for a universe, highest canon tier wins
  // on property collisions. Used by get_world_state and future Story Writer agent.
  SELECT_WORLD_STATE: `
    SELECT
      e.entity_id,
      e.canonical_name,
      c.property,
      c.value,
      c.canon_tier,
      c.in_universe_period,
      su.title AS source_unit_title
    FROM lmm.claims c
    JOIN lmm.universe_entities e ON c.universe_entity_id = e.entity_id
    JOIN lmm.story_units su      ON c.story_unit_id = su.story_unit_id
    WHERE c.universe_id         = {universe_id: String}
      AND c.valid_to_scene      IS NULL
      AND c.superseded_by_canon = 0
    ORDER BY c.canon_tier ASC, su.in_universe_date_start NULLS LAST
  `,

  // Guardian mutations — narrow, named operations so nothing else can
  // accidentally mutate these two fields.
  UPDATE_CLAIM_VALID_TO: `
    ALTER TABLE lmm.claims
    UPDATE valid_to_scene = {valid_to_scene: UInt16}
    WHERE claim_id = {claim_id: String}
  `,

  UPDATE_CLAIM_SUPERSEDED: `
    ALTER TABLE lmm.claims
    UPDATE
      superseded_by_canon  = 1,
      superseding_claim_id = {superseding_claim_id: String}
    WHERE claim_id = {claim_id: String}
  `,

  // Events
  INSERT_EVENT: `
    INSERT INTO lmm.events (
      event_id, story_unit_id, project_id, universe_id,
      scene_number, subject_entity_id, action,
      object_entity_id, description, in_universe_period
    ) VALUES (
      {event_id: String}, {story_unit_id: String}, {project_id: String},
      {universe_id: String}, {scene_number: UInt16},
      {subject_entity_id: String}, {action: String},
      {object_entity_id: Nullable(String)}, {description: String},
      {in_universe_period: String}
    )
  `,

  // Events between two scene numbers — fetched by the Guardian to look for
  // transfer/carry events that would explain a claim change.
  SELECT_EVENTS_BETWEEN_SCENES: `
    SELECT
      ev.*,
      e_sub.canonical_name AS subject_name,
      e_obj.canonical_name AS object_name
    FROM lmm.events ev
    JOIN lmm.universe_entities e_sub ON ev.subject_entity_id = e_sub.entity_id
    LEFT JOIN lmm.universe_entities e_obj ON ev.object_entity_id = e_obj.entity_id
    WHERE ev.story_unit_id  = {story_unit_id: String}
      AND ev.scene_number  >= {from_scene: UInt16}
      AND ev.scene_number  <= {to_scene: UInt16}
    ORDER BY ev.scene_number
  `,

  // Continuity Findings
  INSERT_FINDING: `
    INSERT INTO lmm.continuity_findings (
      finding_id, universe_id, project_id,
      story_unit_id_a, story_unit_id_b,
      claim_a_id, claim_b_id,
      conflict_type, severity, scope,
      explanation, resolution_suggestion, status
    ) VALUES (
      {finding_id: String}, {universe_id: String}, {project_id: String},
      {story_unit_id_a: String}, {story_unit_id_b: String},
      {claim_a_id: String}, {claim_b_id: String},
      {conflict_type: String}, {severity: String}, {scope: String},
      {explanation: String}, {resolution_suggestion: String}, 'open'
    )
  `,

  SELECT_FINDINGS_FOR_PROJECT: `
    SELECT f.*,
      a.value AS value_a, a.property, a.source_scene_number AS scene_a,
      b.value AS value_b, b.source_scene_number AS scene_b,
      e.canonical_name AS entity_name,
      su_a.title AS unit_a_title,
      su_b.title AS unit_b_title
    FROM lmm.continuity_findings f
    JOIN lmm.claims a             ON f.claim_a_id = a.claim_id
    JOIN lmm.claims b             ON f.claim_b_id = b.claim_id
    JOIN lmm.universe_entities e  ON a.universe_entity_id = e.entity_id
    JOIN lmm.story_units su_a     ON f.story_unit_id_a = su_a.story_unit_id
    JOIN lmm.story_units su_b     ON f.story_unit_id_b = su_b.story_unit_id
    WHERE f.project_id = {project_id: String}
    ORDER BY f.scope, a.valid_from_scene
  `,

  SELECT_CROSS_UNIT_FINDINGS_FOR_UNIVERSE: `
    SELECT f.*,
      a.value AS value_a, a.property, a.source_scene_number AS scene_a,
      b.value AS value_b, b.source_scene_number AS scene_b,
      e.canonical_name AS entity_name,
      su_a.title AS unit_a_title, su_a.in_universe_period AS period_a,
      su_b.title AS unit_b_title, su_b.in_universe_period AS period_b,
      proj_a.canon_tier AS tier_a, proj_b.canon_tier AS tier_b
    FROM lmm.continuity_findings f
    JOIN lmm.claims a             ON f.claim_a_id = a.claim_id
    JOIN lmm.claims b             ON f.claim_b_id = b.claim_id
    JOIN lmm.universe_entities e  ON a.universe_entity_id = e.entity_id
    JOIN lmm.story_units su_a     ON f.story_unit_id_a = su_a.story_unit_id
    JOIN lmm.story_units su_b     ON f.story_unit_id_b = su_b.story_unit_id
    JOIN lmm.projects proj_a      ON su_a.project_id = proj_a.project_id
    JOIN lmm.projects proj_b      ON su_b.project_id = proj_b.project_id
    WHERE f.universe_id = {universe_id: String}
      AND f.scope       = 'cross_unit'
    ORDER BY su_a.release_order
  `,
} as const;
