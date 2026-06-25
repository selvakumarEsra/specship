/**
 * Database Migrations
 *
 * Schema versioning and migration support.
 */

import { SqliteDatabase } from './sqlite-adapter';

/**
 * Current schema version
 */
export const CURRENT_SCHEMA_VERSION = 10;

/**
 * Migration definition
 */
interface Migration {
  version: number;
  description: string;
  up: (db: SqliteDatabase) => void;
}

/**
 * All migrations in order
 *
 * Note: Version 1 is the initial schema, handled by schema.sql
 * Future migrations go here.
 */
/**
 * SQLite `ALTER TABLE … ADD COLUMN` is not idempotent — it errors with
 * "duplicate column name" if the column already exists. The three columns
 * added in migration #2 are also present in schema.sql, so an open() that
 * runs this migration against a DB whose tables already have them (a
 * half-baked init from before the transaction wrapper in `initialize()`
 * landed) would fail every time. Guard each ALTER with a column check.
 */
function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  // `table` is a hard-coded constant from this file, not user input — safe to
  // interpolate. (Can't bind it: SQLite's pragma_table_info table-valued
  // function requires the table name as a literal argument.) Use prepare/all
  // here rather than db.pragma(), which only returns the first row.
  const rows = db
    .prepare(`SELECT 1 AS x FROM pragma_table_info('${table}') WHERE name = ?`)
    .all(column);
  return rows.length > 0;
}

const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add project metadata, provenance tracking, and unresolved ref context',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      if (!hasColumn(db, 'unresolved_refs', 'file_path')) {
        db.exec(`ALTER TABLE unresolved_refs ADD COLUMN file_path TEXT NOT NULL DEFAULT '';`);
      }
      if (!hasColumn(db, 'unresolved_refs', 'language')) {
        db.exec(`ALTER TABLE unresolved_refs ADD COLUMN language TEXT NOT NULL DEFAULT 'unknown';`);
      }
      if (!hasColumn(db, 'edges', 'provenance')) {
        db.exec(`ALTER TABLE edges ADD COLUMN provenance TEXT DEFAULT NULL;`);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
        CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);
      `);
    },
  },
  {
    version: 3,
    description: 'Add lower(name) expression index for memory-efficient case-insensitive lookups',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));
      `);
    },
  },
  {
    version: 4,
    description:
      'Drop redundant idx_edges_source / idx_edges_target (covered by source_kind / target_kind composites)',
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_edges_source;
        DROP INDEX IF EXISTS idx_edges_target;
      `);
    },
  },
  {
    version: 5,
    description:
      'Add spec layer (specs, spec_files, spec_links, specs_fts) and workflow engine (workflow_runs, workflow_events, workflow_node_sessions, isolation_environments)',
    up: (db) => {
      // Mirrors the v5 additions to schema.sql so existing databases pick up
      // the new tables. New tables start empty; nothing to backfill — the
      // first index after upgrade populates specs, and the first workflow
      // run populates workflow_runs.
      db.exec(`
        CREATE TABLE IF NOT EXISTS specs (
          id              TEXT PRIMARY KEY,
          kind            TEXT NOT NULL,
          title           TEXT NOT NULL,
          body            TEXT NOT NULL,
          format          TEXT NOT NULL,
          source_path     TEXT NOT NULL,
          start_line      INTEGER,
          end_line        INTEGER,
          parent_id       TEXT,
          content_hash    TEXT NOT NULL,
          version         INTEGER DEFAULT 1,
          superseded_by   TEXT,
          owner           TEXT,
          priority        TEXT,
          metadata        TEXT,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL,
          FOREIGN KEY (parent_id)     REFERENCES specs(id) ON DELETE CASCADE,
          FOREIGN KEY (superseded_by) REFERENCES specs(id)
        );

        CREATE TABLE IF NOT EXISTS spec_files (
          path TEXT PRIMARY KEY,
          content_hash TEXT NOT NULL,
          format TEXT NOT NULL,
          size INTEGER NOT NULL,
          modified_at INTEGER NOT NULL,
          indexed_at  INTEGER NOT NULL,
          spec_count  INTEGER DEFAULT 0,
          errors      TEXT
        );

        CREATE TABLE IF NOT EXISTS spec_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spec_id     TEXT NOT NULL,
          target_file_path      TEXT NOT NULL,
          target_qualified_name TEXT NOT NULL,
          target_node_kind      TEXT NOT NULL,
          resolved_node_id      TEXT,
          kind        TEXT NOT NULL,
          state       TEXT NOT NULL,
          drift_axis  TEXT,
          spec_hash_at_link    TEXT NOT NULL,
          node_sig_at_link     TEXT,
          provenance  TEXT NOT NULL,
          confidence  REAL DEFAULT 1.0,
          metadata    TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_specs_parent ON specs(parent_id);
        CREATE INDEX IF NOT EXISTS idx_specs_source_path ON specs(source_path);
        CREATE INDEX IF NOT EXISTS idx_specs_kind ON specs(kind);
        CREATE INDEX IF NOT EXISTS idx_spec_links_spec    ON spec_links(spec_id);
        CREATE INDEX IF NOT EXISTS idx_spec_links_logical ON spec_links(target_file_path, target_qualified_name);
        CREATE INDEX IF NOT EXISTS idx_spec_links_resolved ON spec_links(resolved_node_id);
        CREATE INDEX IF NOT EXISTS idx_spec_links_state   ON spec_links(state);
        CREATE INDEX IF NOT EXISTS idx_spec_links_kind    ON spec_links(kind);

        CREATE VIRTUAL TABLE IF NOT EXISTS specs_fts USING fts5(
          id,
          title,
          body,
          content='specs',
          content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS specs_ai AFTER INSERT ON specs BEGIN
          INSERT INTO specs_fts(rowid, id, title, body)
          VALUES (NEW.rowid, NEW.id, NEW.title, NEW.body);
        END;

        CREATE TRIGGER IF NOT EXISTS specs_ad AFTER DELETE ON specs BEGIN
          INSERT INTO specs_fts(specs_fts, rowid, id, title, body)
          VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.body);
        END;

        CREATE TRIGGER IF NOT EXISTS specs_au AFTER UPDATE ON specs BEGIN
          INSERT INTO specs_fts(specs_fts, rowid, id, title, body)
          VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.body);
          INSERT INTO specs_fts(rowid, id, title, body)
          VALUES (NEW.rowid, NEW.id, NEW.title, NEW.body);
        END;

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id              TEXT PRIMARY KEY,
          workflow_name   TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'pending',
          inputs          TEXT,
          isolation_env_id TEXT,
          started_at      INTEGER,
          completed_at    INTEGER,
          last_activity_at INTEGER NOT NULL,
          error_message   TEXT,
          metadata        TEXT,
          created_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_name);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity ON workflow_runs(last_activity_at)
          WHERE status = 'running';

        CREATE TABLE IF NOT EXISTS workflow_events (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_run_id TEXT NOT NULL,
          event_type      TEXT NOT NULL,
          step_id         TEXT,
          step_kind       TEXT,
          data            TEXT,
          created_at      INTEGER NOT NULL,
          FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(workflow_run_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_workflow_events_created ON workflow_events(created_at);

        CREATE TABLE IF NOT EXISTS workflow_node_sessions (
          workflow_name        TEXT NOT NULL,
          node_id              TEXT NOT NULL,
          scope_key            TEXT NOT NULL,
          provider             TEXT NOT NULL,
          provider_session_id  TEXT NOT NULL,
          last_run_id          TEXT,
          updated_at           INTEGER NOT NULL,
          PRIMARY KEY (workflow_name, node_id, scope_key, provider)
        );

        CREATE TABLE IF NOT EXISTS isolation_environments (
          id              TEXT PRIMARY KEY,
          workflow_run_id TEXT,
          workflow_name   TEXT NOT NULL,
          working_path    TEXT NOT NULL,
          branch_name     TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'active',
          created_at      INTEGER NOT NULL,
          destroyed_at    INTEGER,
          metadata        TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_isolation_active
          ON isolation_environments(workflow_name, workflow_run_id)
          WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_isolation_status ON isolation_environments(status);
      `);
    },
  },
  {
    version: 6,
    description:
      'Add Claude Code transcript ingest tables (claude_projects/sessions/prompts/tool_calls/ingest_state/pricing) for analytics over ~/.claude/projects/*.jsonl',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS claude_projects (
          path        TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          first_seen  INTEGER NOT NULL,
          last_seen   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS claude_sessions (
          id              TEXT PRIMARY KEY,
          project_path    TEXT NOT NULL,
          source_file     TEXT NOT NULL,
          started_at      INTEGER,
          ended_at        INTEGER,
          prompt_count    INTEGER DEFAULT 0,
          total_input_tokens          INTEGER DEFAULT 0,
          total_output_tokens         INTEGER DEFAULT 0,
          total_cache_creation_tokens INTEGER DEFAULT 0,
          total_cache_read_tokens     INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          last_model      TEXT,
          FOREIGN KEY (project_path) REFERENCES claude_projects(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_claude_sessions_project ON claude_sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_claude_sessions_started ON claude_sessions(started_at);

        CREATE TABLE IF NOT EXISTS claude_prompts (
          id              TEXT PRIMARY KEY,
          session_id      TEXT NOT NULL,
          text            TEXT,
          ts              INTEGER NOT NULL,
          leaf_uuid       TEXT,
          model           TEXT,
          input_tokens                INTEGER DEFAULT 0,
          output_tokens               INTEGER DEFAULT 0,
          cache_creation_tokens       INTEGER DEFAULT 0,
          cache_read_tokens           INTEGER DEFAULT 0,
          cost_usd        REAL DEFAULT 0,
          is_sidechain    INTEGER DEFAULT 0,
          FOREIGN KEY (session_id) REFERENCES claude_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_claude_prompts_session ON claude_prompts(session_id);
        CREATE INDEX IF NOT EXISTS idx_claude_prompts_ts ON claude_prompts(ts);
        CREATE INDEX IF NOT EXISTS idx_claude_prompts_sidechain ON claude_prompts(is_sidechain);

        CREATE TABLE IF NOT EXISTS claude_tool_calls (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_id           TEXT NOT NULL,
          session_id          TEXT NOT NULL,
          assistant_uuid      TEXT NOT NULL,
          tool_use_id         TEXT,
          tool_name           TEXT NOT NULL,
          input_summary       TEXT,
          result_length       INTEGER DEFAULT 0,
          ts                  INTEGER NOT NULL,
          FOREIGN KEY (prompt_id) REFERENCES claude_prompts(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES claude_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_prompt ON claude_tool_calls(prompt_id);
        CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_session ON claude_tool_calls(session_id);
        CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_tool ON claude_tool_calls(tool_name);
        CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_result_len ON claude_tool_calls(result_length);

        CREATE TABLE IF NOT EXISTS claude_ingest_state (
          file_path       TEXT PRIMARY KEY,
          last_offset     INTEGER NOT NULL DEFAULT 0,
          last_ingested_at INTEGER NOT NULL,
          file_size       INTEGER NOT NULL DEFAULT 0,
          session_id      TEXT
        );

        CREATE TABLE IF NOT EXISTS claude_pricing (
          model           TEXT PRIMARY KEY,
          input_per_mtok          REAL NOT NULL,
          output_per_mtok         REAL NOT NULL,
          cache_creation_per_mtok REAL NOT NULL,
          cache_read_per_mtok     REAL NOT NULL,
          updated_at      INTEGER NOT NULL
        );
      `);

      // Seed pricing for the current public Anthropic price tiers (USD per
      // 1M tokens). The pricing table is user-editable; these are sensible
      // defaults so analytics work the moment the transcript watcher starts
      // ingesting — no separate config step. Cache-write is billed at 1.25x
      // input; cache-read is 0.1x. Sources: anthropic.com/pricing (snapshot
      // 2026-06). The `INSERT OR IGNORE` keeps a user's custom rates intact
      // if migration re-runs against an already-populated table.
      const now = Date.now();
      const seed = (db as unknown as { prepare: (sql: string) => { run: (...args: unknown[]) => void } }).prepare(`
        INSERT OR IGNORE INTO claude_pricing
          (model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const rates: Array<[string, number, number, number, number]> = [
        ['claude-opus-4-7',   15.0, 75.0, 18.75, 1.5],
        ['claude-opus-4',     15.0, 75.0, 18.75, 1.5],
        ['claude-sonnet-4-6',  3.0, 15.0,  3.75, 0.3],
        ['claude-sonnet-4-7',  3.0, 15.0,  3.75, 0.3],
        ['claude-sonnet-4',    3.0, 15.0,  3.75, 0.3],
        ['claude-haiku-4-5',   0.80, 4.0,  1.0,  0.08],
        ['claude-haiku-4',     0.80, 4.0,  1.0,  0.08],
      ];
      for (const r of rates) seed.run(r[0], r[1], r[2], r[3], r[4], now);
    },
  },
  {
    version: 7,
    description:
      'Capture assistant response text + thinking blocks on claude_prompts; capture full tool input JSON on claude_tool_calls (previously parsed by ingestor and discarded)',
    up: (db) => {
      // Three new columns, all nullable so rows ingested before this
      // migration stay valid and the UI hides empty sections naturally.
      // `hasColumn` guards keep the migration idempotent — safe to re-run
      // against a DB that already has the columns (e.g. when the schema.sql
      // path created them on a fresh init).
      if (!hasColumn(db, 'claude_prompts', 'assistant_text')) {
        db.exec(`ALTER TABLE claude_prompts ADD COLUMN assistant_text TEXT;`);
      }
      if (!hasColumn(db, 'claude_prompts', 'thinking_text')) {
        db.exec(`ALTER TABLE claude_prompts ADD COLUMN thinking_text TEXT;`);
      }
      if (!hasColumn(db, 'claude_tool_calls', 'input_json')) {
        db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN input_json TEXT;`);
      }
    },
  },
  {
    version: 8,
    description:
      'Backfill claude_sessions.prompt_count from actual claude_prompts rows. The ingestor was bumping prompt_count once per user-type JSONL entry, but Claude Code emits one user entry per tool_result follow-up — all sharing the original promptId. A typical 50-prompt session landed with 800+ in prompt_count, making the Sessions list show inflated numbers vs. the actual rows visible in Session Detail. Re-run-safe.',
    up: (db) => {
      // No schema change — purely a data correction. Idempotent because
      // the source-of-truth is COUNT(*) over claude_prompts, so running
      // the migration twice converges to the same value.
      db.exec(`
        UPDATE claude_sessions
        SET prompt_count = (
          SELECT COUNT(*) FROM claude_prompts p WHERE p.session_id = claude_sessions.id
        );
      `);
    },
  },
  {
    version: 9,
    description: 'specship-impact: classify specship tool calls + store read-displacement',
    up: (db) => {
      if (!hasColumn(db, 'claude_tool_calls', 'is_specship'))
        db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN is_specship INTEGER NOT NULL DEFAULT 0;`);
      if (!hasColumn(db, 'claude_tool_calls', 'displaced_files'))
        db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN displaced_files TEXT;`); // JSON [[path,size],…] | NULL
      if (!hasColumn(db, 'claude_tool_calls', 'resolution'))
        db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN resolution TEXT;`);
      db.exec(`UPDATE claude_tool_calls SET is_specship = 1 WHERE tool_name LIKE 'mcp__specship__%';`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_specship ON claude_tool_calls(is_specship);`);
    },
  },
  {
    version: 10,
    description:
      'reflection engine (REFLECT-DOC): reflect_proposals table for self-improvement proposals mined from the claude_* transcript tables, keyed by content_hash with an open/applied/undone/dismissed state machine',
    up: (db) => {
      // Mirrors the reflect_proposals block in schema.sql so existing databases
      // pick up the table. Starts empty; the first reflection pass populates it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS reflect_proposals (
          content_hash    TEXT PRIMARY KEY,
          type            TEXT NOT NULL,
          severity        TEXT NOT NULL,
          title           TEXT NOT NULL,
          body            TEXT NOT NULL,
          target_kind     TEXT NOT NULL,
          target_path     TEXT NOT NULL,
          payload         TEXT NOT NULL,
          evidence        TEXT NOT NULL,
          state           TEXT NOT NULL DEFAULT 'open',
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL,
          applied_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_reflect_proposals_state ON reflect_proposals(state);
        CREATE INDEX IF NOT EXISTS idx_reflect_proposals_severity ON reflect_proposals(severity);
      `);
    },
  },
];

/**
 * Get the current schema version from the database
 */
export function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Record a migration as applied
 */
function recordMigration(db: SqliteDatabase, version: number, description: string): void {
  db.prepare(
    'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
  ).run(version, Date.now(), description);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: SqliteDatabase, fromVersion: number): void {
  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    return;
  }

  // Sort by version
  pending.sort((a, b) => a.version - b.version);

  // Run each migration in a transaction
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      recordMigration(db, migration.version, migration.description);
    })();
  }
}

/**
 * Check if the database needs migration
 */
export function needsMigration(db: SqliteDatabase): boolean {
  const current = getCurrentVersion(db);
  return current < CURRENT_SCHEMA_VERSION;
}

/**
 * Get list of pending migrations
 */
export function getPendingMigrations(db: SqliteDatabase): Migration[] {
  const current = getCurrentVersion(db);
  return migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
}

/**
 * Get migration history from database
 */
export function getMigrationHistory(
  db: SqliteDatabase
): Array<{ version: number; appliedAt: number; description: string | null }> {
  const rows = db
    .prepare('SELECT version, applied_at, description FROM schema_versions ORDER BY version')
    .all() as Array<{ version: number; applied_at: number; description: string | null }>;

  return rows.map((row) => ({
    version: row.version,
    appliedAt: row.applied_at,
    description: row.description,
  }));
}
