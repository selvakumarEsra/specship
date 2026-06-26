/**
 * Spec & Workflow Database Queries
 *
 * Prepared statements for CRUD on the v5 spec + workflow tables.
 * Mirrors the pattern used by `QueryBuilder` in `./queries.ts`: lazy
 * prepared statements cached per instance.
 *
 * Kept separate from QueryBuilder to avoid bloating that class —
 * it's already ~1900 lines.
 */

import { SqliteDatabase, SqliteStatement } from './sqlite-adapter';
import {
  Spec,
  SpecFile,
  SpecKind,
  SpecFormat,
  SpecLink,
  SpecLinkState,
  SpecLinkKind,
  SpecLinkProvenance,
  SpecLinkDriftAxis,
  NodeKind,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowNodeKind,
  IsolationEnvironment,
} from '../types';
import { safeJsonParse } from '../utils';

// =============================================================================
// Row types
// =============================================================================

interface SpecRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  format: string;
  source_path: string;
  start_line: number | null;
  end_line: number | null;
  parent_id: string | null;
  content_hash: string;
  version: number | null;
  superseded_by: string | null;
  owner: string | null;
  priority: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface SpecFileRow {
  path: string;
  content_hash: string;
  format: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  spec_count: number;
  errors: string | null;
}

interface SpecLinkRow {
  id: number;
  spec_id: string;
  target_file_path: string;
  target_qualified_name: string;
  target_node_kind: string;
  resolved_node_id: string | null;
  kind: string;
  state: string;
  drift_axis: string | null;
  spec_hash_at_link: string;
  node_sig_at_link: string | null;
  provenance: string;
  confidence: number | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface WorkflowRunRow {
  id: string;
  workflow_name: string;
  status: string;
  inputs: string | null;
  isolation_env_id: string | null;
  started_at: number | null;
  completed_at: number | null;
  last_activity_at: number;
  error_message: string | null;
  metadata: string | null;
  created_at: number;
}

interface WorkflowEventRow {
  id: number;
  workflow_run_id: string;
  event_type: string;
  step_id: string | null;
  step_kind: string | null;
  data: string | null;
  created_at: number;
}

interface IsolationEnvRow {
  id: string;
  workflow_run_id: string | null;
  workflow_name: string;
  working_path: string;
  branch_name: string;
  status: string;
  created_at: number;
  destroyed_at: number | null;
  metadata: string | null;
}

// =============================================================================
// Row → object converters
// =============================================================================

function rowToSpec(row: SpecRow): Spec {
  return {
    id: row.id,
    kind: row.kind as SpecKind,
    title: row.title,
    body: row.body,
    format: row.format as SpecFormat,
    sourcePath: row.source_path,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    parentId: row.parent_id ?? undefined,
    contentHash: row.content_hash,
    version: row.version ?? undefined,
    supersededBy: row.superseded_by ?? undefined,
    owner: row.owner ?? undefined,
    priority: row.priority ?? undefined,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSpecFile(row: SpecFileRow): SpecFile {
  return {
    path: row.path,
    contentHash: row.content_hash,
    format: row.format as SpecFormat,
    size: row.size,
    modifiedAt: row.modified_at,
    indexedAt: row.indexed_at,
    specCount: row.spec_count,
    errors: row.errors ? safeJsonParse(row.errors, undefined) : undefined,
  };
}

function rowToSpecLink(row: SpecLinkRow): SpecLink {
  return {
    id: row.id,
    specId: row.spec_id,
    targetFilePath: row.target_file_path,
    targetQualifiedName: row.target_qualified_name,
    targetNodeKind: row.target_node_kind as NodeKind,
    resolvedNodeId: row.resolved_node_id ?? undefined,
    kind: row.kind as SpecLinkKind,
    state: row.state as SpecLinkState,
    driftAxis: (row.drift_axis as SpecLinkDriftAxis) ?? null,
    specHashAtLink: row.spec_hash_at_link,
    nodeSigAtLink: row.node_sig_at_link ?? undefined,
    provenance: row.provenance as SpecLinkProvenance,
    confidence: row.confidence ?? undefined,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    status: row.status as WorkflowRunStatus,
    inputs: row.inputs ? safeJsonParse(row.inputs, undefined) : undefined,
    isolationEnvId: row.isolation_env_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastActivityAt: row.last_activity_at,
    errorMessage: row.error_message ?? undefined,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    createdAt: row.created_at,
  };
}

function rowToWorkflowEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    eventType: row.event_type as WorkflowEventType,
    stepId: row.step_id ?? undefined,
    stepKind: (row.step_kind as WorkflowNodeKind) ?? undefined,
    data: row.data ? safeJsonParse(row.data, undefined) : undefined,
    createdAt: row.created_at,
  };
}

function rowToIsolationEnv(row: IsolationEnvRow): IsolationEnvironment {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id ?? undefined,
    workflowName: row.workflow_name,
    workingPath: row.working_path,
    branchName: row.branch_name,
    status: row.status as 'active' | 'destroyed',
    createdAt: row.created_at,
    destroyedAt: row.destroyed_at ?? undefined,
    metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
  };
}

// =============================================================================
// SpecQueries — CRUD for specs, spec_files, spec_links, workflow_*
// =============================================================================

export class SpecQueries {
  private db: SqliteDatabase;

  private stmts: {
    // specs
    insertSpec?: SqliteStatement;
    updateSpec?: SqliteStatement;
    deleteSpec?: SqliteStatement;
    deleteSpecsByFile?: SqliteStatement;
    getSpecById?: SqliteStatement;
    getSpecsByFile?: SqliteStatement;
    getSpecsByParent?: SqliteStatement;
    getSpecsByKind?: SqliteStatement;
    getAllSpecs?: SqliteStatement;
    // spec_files
    upsertSpecFile?: SqliteStatement;
    deleteSpecFile?: SqliteStatement;
    getSpecFileByPath?: SqliteStatement;
    getAllSpecFiles?: SqliteStatement;
    // spec_links
    insertSpecLink?: SqliteStatement;
    upsertSpecLink?: SqliteStatement;
    deleteSpecLink?: SqliteStatement;
    deleteSpecLinksByFile?: SqliteStatement;
    updateSpecLinkState?: SqliteStatement;
    updateSpecLinkResolution?: SqliteStatement;
    getLinkById?: SqliteStatement;
    getLinksBySpec?: SqliteStatement;
    getLinksByNode?: SqliteStatement;
    getLinksByLogicalTarget?: SqliteStatement;
    getLinksByState?: SqliteStatement;
    getLinksByTargetFile?: SqliteStatement;
    getAllLinks?: SqliteStatement;
    // workflow_runs
    insertWorkflowRun?: SqliteStatement;
    updateWorkflowRun?: SqliteStatement;
    getWorkflowRunById?: SqliteStatement;
    getWorkflowRunsByStatus?: SqliteStatement;
    getWorkflowRunsByName?: SqliteStatement;
    getAllWorkflowRuns?: SqliteStatement;
    // workflow_events
    insertWorkflowEvent?: SqliteStatement;
    getEventsByRun?: SqliteStatement;
    // isolation_environments
    insertIsolationEnv?: SqliteStatement;
    updateIsolationEnv?: SqliteStatement;
    getIsolationEnvById?: SqliteStatement;
    getActiveIsolationEnvByRun?: SqliteStatement;
    getAllActiveIsolationEnvs?: SqliteStatement;
  } = {};

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  // ===========================================================================
  // Specs
  // ===========================================================================

  /**
   * Insert or replace a spec row. Also inserts a virtual node projection
   * into `nodes` with kind='spec' so graph traversal sees the spec.
   *
   * The virtual node's `id` is `spec:${spec.id}` (kind:hash convention from
   * tree-sitter-helpers, but hand-built — specs don't go through tree-sitter).
   * `qualified_name = spec.id` so SpecLinkResolver and specship_explore can
   * find specs by their stable ID.
   */
  insertSpec(spec: Spec): void {
    if (!this.stmts.insertSpec) {
      this.stmts.insertSpec = this.db.prepare(`
        INSERT OR REPLACE INTO specs (
          id, kind, title, body, format, source_path, start_line, end_line,
          parent_id, content_hash, version, superseded_by, owner, priority,
          metadata, created_at, updated_at
        ) VALUES (
          @id, @kind, @title, @body, @format, @sourcePath, @startLine, @endLine,
          @parentId, @contentHash, @version, @supersededBy, @owner, @priority,
          @metadata, @createdAt, @updatedAt
        )
      `);
    }
    this.stmts.insertSpec.run({
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      body: spec.body,
      format: spec.format,
      sourcePath: spec.sourcePath,
      startLine: spec.startLine ?? null,
      endLine: spec.endLine ?? null,
      parentId: spec.parentId ?? null,
      contentHash: spec.contentHash,
      version: spec.version ?? 1,
      supersededBy: spec.supersededBy ?? null,
      owner: spec.owner ?? null,
      priority: spec.priority ?? null,
      metadata: spec.metadata ? JSON.stringify(spec.metadata) : null,
      createdAt: spec.createdAt,
      updatedAt: spec.updatedAt,
    });

    // Project a thin row into `nodes` so the spec participates in graph
    // traversal (specship_explore, specship_node).
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO nodes (
          id, kind, name, qualified_name, file_path, language,
          start_line, end_line, start_column, end_column,
          docstring, signature, visibility,
          is_exported, is_async, is_static, is_abstract,
          decorators, type_parameters, updated_at
        ) VALUES (
          @id, 'spec', @name, @qualifiedName, @filePath, 'unknown',
          @startLine, @endLine, 0, 0,
          NULL, @signature, NULL,
          0, 0, 0, 0,
          NULL, NULL, @updatedAt
        )
        `
      )
      .run({
        id: `spec:${spec.id}`,
        name: spec.title,
        qualifiedName: spec.id,
        filePath: spec.sourcePath,
        startLine: spec.startLine ?? 0,
        endLine: spec.endLine ?? 0,
        signature: spec.kind,
        updatedAt: spec.updatedAt,
      });
  }

  /**
   * Batch-insert specs in a transaction.
   */
  insertSpecsBatch(specs: Spec[]): void {
    if (specs.length === 0) return;
    this.db.transaction(() => {
      for (const spec of specs) this.insertSpec(spec);
    })();
  }

  /**
   * Delete all specs for a given source file. CASCADE removes children
   * (parent_id FK) and any spec_links to those specs.
   */
  deleteSpecsByFile(sourcePath: string): void {
    if (!this.stmts.deleteSpecsByFile) {
      this.stmts.deleteSpecsByFile = this.db.prepare(
        'DELETE FROM specs WHERE source_path = ?'
      );
    }
    this.db.transaction(() => {
      // Also drop the virtual node projections for these specs.
      this.db
        .prepare(
          `DELETE FROM nodes WHERE kind = 'spec' AND file_path = ?`
        )
        .run(sourcePath);
      this.stmts.deleteSpecsByFile!.run(sourcePath);
    })();
  }

  /** Look up a spec by its embedded ID. */
  getSpecById(id: string): Spec | null {
    if (!this.stmts.getSpecById) {
      this.stmts.getSpecById = this.db.prepare('SELECT * FROM specs WHERE id = ?');
    }
    const row = this.stmts.getSpecById.get(id) as SpecRow | undefined;
    return row ? rowToSpec(row) : null;
  }

  /** All specs from a given source file, sorted by start_line. */
  getSpecsByFile(sourcePath: string): Spec[] {
    if (!this.stmts.getSpecsByFile) {
      this.stmts.getSpecsByFile = this.db.prepare(
        `SELECT * FROM specs WHERE source_path = ? ORDER BY start_line`
      );
    }
    const rows = this.stmts.getSpecsByFile.all(sourcePath) as SpecRow[];
    return rows.map(rowToSpec);
  }

  /** Child specs of a given parent (requirements under a document, etc.). */
  getSpecsByParent(parentId: string): Spec[] {
    if (!this.stmts.getSpecsByParent) {
      this.stmts.getSpecsByParent = this.db.prepare(
        `SELECT * FROM specs WHERE parent_id = ? ORDER BY start_line`
      );
    }
    const rows = this.stmts.getSpecsByParent.all(parentId) as SpecRow[];
    return rows.map(rowToSpec);
  }

  /**
   * All specs of one kind. Used to surface the (small) `domain` fact layer
   * cheaply without scanning every requirement/acceptance row (REQ-DOMAIN-005).
   */
  getSpecsByKind(kind: Spec['kind']): Spec[] {
    if (!this.stmts.getSpecsByKind) {
      this.stmts.getSpecsByKind = this.db.prepare(
        `SELECT * FROM specs WHERE kind = ? ORDER BY source_path, start_line`
      );
    }
    const rows = this.stmts.getSpecsByKind.all(kind) as SpecRow[];
    return rows.map(rowToSpec);
  }

  /** All specs (small projects only; large repos should filter). */
  getAllSpecs(): Spec[] {
    if (!this.stmts.getAllSpecs) {
      this.stmts.getAllSpecs = this.db.prepare(
        `SELECT * FROM specs ORDER BY source_path, start_line`
      );
    }
    const rows = this.stmts.getAllSpecs.all() as SpecRow[];
    return rows.map(rowToSpec);
  }

  // ===========================================================================
  // Spec files
  // ===========================================================================

  upsertSpecFile(file: SpecFile): void {
    if (!this.stmts.upsertSpecFile) {
      this.stmts.upsertSpecFile = this.db.prepare(`
        INSERT INTO spec_files (path, content_hash, format, size, modified_at, indexed_at, spec_count, errors)
        VALUES (@path, @contentHash, @format, @size, @modifiedAt, @indexedAt, @specCount, @errors)
        ON CONFLICT(path) DO UPDATE SET
          content_hash = @contentHash,
          format       = @format,
          size         = @size,
          modified_at  = @modifiedAt,
          indexed_at   = @indexedAt,
          spec_count   = @specCount,
          errors       = @errors
      `);
    }
    this.stmts.upsertSpecFile.run({
      path: file.path,
      contentHash: file.contentHash,
      format: file.format,
      size: file.size,
      modifiedAt: file.modifiedAt,
      indexedAt: file.indexedAt,
      specCount: file.specCount,
      errors: file.errors ? JSON.stringify(file.errors) : null,
    });
  }

  deleteSpecFile(path: string): void {
    this.db.transaction(() => {
      this.deleteSpecsByFile(path);
      if (!this.stmts.deleteSpecFile) {
        this.stmts.deleteSpecFile = this.db.prepare(
          'DELETE FROM spec_files WHERE path = ?'
        );
      }
      this.stmts.deleteSpecFile.run(path);
    })();
  }

  getSpecFileByPath(path: string): SpecFile | null {
    if (!this.stmts.getSpecFileByPath) {
      this.stmts.getSpecFileByPath = this.db.prepare(
        'SELECT * FROM spec_files WHERE path = ?'
      );
    }
    const row = this.stmts.getSpecFileByPath.get(path) as SpecFileRow | undefined;
    return row ? rowToSpecFile(row) : null;
  }

  getAllSpecFiles(): SpecFile[] {
    if (!this.stmts.getAllSpecFiles) {
      this.stmts.getAllSpecFiles = this.db.prepare(
        'SELECT * FROM spec_files ORDER BY path'
      );
    }
    const rows = this.stmts.getAllSpecFiles.all() as SpecFileRow[];
    return rows.map(rowToSpecFile);
  }

  // ===========================================================================
  // Spec links — the spec ↔ code join with state
  // ===========================================================================

  /**
   * Insert a fresh link. Most callers want `upsertSpecLink` (idempotent).
   */
  insertSpecLink(link: Omit<SpecLink, 'id'>): number {
    if (!this.stmts.insertSpecLink) {
      this.stmts.insertSpecLink = this.db.prepare(`
        INSERT INTO spec_links (
          spec_id, target_file_path, target_qualified_name, target_node_kind,
          resolved_node_id, kind, state, drift_axis,
          spec_hash_at_link, node_sig_at_link,
          provenance, confidence, metadata, created_at, updated_at
        ) VALUES (
          @specId, @targetFilePath, @targetQualifiedName, @targetNodeKind,
          @resolvedNodeId, @kind, @state, @driftAxis,
          @specHashAtLink, @nodeSigAtLink,
          @provenance, @confidence, @metadata, @createdAt, @updatedAt
        )
      `);
    }
    const result = this.stmts.insertSpecLink.run({
      specId: link.specId,
      targetFilePath: link.targetFilePath,
      targetQualifiedName: link.targetQualifiedName,
      targetNodeKind: link.targetNodeKind,
      resolvedNodeId: link.resolvedNodeId ?? null,
      kind: link.kind,
      state: link.state,
      driftAxis: link.driftAxis ?? null,
      specHashAtLink: link.specHashAtLink,
      nodeSigAtLink: link.nodeSigAtLink ?? null,
      provenance: link.provenance,
      confidence: link.confidence ?? 1.0,
      metadata: link.metadata ? JSON.stringify(link.metadata) : null,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    });
    return Number(result.lastInsertRowid);
  }

  /**
   * Idempotent upsert keyed on logical identity
   * (spec_id, target_file_path, target_qualified_name, kind). If a link
   * with the same logical key exists, update it; otherwise insert. Higher
   * provenance/confidence wins (agent-asserted overrides code-comment, etc.).
   *
   * Returns the link row's id.
   */
  upsertSpecLink(link: Omit<SpecLink, 'id'>): number {
    const existing = this.findLogicalLink(
      link.specId,
      link.targetFilePath,
      link.targetQualifiedName,
      link.kind
    );

    const now = link.updatedAt;
    if (existing) {
      // Only overwrite if new signal has equal or higher confidence.
      const newConfidence = link.confidence ?? 1.0;
      const existingConfidence = existing.confidence ?? 1.0;
      if (newConfidence < existingConfidence) {
        return existing.id;
      }
      this.db
        .prepare(
          `
          UPDATE spec_links
          SET resolved_node_id = @resolvedNodeId,
              state            = @state,
              drift_axis       = @driftAxis,
              spec_hash_at_link = @specHashAtLink,
              node_sig_at_link  = @nodeSigAtLink,
              provenance       = @provenance,
              confidence       = @confidence,
              metadata         = @metadata,
              updated_at       = @updatedAt
          WHERE id = @id
          `
        )
        .run({
          id: existing.id,
          resolvedNodeId: link.resolvedNodeId ?? null,
          state: link.state,
          driftAxis: link.driftAxis ?? null,
          specHashAtLink: link.specHashAtLink,
          nodeSigAtLink: link.nodeSigAtLink ?? null,
          provenance: link.provenance,
          confidence: link.confidence ?? 1.0,
          metadata: link.metadata ? JSON.stringify(link.metadata) : null,
          updatedAt: now,
        });
      return existing.id;
    }
    return this.insertSpecLink(link);
  }

  /** Find a link by its logical identity (no node_id involved). */
  findLogicalLink(
    specId: string,
    targetFilePath: string,
    targetQualifiedName: string,
    kind: SpecLinkKind
  ): SpecLink | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM spec_links
        WHERE spec_id = ? AND target_file_path = ? AND target_qualified_name = ? AND kind = ?
        LIMIT 1
        `
      )
      .get(specId, targetFilePath, targetQualifiedName, kind) as SpecLinkRow | undefined;
    return row ? rowToSpecLink(row) : null;
  }

  deleteSpecLink(id: number): void {
    if (!this.stmts.deleteSpecLink) {
      this.stmts.deleteSpecLink = this.db.prepare('DELETE FROM spec_links WHERE id = ?');
    }
    this.stmts.deleteSpecLink.run(id);
  }

  updateSpecLinkState(
    id: number,
    state: SpecLinkState,
    driftAxis: SpecLinkDriftAxis = null,
    updatedAt: number = Date.now()
  ): void {
    if (!this.stmts.updateSpecLinkState) {
      this.stmts.updateSpecLinkState = this.db.prepare(
        `UPDATE spec_links SET state = ?, drift_axis = ?, updated_at = ? WHERE id = ?`
      );
    }
    this.stmts.updateSpecLinkState.run(state, driftAxis, updatedAt, id);
  }

  /**
   * Update the resolved_node_id cache. Called by SpecLinkResolver after
   * each sync. NULL means the logical target doesn't currently exist
   * (caller should set state='orphaned' separately).
   */
  updateSpecLinkResolution(id: number, resolvedNodeId: string | null, updatedAt: number = Date.now()): void {
    if (!this.stmts.updateSpecLinkResolution) {
      this.stmts.updateSpecLinkResolution = this.db.prepare(
        `UPDATE spec_links SET resolved_node_id = ?, updated_at = ? WHERE id = ?`
      );
    }
    this.stmts.updateSpecLinkResolution.run(resolvedNodeId, updatedAt, id);
  }

  getLinkById(id: number): SpecLink | null {
    if (!this.stmts.getLinkById) {
      this.stmts.getLinkById = this.db.prepare('SELECT * FROM spec_links WHERE id = ?');
    }
    const row = this.stmts.getLinkById.get(id) as SpecLinkRow | undefined;
    return row ? rowToSpecLink(row) : null;
  }

  /** All links for a spec (e.g., for specship_spec response). */
  getLinksBySpec(specId: string): SpecLink[] {
    if (!this.stmts.getLinksBySpec) {
      this.stmts.getLinksBySpec = this.db.prepare(
        `SELECT * FROM spec_links WHERE spec_id = ? ORDER BY updated_at DESC`
      );
    }
    const rows = this.stmts.getLinksBySpec.all(specId) as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  /** All links pointing at a given resolved node (e.g., for specship_node response). */
  getLinksByNode(nodeId: string): SpecLink[] {
    if (!this.stmts.getLinksByNode) {
      this.stmts.getLinksByNode = this.db.prepare(
        `SELECT * FROM spec_links WHERE resolved_node_id = ? ORDER BY updated_at DESC`
      );
    }
    const rows = this.stmts.getLinksByNode.all(nodeId) as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  /**
   * Links whose logical target lives in a particular file. Used by
   * SpecLinkResolver after a file is re-extracted to know which links
   * need re-resolution.
   */
  getLinksByTargetFile(filePath: string): SpecLink[] {
    if (!this.stmts.getLinksByTargetFile) {
      this.stmts.getLinksByTargetFile = this.db.prepare(
        `SELECT * FROM spec_links WHERE target_file_path = ?`
      );
    }
    const rows = this.stmts.getLinksByTargetFile.all(filePath) as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  /** Links by logical target identity (file + qualified_name). */
  getLinksByLogicalTarget(filePath: string, qualifiedName: string): SpecLink[] {
    if (!this.stmts.getLinksByLogicalTarget) {
      this.stmts.getLinksByLogicalTarget = this.db.prepare(
        `SELECT * FROM spec_links WHERE target_file_path = ? AND target_qualified_name = ?`
      );
    }
    const rows = this.stmts.getLinksByLogicalTarget.all(filePath, qualifiedName) as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  /** Links in one or more states — drives specship_drifted. */
  getLinksByState(states: SpecLinkState[]): SpecLink[] {
    if (states.length === 0) return [];
    const placeholders = states.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM spec_links WHERE state IN (${placeholders}) ORDER BY updated_at DESC`)
      .all(...states) as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  getAllLinks(): SpecLink[] {
    if (!this.stmts.getAllLinks) {
      this.stmts.getAllLinks = this.db.prepare(
        `SELECT * FROM spec_links ORDER BY updated_at DESC`
      );
    }
    const rows = this.stmts.getAllLinks.all() as SpecLinkRow[];
    return rows.map(rowToSpecLink);
  }

  // ===========================================================================
  // Workflow runs
  // ===========================================================================

  insertWorkflowRun(run: WorkflowRun): void {
    if (!this.stmts.insertWorkflowRun) {
      this.stmts.insertWorkflowRun = this.db.prepare(`
        INSERT INTO workflow_runs (
          id, workflow_name, status, inputs, isolation_env_id,
          started_at, completed_at, last_activity_at,
          error_message, metadata, created_at
        ) VALUES (
          @id, @workflowName, @status, @inputs, @isolationEnvId,
          @startedAt, @completedAt, @lastActivityAt,
          @errorMessage, @metadata, @createdAt
        )
      `);
    }
    this.stmts.insertWorkflowRun.run({
      id: run.id,
      workflowName: run.workflowName,
      status: run.status,
      inputs: run.inputs ? JSON.stringify(run.inputs) : null,
      isolationEnvId: run.isolationEnvId ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      lastActivityAt: run.lastActivityAt,
      errorMessage: run.errorMessage ?? null,
      metadata: run.metadata ? JSON.stringify(run.metadata) : null,
      createdAt: run.createdAt,
    });
  }

  updateWorkflowRun(run: WorkflowRun): void {
    if (!this.stmts.updateWorkflowRun) {
      this.stmts.updateWorkflowRun = this.db.prepare(`
        UPDATE workflow_runs SET
          status = @status,
          inputs = @inputs,
          isolation_env_id = @isolationEnvId,
          started_at = @startedAt,
          completed_at = @completedAt,
          last_activity_at = @lastActivityAt,
          error_message = @errorMessage,
          metadata = @metadata
        WHERE id = @id
      `);
    }
    this.stmts.updateWorkflowRun.run({
      id: run.id,
      status: run.status,
      inputs: run.inputs ? JSON.stringify(run.inputs) : null,
      isolationEnvId: run.isolationEnvId ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      lastActivityAt: run.lastActivityAt,
      errorMessage: run.errorMessage ?? null,
      metadata: run.metadata ? JSON.stringify(run.metadata) : null,
    });
  }

  getWorkflowRunById(id: string): WorkflowRun | null {
    if (!this.stmts.getWorkflowRunById) {
      this.stmts.getWorkflowRunById = this.db.prepare(
        'SELECT * FROM workflow_runs WHERE id = ?'
      );
    }
    const row = this.stmts.getWorkflowRunById.get(id) as WorkflowRunRow | undefined;
    return row ? rowToWorkflowRun(row) : null;
  }

  getWorkflowRunsByStatus(statuses: WorkflowRunStatus[]): WorkflowRun[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM workflow_runs WHERE status IN (${placeholders}) ORDER BY last_activity_at DESC`
      )
      .all(...statuses) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  getWorkflowRunsByName(workflowName: string): WorkflowRun[] {
    if (!this.stmts.getWorkflowRunsByName) {
      this.stmts.getWorkflowRunsByName = this.db.prepare(
        `SELECT * FROM workflow_runs WHERE workflow_name = ? ORDER BY last_activity_at DESC`
      );
    }
    const rows = this.stmts.getWorkflowRunsByName.all(workflowName) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  getAllWorkflowRuns(limit: number = 50): WorkflowRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ORDER BY last_activity_at DESC LIMIT ?`)
      .all(limit) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  }

  // ===========================================================================
  // Workflow events (fire-and-forget log)
  // ===========================================================================

  insertWorkflowEvent(event: Omit<WorkflowEvent, 'id'>): void {
    if (!this.stmts.insertWorkflowEvent) {
      this.stmts.insertWorkflowEvent = this.db.prepare(`
        INSERT INTO workflow_events (
          workflow_run_id, event_type, step_id, step_kind, data, created_at
        ) VALUES (@workflowRunId, @eventType, @stepId, @stepKind, @data, @createdAt)
      `);
    }
    try {
      this.stmts.insertWorkflowEvent.run({
        workflowRunId: event.workflowRunId,
        eventType: event.eventType,
        stepId: event.stepId ?? null,
        stepKind: event.stepKind ?? null,
        data: event.data ? JSON.stringify(event.data) : null,
        createdAt: event.createdAt,
      });
    } catch {
      // Fire-and-forget: never let event log failures break the executor.
    }
  }

  getEventsByRun(workflowRunId: string, limit: number = 1000): WorkflowEvent[] {
    if (!this.stmts.getEventsByRun) {
      this.stmts.getEventsByRun = this.db.prepare(
        `SELECT * FROM workflow_events WHERE workflow_run_id = ? ORDER BY created_at ASC LIMIT ?`
      );
    }
    const rows = this.stmts.getEventsByRun.all(workflowRunId, limit) as WorkflowEventRow[];
    return rows.map(rowToWorkflowEvent);
  }

  // ===========================================================================
  // Isolation environments (git worktrees)
  // ===========================================================================

  insertIsolationEnv(env: IsolationEnvironment): void {
    if (!this.stmts.insertIsolationEnv) {
      this.stmts.insertIsolationEnv = this.db.prepare(`
        INSERT INTO isolation_environments (
          id, workflow_run_id, workflow_name, working_path, branch_name,
          status, created_at, destroyed_at, metadata
        ) VALUES (
          @id, @workflowRunId, @workflowName, @workingPath, @branchName,
          @status, @createdAt, @destroyedAt, @metadata
        )
      `);
    }
    this.stmts.insertIsolationEnv.run({
      id: env.id,
      workflowRunId: env.workflowRunId ?? null,
      workflowName: env.workflowName,
      workingPath: env.workingPath,
      branchName: env.branchName,
      status: env.status,
      createdAt: env.createdAt,
      destroyedAt: env.destroyedAt ?? null,
      metadata: env.metadata ? JSON.stringify(env.metadata) : null,
    });
  }

  updateIsolationEnv(env: IsolationEnvironment): void {
    if (!this.stmts.updateIsolationEnv) {
      this.stmts.updateIsolationEnv = this.db.prepare(`
        UPDATE isolation_environments SET
          workflow_run_id = @workflowRunId,
          status = @status,
          destroyed_at = @destroyedAt,
          metadata = @metadata
        WHERE id = @id
      `);
    }
    this.stmts.updateIsolationEnv.run({
      id: env.id,
      workflowRunId: env.workflowRunId ?? null,
      status: env.status,
      destroyedAt: env.destroyedAt ?? null,
      metadata: env.metadata ? JSON.stringify(env.metadata) : null,
    });
  }

  getIsolationEnvById(id: string): IsolationEnvironment | null {
    if (!this.stmts.getIsolationEnvById) {
      this.stmts.getIsolationEnvById = this.db.prepare(
        'SELECT * FROM isolation_environments WHERE id = ?'
      );
    }
    const row = this.stmts.getIsolationEnvById.get(id) as IsolationEnvRow | undefined;
    return row ? rowToIsolationEnv(row) : null;
  }

  getActiveIsolationEnvByRun(workflowRunId: string): IsolationEnvironment | null {
    if (!this.stmts.getActiveIsolationEnvByRun) {
      this.stmts.getActiveIsolationEnvByRun = this.db.prepare(
        `SELECT * FROM isolation_environments WHERE workflow_run_id = ? AND status = 'active' LIMIT 1`
      );
    }
    const row = this.stmts.getActiveIsolationEnvByRun.get(workflowRunId) as
      | IsolationEnvRow
      | undefined;
    return row ? rowToIsolationEnv(row) : null;
  }

  getAllActiveIsolationEnvs(): IsolationEnvironment[] {
    if (!this.stmts.getAllActiveIsolationEnvs) {
      this.stmts.getAllActiveIsolationEnvs = this.db.prepare(
        `SELECT * FROM isolation_environments WHERE status = 'active'`
      );
    }
    const rows = this.stmts.getAllActiveIsolationEnvs.all() as IsolationEnvRow[];
    return rows.map(rowToIsolationEnv);
  }
}
