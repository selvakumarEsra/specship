-- SpecShip SQLite Schema
-- Version 1

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- Insert initial version
INSERT INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema');

-- =============================================================================
-- Core Tables
-- =============================================================================

-- Nodes: Code symbols (functions, classes, variables, etc.)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    docstring TEXT,
    signature TEXT,
    visibility TEXT,
    is_exported INTEGER DEFAULT 0,
    is_async INTEGER DEFAULT 0,
    is_static INTEGER DEFAULT 0,
    is_abstract INTEGER DEFAULT 0,
    decorators TEXT, -- JSON array
    type_parameters TEXT, -- JSON array
    updated_at INTEGER NOT NULL
);

-- Edges: Relationships between nodes
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT, -- JSON object
    line INTEGER,
    col INTEGER,
    provenance TEXT DEFAULT NULL,
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Files: Tracked source files
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    node_count INTEGER DEFAULT 0,
    errors TEXT -- JSON array
);

-- Unresolved References: References that need resolution after full indexing
CREATE TABLE IF NOT EXISTS unresolved_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id TEXT NOT NULL,
    reference_name TEXT NOT NULL,
    reference_kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    candidates TEXT, -- JSON array
    file_path TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'unknown',
    FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- =============================================================================
-- Indexes for Query Performance
-- =============================================================================

-- Node indexes
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line);
CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));

-- Full-text search index on node names, docstrings, and signatures
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;

-- Edge indexes.
-- idx_edges_source / idx_edges_target are intentionally omitted —
-- the (source, kind) and (target, kind) composites below cover the
-- corresponding source-only / target-only lookups via SQLite's
-- left-prefix scan, so the narrow indexes are dead weight on writes.
-- Migration v4 drops them on existing databases.
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);

-- File indexes
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);

-- Unresolved refs indexes
CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name);
CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);

-- Project metadata for version/provenance tracking
CREATE TABLE IF NOT EXISTS project_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- =============================================================================
-- Spec layer (v5): specs as first-class peers of code
-- =============================================================================

-- Specs: requirements, acceptance criteria, contracts. One row per addressable
-- spec entity. Document-level entries have parent_id = NULL; requirements and
-- acceptance criteria point to their parent doc/req via parent_id.
CREATE TABLE IF NOT EXISTS specs (
    id              TEXT PRIMARY KEY,           -- embedded ID, e.g. REQ-AUTH-001
    kind            TEXT NOT NULL,              -- 'document' | 'requirement' | 'acceptance' | 'contract' | 'data_schema'
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    format          TEXT NOT NULL,              -- 'markdown' | 'yaml' | 'gherkin' | 'openapi'
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

-- Spec files: hash-keyed mirror of the `files` table for spec sources
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

-- Spec links: spec ↔ code join with state. Keyed on LOGICAL identity
-- (target_file_path, target_qualified_name, target_node_kind) so links survive
-- line shifts and re-extracts. resolved_node_id is a cache, repopulated by
-- SpecLinkResolver each sync. No FK on resolved_node_id (it churns on every
-- re-extract).
CREATE TABLE IF NOT EXISTS spec_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spec_id     TEXT NOT NULL,
    target_file_path      TEXT NOT NULL,
    target_qualified_name TEXT NOT NULL,
    target_node_kind      TEXT NOT NULL,
    resolved_node_id      TEXT,
    kind        TEXT NOT NULL,          -- 'implements' | 'tests' | 'validates' | 'documents' | 'depends_on'
    state       TEXT NOT NULL,          -- 'drafted' | 'implementing' | 'implemented' | 'verified' | 'drifted' | 'broken' | 'orphaned'
    drift_axis  TEXT,                   -- 'spec' | 'code' | NULL
    spec_hash_at_link    TEXT NOT NULL,
    node_sig_at_link     TEXT,
    provenance  TEXT NOT NULL,          -- 'agent-asserted' | 'code-comment' | 'spec-declaration' | 'resolver'
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

-- Spec full-text search (separate from nodes_fts so weights aren't entangled)
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

-- =============================================================================
-- Workflow layer (v5): DAG workflow engine + isolation
-- =============================================================================

-- Workflow runs: each invocation of a workflow (deterministic DAG execution)
CREATE TABLE IF NOT EXISTS workflow_runs (
    id              TEXT PRIMARY KEY,           -- UUID
    workflow_name   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    inputs          TEXT,                       -- JSON: $SPEC_ID, $LINK_ID, etc.
    isolation_env_id TEXT,                      -- FK to isolation_environments.id (worktree path)
    started_at      INTEGER,
    completed_at    INTEGER,
    last_activity_at INTEGER NOT NULL,
    error_message   TEXT,
    metadata        TEXT,                       -- JSON: approval context, prior_completed_nodes, etc.
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_name);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity ON workflow_runs(last_activity_at)
    WHERE status = 'running';

-- Workflow events: lean per-step JSONB log. Verbose tool output goes to JSONL.
CREATE TABLE IF NOT EXISTS workflow_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_run_id TEXT NOT NULL,
    event_type      TEXT NOT NULL,              -- 'step_started' | 'step_completed' | 'step_failed' | 'tool_called' | 'artifact_created' | 'approval_requested' | 'approval_granted' | 'approval_rejected'
    step_id         TEXT,
    step_kind       TEXT,                       -- 'prompt' | 'bash' | 'script' | 'approval' | 'cancel'
    data            TEXT,                       -- JSON
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type);
CREATE INDEX IF NOT EXISTS idx_workflow_events_created ON workflow_events(created_at);

-- Per-node session persistence: provider session IDs survive run boundaries
-- when a node opts in with persist_session: true.
CREATE TABLE IF NOT EXISTS workflow_node_sessions (
    workflow_name        TEXT NOT NULL,
    node_id              TEXT NOT NULL,
    scope_key            TEXT NOT NULL,         -- typically the run's UUID, but polymorphic
    provider             TEXT NOT NULL,
    provider_session_id  TEXT NOT NULL,
    last_run_id          TEXT,
    updated_at           INTEGER NOT NULL,
    PRIMARY KEY (workflow_name, node_id, scope_key, provider)
);

-- Isolation environments: git worktrees per workflow run.
-- Contract: id IS the filesystem path (envId = worktreePath).
CREATE TABLE IF NOT EXISTS isolation_environments (
    id              TEXT PRIMARY KEY,           -- = working_path
    workflow_run_id TEXT,
    workflow_name   TEXT NOT NULL,
    working_path    TEXT NOT NULL,
    branch_name     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'destroyed'
    created_at      INTEGER NOT NULL,
    destroyed_at    INTEGER,
    metadata        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_isolation_active
    ON isolation_environments(workflow_name, workflow_run_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_isolation_status ON isolation_environments(status);

-- =============================================================================
-- Claude Code transcript ingest (v6): analytics over ~/.claude/projects/*.jsonl
-- =============================================================================

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
