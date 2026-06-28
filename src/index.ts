/**
 * SpecShip
 *
 * A local-first code intelligence system that builds a semantic
 * knowledge graph from any codebase.
 */

import * as path from 'path';
import {
  Node,
  Edge,
  FileRecord,
  ExtractionResult,
  Subgraph,
  TraversalOptions,
  SearchOptions,
  SearchResult,
  Context,
  GraphStats,
  TaskInput,
  TaskContext,
  BuildContextOptions,
  FindRelevantContextOptions,
} from './types';
import { DatabaseConnection, getDatabasePath } from './db';
import { QueryBuilder } from './db/queries';
import {
  isInitialized,
  createDirectory,
  removeDirectory,
  validateDirectory,
  getSpecShipDir,
} from './directory';
import { writeStatuslineCache } from './statusline';
import {
  ExtractionOrchestrator,
  IndexProgress,
  IndexResult,
  SyncResult,
  extractFromSource,
  initGrammars,
} from './extraction';
import { MarkdownSpecExtractor } from './extraction/specs/markdown-spec-extractor';
import {
  ReferenceResolver,
  createResolver,
  ResolutionResult,
} from './resolution';
import { SpecLinkResolver, SpecLinkResolverStats } from './resolution/spec-link-resolver';
import { computeSpecFunnel, SpecFunnel } from './resolution/brief-link-resolver';
import { computeDomainGapSeed, DomainGapSeed } from './resolution/domain-gap-seed';
import { SpecQueries } from './db/spec-queries';
import {
  analyze as reflectAnalyzeImpl,
  sweep as reflectSweepImpl,
  ReflectStore,
  previewProposal,
  applyProposal,
  undoProposal,
  AnalyzeResult,
  SweepResult,
  Proposal,
  ProposalState,
  PreviewResult,
  ApplyOutcome,
  UndoOutcome,
} from './reflect';
import * as os from 'os';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { GraphTraverser, GraphQueryManager } from './graph';
import {
  computeMaintainability,
  resolveThresholds,
  resolveExclude,
  MaintainabilityReport,
  MaintainabilityThresholds,
} from './graph/maintainability';
import {
  evaluateFitness,
  loadFitnessRules,
  FitnessReport,
  FitnessRule,
} from './fitness/fitness';
import {
  evaluateEnforcement,
  loadEnforceConfig,
  EnforceConfig,
  EnforceReport,
  RequirementVerification,
} from './enforce/enforce';
import { computeBehaviourSurface, BehaviourSurface } from './behaviour/behaviour-surface';
import { ContextBuilder, createContextBuilder } from './context';
import { Mutex, FileLock } from './utils';
import { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';

// Re-export types for consumers
export * from './types';
// Storage building blocks for embedded/SDK consumers that drive the graph
// directly (open a DB, run prepared queries) rather than through the SpecShip
// facade. Exposed from the package entry so they no longer require deep imports
// into dist/ (issue #354).
export { getDatabasePath, DatabaseConnection } from './db';
export { QueryBuilder } from './db/queries';
export {
  getSpecShipDir,
  isInitialized,
  findNearestSpecShipRoot,
  SPECSHIP_DIR,
} from './directory';
export { IndexProgress, IndexResult, SyncResult } from './extraction';
export { detectLanguage, isLanguageSupported, isGrammarLoaded, getSupportedLanguages, initGrammars, loadGrammarsForLanguages, loadAllGrammars } from './extraction';
export { ResolutionResult } from './resolution';
export {
  computeSpecFunnel,
  resolveBriefLink,
  summarizeBriefFunnel,
  findBriefsForSpec,
} from './resolution/brief-link-resolver';
export type {
  SpecFunnel,
  SpecFunnelSummary,
  SpecFunnelDoc,
  BriefLink,
  BriefLinkState,
  BriefRollup,
  BriefFunnelEntry,
} from './resolution/brief-link-resolver';
export { computeDomainGapSeed } from './resolution/domain-gap-seed';
export type {
  DomainGapSeed,
  GapSeedEntity,
  GapSeedSpec,
  DomainCoverage,
} from './resolution/domain-gap-seed';
// Reflection engine (REFLECT-DOC) — proposals mined from transcripts.
export {
  analyze as reflectAnalyze,
  sweep as reflectSweep,
  ReflectStore,
  previewProposal,
  applyProposal,
  undoProposal,
} from './reflect';
export type {
  Proposal,
  ProposalType,
  ProposalSeverity,
  ProposalState,
  TargetKind,
  ProposalEvidence,
  ProposalPayload,
  PreviewResult,
  ApplyOutcome,
  UndoOutcome,
  ReflectContext,
  AnalyzeResult,
  SweepResult,
} from './reflect';
// Maintainability harness (MAINT-DOC / REQ-MAINT-001).
export { computeMaintainability, resolveThresholds, resolveExclude, DEFAULT_THRESHOLDS, DEFAULT_EXCLUDE, CONFIG_FILE_NAME } from './graph/maintainability';
// Architecture-fitness harness (FITNESS-DOC / REQ-FITNESS-001…003).
export { evaluateFitness, loadFitnessRules, FITNESS_CONFIG_FILE } from './fitness/fitness';
// Enforcement mode (ENFORCE-DOC / REQ-ENFORCE-001…003).
export { evaluateEnforcement, loadEnforceConfig, ENFORCE_CONFIG_FILE } from './enforce/enforce';
// Behaviour surface (BEHAVIOUR-DOC / REQ-BEHAVIOUR-001).
export { computeBehaviourSurface, renderBehaviourSurface, isUiNode } from './behaviour/behaviour-surface';
export type { BehaviourSurface, BehaviourFlowElement, BehaviourSurfaceDeps } from './behaviour/behaviour-surface';
export type {
  EnforceConfig,
  GateConfig,
  EnforceReport,
  EnforceDeps,
  CheckOutcome,
  CheckName,
  RequirementVerification,
} from './enforce/enforce';
export type {
  FitnessRule,
  ForbiddenRule,
  LayersRule,
  IsolationRule,
  FitnessReport,
  FitnessViolation,
  FitnessConfigError,
  Selector,
} from './fitness/fitness';
export type {
  MaintainabilityReport,
  MaintainabilityThresholds,
  CouplingFinding,
  OversizedFinding,
  GodFileFinding,
  CycleFinding,
  DeadCodeFinding,
} from './graph/maintainability';
export {
  SpecShipError,
  FileError,
  ParseError,
  DatabaseError,
  SearchError,
  VectorError,
  ConfigError,
  Logger,
  setLogger,
  getLogger,
  silentLogger,
  defaultLogger,
} from './errors';
export { Mutex, FileLock, processInBatches, debounce, throttle, MemoryMonitor } from './utils';
export { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';
export { MCPServer } from './mcp';

/**
 * Options for initializing a new SpecShip project
 */
export interface InitOptions {
  /** Whether to run initial indexing after init */
  index?: boolean;

  /** Progress callback for indexing */
  onProgress?: (progress: IndexProgress) => void;
}

/**
 * Options for opening an existing SpecShip project
 */
export interface OpenOptions {
  /** Whether to run sync if files have changed */
  sync?: boolean;

  /** Whether to run in read-only mode */
  readOnly?: boolean;
}

/**
 * Options for indexing
 */
export interface IndexOptions {
  /** Progress callback */
  onProgress?: (progress: IndexProgress) => void;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Enable verbose logging (worker lifecycle, memory, timeouts) */
  verbose?: boolean;
}

/**
 * Main SpecShip class
 *
 * Provides the primary interface for interacting with the code knowledge graph.
 */
export class SpecShip {
  private db: DatabaseConnection;
  private queries: QueryBuilder;
  private specQueries: SpecQueries;
  private projectRoot: string;
  private orchestrator: ExtractionOrchestrator;
  private resolver: ReferenceResolver;
  private specLinkResolver: SpecLinkResolver;
  private graphManager: GraphQueryManager;
  private traverser: GraphTraverser;
  private contextBuilder: ContextBuilder;

  // Mutex for preventing concurrent indexing operations (in-process)
  private indexMutex = new Mutex();

  // File lock for preventing concurrent writes across processes (CLI, MCP, git hooks)
  private fileLock: FileLock;

  // File watcher for auto-sync on file changes
  private watcher: FileWatcher | null = null;

  private constructor(
    db: DatabaseConnection,
    queries: QueryBuilder,
    projectRoot: string
  ) {
    this.db = db;
    this.queries = queries;
    this.specQueries = new SpecQueries(db.getDb());
    this.projectRoot = projectRoot;
    this.fileLock = new FileLock(
      path.join(getSpecShipDir(projectRoot), 'specship.lock')
    );
    this.orchestrator = new ExtractionOrchestrator(projectRoot, queries);
    this.resolver = createResolver(projectRoot, queries);
    this.specLinkResolver = new SpecLinkResolver(queries, this.specQueries);
    this.graphManager = new GraphQueryManager(queries);
    this.traverser = new GraphTraverser(queries);
    this.contextBuilder = createContextBuilder(
      projectRoot,
      queries,
      this.traverser
    );
  }

  /** Access to the spec queries (for MCP tools, CLI commands, embedded SDK users). */
  getSpecQueries(): SpecQueries {
    return this.specQueries;
  }

  /** Access to the spec link resolver. */
  getSpecLinkResolver(): SpecLinkResolver {
    return this.specLinkResolver;
  }

  /**
   * The project-wide spec lifecycle funnel: brainstormed ideas → specs →
   * implemented, with per-document rollups (REQ-FUNNEL-006). Exposed on the
   * instance so the desktop server can serve it without runtime-importing the
   * package (it calls this on the dynamically-loaded SpecShip).
   */
  getSpecFunnel(): SpecFunnel {
    return computeSpecFunnel(this.specQueries);
  }

  /**
   * The domain gap-seed (REQ-DOMAIN-003): the structural code entities and
   * non-domain specs that no domain fact yet covers, plus a coverage tally.
   * Read-only — computed from live state, writes nothing. Exposed on the
   * instance so the `/ss-domain` command and the desktop server can drive it
   * without runtime-importing the package.
   */
  getDomainGapSeed(): DomainGapSeed {
    return computeDomainGapSeed(this.queries, this.specQueries, this.specLinkResolver);
  }

  /**
   * The maintainability harness (REQ-MAINT-001): coupling, size hotspots,
   * dependency cycles, and dead-code candidates, derived from the graph with no
   * additional parse. Read-only and deterministic. Exposed on the instance so
   * the CLI / MCP / desktop server can drive it without runtime-importing the
   * package.
   */
  getMaintainability(thresholds?: Partial<MaintainabilityThresholds>): MaintainabilityReport {
    return computeMaintainability(
      this.queries,
      resolveThresholds(this.projectRoot, thresholds),
      resolveExclude(this.projectRoot),
    );
  }

  /**
   * The architecture-fitness harness (REQ-FITNESS-001/002): evaluate declarative
   * architecture rules (from specship.config.json `fitness.rules`, or an explicit
   * override) against the graph. Read-only, deterministic. Exposed on the
   * instance so the CLI / MCP / server drive it without runtime-importing the
   * package.
   */
  getFitness(rules?: FitnessRule[]): FitnessReport {
    return evaluateFitness(this.queries, rules ?? loadFitnessRules(this.projectRoot));
  }

  /**
   * Enforcement mode (REQ-ENFORCE-001/002/003): compose drift + fitness +
   * maintainability + the spec→test→verify behaviour chain into one gate. Which
   * checks gate vs advise comes from specship.config.json `enforce` (or an
   * explicit override); with no config every check is advisory and the run
   * passes. The behaviour chain reads `tests`-kind spec-links on each requirement
   * and its acceptance criteria (verified = passing, broken = ran-and-failed).
   */
  getEnforce(config?: EnforceConfig): EnforceReport {
    const cfg = config ?? loadEnforceConfig(this.projectRoot);
    const sq = this.specQueries;
    const drift = sq.getLinksByState(['drifted', 'broken', 'orphaned']);
    const requirements: RequirementVerification[] = sq.getSpecsByKind('requirement').map((req) => {
      const testsLinks = sq.getLinksBySpec(req.id).filter((l) => l.kind === 'tests');
      for (const child of sq.getSpecsByParent(req.id)) {
        if (child.kind === 'acceptance') {
          testsLinks.push(...sq.getLinksBySpec(child.id).filter((l) => l.kind === 'tests'));
        }
      }
      return { id: req.id, title: req.title, testsLinks };
    });
    return evaluateEnforcement(
      { drift, fitness: this.getFitness(), maintainability: this.getMaintainability(), requirements },
      cfg,
    );
  }

  /**
   * The behaviour surface for a requirement (REQ-BEHAVIOUR-001): its linked code
   * plus the 1-hop route / component / handler neighbourhood, grouped UI vs
   * backend, so the `/ss-behaviour` skill can author end-to-end tests from one
   * call. Lives here as an instance method so the CLI / MCP / server drive it
   * without runtime-importing the package. A requirement (or its acceptance
   * children) supplies the linked nodes; their callers + callees supply the
   * neighbourhood.
   */
  getBehaviourSurface(specId: string): BehaviourSurface {
    const sq = this.specQueries;
    const req = sq.getSpecById(specId);
    if (!req) {
      return computeBehaviourSurface({
        requirementId: specId,
        requirementExists: false,
        linkedNodes: [],
        neighbourNodes: [],
      });
    }

    // Resolved nodes the requirement + its acceptance children link to.
    const linkIds = new Set<string>();
    const collect = (id: string): void => {
      for (const l of sq.getLinksBySpec(id)) {
        if (l.resolvedNodeId) linkIds.add(l.resolvedNodeId);
      }
    };
    collect(req.id);
    for (const child of sq.getSpecsByParent(req.id)) {
      if (child.kind === 'acceptance') collect(child.id);
    }

    const linkedNodes: Node[] = [];
    for (const id of linkIds) {
      const node = this.queries.getNodeById(id);
      if (node) linkedNodes.push(node);
    }

    // 1-hop caller/callee neighbourhood of the linked nodes.
    const neighbourById = new Map<string, Node>();
    for (const node of linkedNodes) {
      for (const { node: n } of this.traverser.getCallers(node.id, 1)) neighbourById.set(n.id, n);
      for (const { node: n } of this.traverser.getCallees(node.id, 1)) neighbourById.set(n.id, n);
    }

    return computeBehaviourSurface({
      requirementId: req.id,
      requirementExists: true,
      linkedNodes,
      neighbourNodes: [...neighbourById.values()],
    });
  }

  // ===========================================================================
  // Reflection engine (REFLECT-DOC)
  //
  // Mines the ingested claude_* transcript tables for recurring, actionable
  // patterns and turns them into durable, human-gated proposals. Exposed as
  // instance methods so the desktop server drives them on the live instance
  // (no runtime package import) and the CLI calls them directly.
  // ===========================================================================

  private reflectContext() {
    return { projectRoot: this.projectRoot, homeDir: os.homedir() };
  }

  /** Run a reflection pass, persist the batch, return the open proposals. */
  reflectAnalyze(): AnalyzeResult {
    return reflectAnalyzeImpl(this.db.getDb(), this.reflectContext());
  }

  /** Run a sweep: analyze + return new high-severity proposals to notify on. */
  reflectSweep(): SweepResult {
    return reflectSweepImpl(this.db.getDb(), this.reflectContext());
  }

  /** List persisted proposals, optionally filtered by state. */
  reflectList(state?: ProposalState): Proposal[] {
    return new ReflectStore(this.db.getDb()).list(state);
  }

  /** Fetch one proposal by its content hash. */
  reflectGet(hash: string): Proposal | null {
    return new ReflectStore(this.db.getDb()).get(hash);
  }

  /** Non-mutating preview of the change a proposal would make (REQ-REFLECT-003). */
  reflectPreview(hash: string): PreviewResult | null {
    const p = this.reflectGet(hash);
    return p ? previewProposal(p) : null;
  }

  /** Apply a proposal — write idempotently + reversibly, then record state. */
  reflectApply(hash: string): ApplyOutcome | null {
    const p = this.reflectGet(hash);
    if (!p) return null;
    const outcome = applyProposal(p, os.homedir());
    if (outcome === 'applied' || outcome === 'unchanged') {
      new ReflectStore(this.db.getDb()).setState(hash, 'applied');
    }
    return outcome;
  }

  /** Undo a previously applied proposal — remove exactly what apply added. */
  reflectUndo(hash: string): UndoOutcome | null {
    const p = this.reflectGet(hash);
    if (!p) return null;
    const outcome = undoProposal(p, os.homedir());
    new ReflectStore(this.db.getDb()).setState(hash, 'undone');
    return outcome;
  }

  /** Dismiss a proposal so it does not resurface on later sweeps (REQ-REFLECT-007.A2). */
  reflectDismiss(hash: string): boolean {
    const p = this.reflectGet(hash);
    if (!p) return false;
    new ReflectStore(this.db.getDb()).setState(hash, 'dismissed');
    return true;
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize a new SpecShip project
   *
   * Creates the .SpecShip directory, database, and configuration.
   *
   * @param projectRoot - Path to the project root directory
   * @param options - Initialization options
   * @returns A new SpecShip instance
   */
  static async init(projectRoot: string, options: InitOptions = {}): Promise<SpecShip> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    // Check if already initialized
    if (isInitialized(resolvedRoot)) {
      throw new Error(`SpecShip already initialized in ${resolvedRoot}`);
    }

    // Create directory structure
    createDirectory(resolvedRoot);

    // Initialize database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new SpecShip(db, queries, resolvedRoot);

    // Run initial indexing if requested
    if (options.index) {
      await instance.indexAll({ onProgress: options.onProgress });
    }

    return instance;
  }

  /**
   * Initialize synchronously (without indexing)
   */
  static initSync(projectRoot: string): SpecShip {
    const resolvedRoot = path.resolve(projectRoot);

    // Check if already initialized
    if (isInitialized(resolvedRoot)) {
      throw new Error(`SpecShip already initialized in ${resolvedRoot}`);
    }

    // Create directory structure
    createDirectory(resolvedRoot);

    // Initialize database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new SpecShip(db, queries, resolvedRoot);
  }

  /**
   * Open an existing SpecShip project
   *
   * @param projectRoot - Path to the project root directory
   * @param options - Open options
   * @returns A SpecShip instance
   */
  static async open(projectRoot: string, options: OpenOptions = {}): Promise<SpecShip> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    // Check if initialized
    if (!isInitialized(resolvedRoot)) {
      throw new Error(`SpecShip not initialized in ${resolvedRoot}. Run init() first.`);
    }

    // Validate directory structure
    const validation = validateDirectory(resolvedRoot);
    if (!validation.valid) {
      throw new Error(`Invalid SpecShip directory: ${validation.errors.join(', ')}`);
    }

    // Open database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new SpecShip(db, queries, resolvedRoot);

    // Sync if requested
    if (options.sync) {
      await instance.sync();
    }

    return instance;
  }

  /**
   * Open synchronously (without sync)
   */
  static openSync(projectRoot: string): SpecShip {
    const resolvedRoot = path.resolve(projectRoot);

    // Check if initialized
    if (!isInitialized(resolvedRoot)) {
      throw new Error(`SpecShip not initialized in ${resolvedRoot}. Run init() first.`);
    }

    // Validate directory structure
    const validation = validateDirectory(resolvedRoot);
    if (!validation.valid) {
      throw new Error(`Invalid SpecShip directory: ${validation.errors.join(', ')}`);
    }

    // Open database
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new SpecShip(db, queries, resolvedRoot);
  }

  /**
   * Check if a directory has been initialized as a SpecShip project
   */
  static isInitialized(projectRoot: string): boolean {
    return isInitialized(path.resolve(projectRoot));
  }

  /**
   * Close the SpecShip instance and release resources
   */
  close(): void {
    this.unwatch();
    // Release file lock if held
    this.fileLock.release();
    this.db.close();
  }

  /**
   * Get the project root directory
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  // ===========================================================================
  // Indexing
  // ===========================================================================

  /**
   * Index all files in the project
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async indexAll(options: IndexOptions = {}): Promise<IndexResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0, nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'Could not acquire file lock - another process may be indexing', severity: 'error' as const }], durationMs: 0 };
      }
      try {
        const before = this.queries.getNodeAndEdgeCount();
        const result = await this.orchestrator.indexAll(options.onProgress, options.signal, options.verbose);

        // Re-detect frameworks now that the index is populated. The resolver
        // is constructed with createResolver() before any files exist, so
        // framework resolvers whose detect() consults the indexed file list
        // (e.g. UIKit/SwiftUI scanning for imports, swift-objc-bridge looking
        // for both Swift and ObjC files) all return false on that initial pass
        // and silently drop themselves. Re-initializing here gives them a
        // chance to see the actual project before resolution runs.
        if (result.success && result.filesIndexed > 0) {
          this.resolver.initialize();
          // Cross-file finalization (e.g. NestJS RouterModule prefixes). Runs
          // before resolution so updated names show up in subsequent reads.
          this.resolver.runPostExtract();
        }

        // Resolve references to create call/import/extends edges
        if (result.success && result.filesIndexed > 0) {
          // Get count without loading all refs into memory
          const unresolvedCount = this.queries.getUnresolvedReferencesCount();

          options.onProgress?.({
            phase: 'resolving',
            current: 0,
            total: unresolvedCount,
          });

          await this.resolveReferencesBatched((current, total) => {
            options.onProgress?.({
              phase: 'resolving',
              current,
              total,
            });
          });
        }

        // Refresh planner stats + checkpoint the WAL after bulk writes.
        // Cheap and non-blocking; never load-bearing for correctness.
        if (result.success && result.filesIndexed > 0) {
          this.db.runMaintenance();
        }

        // Spec extraction runs after code so spec-declared `implementations:`
        // links can resolve against the freshly-indexed nodes. Code-comment
        // links also get scanned here. Best-effort: a spec parse error never
        // fails the overall index.
        if (result.success) {
          try {
            // Release the lock before re-acquiring inside indexSpecs (mutex
            // is re-entrant via withLock chaining; the file lock isn't).
            this.fileLock.release();
            await this.indexSpecsInternal();
            // Re-acquire so the outer finally can release once.
            this.fileLock.acquire();
          } catch (err) {
            // Spec failures are non-fatal in v1. Surface via errors array.
            result.errors.push({
              message: `Spec indexing failed: ${err instanceof Error ? err.message : String(err)}`,
              severity: 'warning',
            });
          }
        }

        // The orchestrator only sees extraction-phase counts; resolution and
        // synthesizer edges (often >50% of the graph on JVM repos) come later.
        // Recompute against the DB so the CLI summary reports the true totals.
        if (result.success && result.filesIndexed > 0) {
          const after = this.queries.getNodeAndEdgeCount();
          result.nodesCreated = after.nodes - before.nodes;
          result.edgesCreated = after.edges - before.edges;
        }

        this.refreshStatuslineCache();
        return result;
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Refresh `.specship/statusline.json` so the `specship statusline` segment
   * has current Tier-A data without ever opening the DB itself
   * (REQ-STATUSLINE-003). Best-effort: a failure here must never break the
   * index/sync operation that triggered it, so the producer swallows its own
   * errors and this wrapper guards the data-gathering too.
   */
  private refreshStatuslineCache(): void {
    try {
      const stats = this.getStats();
      const changes = this.getChangedFiles();
      const drift = this.specQueries.getLinksByState(['drifted', 'broken', 'orphaned']).length;
      writeStatuslineCache(this.projectRoot, {
        initialized: true,
        pending: {
          added: changes.added.length,
          modified: changes.modified.length,
          removed: changes.removed.length,
        },
        drift,
        backend: this.getBackend(),
        degraded: this.getJournalMode() !== 'wal',
        fileCount: stats.fileCount,
        nodeCount: stats.nodeCount,
        lastIndexed: this.getLastIndexedAt(),
      });
    } catch {
      /* best-effort — never let a cache refresh affect indexing */
    }
  }

  /**
   * Internal spec indexing — does NOT take the indexMutex (caller already holds it)
   * and does NOT take the fileLock. Used by indexAll which manages locks itself.
   */
  private async indexSpecsInternal(): Promise<void> {
    const specRoots = this.defaultSpecRoots();
    if (specRoots.length === 0) return;
    const specFiles: string[] = [];
    for (const root of specRoots) {
      this.collectSpecFiles(root, specFiles);
    }

    for (const absPath of specFiles) {
      const rel = path.relative(this.projectRoot, absPath);
      let source: string;
      let stat: fs.Stats;
      try {
        source = fs.readFileSync(absPath, 'utf-8');
        stat = fs.statSync(absPath);
      } catch {
        continue;
      }
      const hashHex = createHash('sha256').update(source).digest('hex').substring(0, 32);
      const existing = this.specQueries.getSpecFileByPath(rel);
      if (existing && existing.contentHash === hashHex) continue;

      this.specQueries.deleteSpecsByFile(rel);
      const result = new MarkdownSpecExtractor(rel, source).extract();
      this.specQueries.insertSpecsBatch(result.specs);
      this.specQueries.upsertSpecFile({
        path: rel,
        contentHash: hashHex,
        format: 'markdown',
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        indexedAt: Date.now(),
        specCount: result.specs.length,
        errors: result.errors,
      });

      const specsById = new Map(result.specs.map((s) => [s.id, s]));
      this.specLinkResolver.applyDeclarationCandidates(result.linkCandidates, specsById);
      for (const spec of result.specs) {
        this.specLinkResolver.markSpecDrifted(spec.id, spec.contentHash);
      }
    }

    const allFiles = this.queries.getAllFiles().map((f) => f.path);
    this.specLinkResolver.applyCodeCommentLinks(allFiles);
    this.specLinkResolver.resolveAll();
  }

  /**
   * Index spec files (Markdown only in v1).
   *
   * Default spec roots: `<projectRoot>/specs/` if it exists. Callers can
   * pass explicit roots/files for non-default layouts.
   *
   * Pipeline per file:
   *   1. Hash file content; skip if `spec_files.content_hash` matches.
   *   2. Delete prior specs for this file (cascade-deletes children, links).
   *   3. Run MarkdownSpecExtractor → insert specs + virtual node projections.
   *   4. Apply `spec-declaration` link candidates from `implementations:`.
   *   5. Mark previously-linked specs as drifted (drift_axis='spec') when
   *      their content_hash has changed.
   *
   * Returns extraction stats including spec link resolver effects.
   */
  async indexSpecs(roots?: string[]): Promise<{
    filesProcessed: number;
    filesSkipped: number;
    specsExtracted: number;
    linkCandidates: number;
    resolverStats: SpecLinkResolverStats;
    errors: number;
    durationMs: number;
  }> {
    const start = Date.now();
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return {
          filesProcessed: 0,
          filesSkipped: 0,
          specsExtracted: 0,
          linkCandidates: 0,
          resolverStats: {
            scanned: 0,
            reresolved: 0,
            orphaned: 0,
            driftedCode: 0,
            candidatesApplied: 0,
            commentLinksApplied: 0,
          },
          errors: 0,
          durationMs: Date.now() - start,
        };
      }
      try {
        const specRoots = roots && roots.length > 0 ? roots : this.defaultSpecRoots();
        const specFiles: string[] = [];
        for (const root of specRoots) {
          this.collectSpecFiles(root, specFiles);
        }

        let processed = 0;
        let skipped = 0;
        let totalSpecs = 0;
        let totalCandidates = 0;
        let totalErrors = 0;
        const stats: SpecLinkResolverStats = {
          scanned: 0,
          reresolved: 0,
          orphaned: 0,
          driftedCode: 0,
          candidatesApplied: 0,
          commentLinksApplied: 0,
        };

        for (const absPath of specFiles) {
          const rel = path.relative(this.projectRoot, absPath);
          let source: string;
          let stat: fs.Stats;
          try {
            source = fs.readFileSync(absPath, 'utf-8');
            stat = fs.statSync(absPath);
          } catch {
            continue;
          }
          const hashHex = createHash('sha256').update(source).digest('hex').substring(0, 32);
          const existing = this.specQueries.getSpecFileByPath(rel);
          if (existing && existing.contentHash === hashHex) {
            skipped++;
            continue;
          }

          // Replace prior specs for this file. CASCADE removes children +
          // spec_links FK'd on spec_id.
          this.specQueries.deleteSpecsByFile(rel);

          const result = new MarkdownSpecExtractor(rel, source).extract();
          this.specQueries.insertSpecsBatch(result.specs);
          this.specQueries.upsertSpecFile({
            path: rel,
            contentHash: hashHex,
            format: 'markdown',
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            indexedAt: Date.now(),
            specCount: result.specs.length,
            errors: result.errors,
          });

          // Apply spec-declared `implementations:` link candidates.
          const specsById = new Map(result.specs.map((s) => [s.id, s]));
          this.specLinkResolver.applyDeclarationCandidates(
            result.linkCandidates,
            specsById,
            stats
          );

          // Spec-side drift: if any prior link's specHashAtLink differs from
          // the new contentHash of its spec, flip the link to drifted(spec).
          for (const spec of result.specs) {
            this.specLinkResolver.markSpecDrifted(spec.id, spec.contentHash);
          }

          processed++;
          totalSpecs += result.specs.length;
          totalCandidates += result.linkCandidates.length;
          totalErrors += result.errors.filter((e) => e.severity === 'error').length;
        }

        // After spec changes settle, also scan code docstrings for
        // `@implements REQ-X` markers. Bounded to the files that already
        // have nodes in the graph (full-graph scan is acceptable here —
        // node count is bounded and the scan is O(N) regex over docstrings).
        const allFiles = this.queries.getAllFiles().map((f) => f.path);
        this.specLinkResolver.applyCodeCommentLinks(allFiles, stats);

        // Re-resolve all links (post-extraction).
        const resolveStats = this.specLinkResolver.resolveAll();
        stats.scanned += resolveStats.scanned;
        stats.reresolved += resolveStats.reresolved;
        stats.orphaned += resolveStats.orphaned;
        stats.driftedCode += resolveStats.driftedCode;

        return {
          filesProcessed: processed,
          filesSkipped: skipped,
          specsExtracted: totalSpecs,
          linkCandidates: totalCandidates,
          resolverStats: stats,
          errors: totalErrors,
          durationMs: Date.now() - start,
        };
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Default spec roots: `<projectRoot>/specs/` if it exists. Future
   * iterations can read from `.specship/config.json`.
   */
  private defaultSpecRoots(): string[] {
    const candidate = path.join(this.projectRoot, 'specs');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return [candidate];
    } catch {
      // No specs/ directory — return empty so indexSpecs is a no-op.
    }
    return [];
  }

  /**
   * Recursively collect `.md` files from a directory.
   */
  private collectSpecFiles(root: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden/system directories
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        this.collectSpecFiles(full, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }

  /**
   * Index specific files
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async indexFiles(filePaths: string[]): Promise<IndexResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0, nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'Could not acquire file lock - another process may be indexing', severity: 'error' as const }], durationMs: 0 };
      }
      try {
        return this.orchestrator.indexFiles(filePaths);
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Sync with current file state (incremental update)
   *
   * Uses a mutex to prevent concurrent indexing operations.
   */
  async sync(options: IndexOptions = {}): Promise<SyncResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0 };
      }
      try {
        const result = await this.orchestrator.sync(options.onProgress);

        // Cross-file finalization (e.g. NestJS RouterModule prefixes). Run on
        // every sync that touched files so edits to `app.module.ts` propagate
        // to controllers in unchanged files. The pass is idempotent and cheap
        // (regex over *.module.ts only).
        if (result.filesAdded > 0 || result.filesModified > 0) {
          this.resolver.runPostExtract();
        }

        // Resolve references if files were updated
        if (result.filesAdded > 0 || result.filesModified > 0) {
          if (result.changedFilePaths) {
            // Scope resolution to changed files (git fast path — bounded set)
            const unresolvedRefs = this.queries.getUnresolvedReferencesByFiles(result.changedFilePaths);

            options.onProgress?.({
              phase: 'resolving',
              current: 0,
              total: unresolvedRefs.length,
            });

            this.resolver.resolveAndPersist(unresolvedRefs, (current, total) => {
              options.onProgress?.({
                phase: 'resolving',
                current,
                total,
              });
            });
          } else {
            // No git info — use batched resolution to avoid OOM
            const unresolvedCount = this.queries.getUnresolvedReferencesCount();

            options.onProgress?.({
              phase: 'resolving',
              current: 0,
              total: unresolvedCount,
            });

            await this.resolveReferencesBatched((current, total) => {
              options.onProgress?.({
                phase: 'resolving',
                current,
                total,
              });
            });
          }
        }

        // Refresh planner stats + checkpoint the WAL after bulk writes.
        if (result.filesAdded > 0 || result.filesModified > 0 || result.filesRemoved > 0) {
          this.db.runMaintenance();
        }

        this.refreshStatuslineCache();
        return result;
      } finally {
        this.fileLock.release();
      }
    });
  }

  /**
   * Check if an indexing operation is currently in progress
   */
  isIndexing(): boolean {
    return this.indexMutex.isLocked();
  }

  // ===========================================================================
  // File Watching
  // ===========================================================================

  /**
   * Start watching for file changes and auto-syncing.
   *
   * Uses native OS file events (FSEvents on macOS, inotify on Linux 19+,
   * ReadDirectoryChangesW on Windows) with debouncing to avoid thrashing.
   *
   * @param options - Watch options (debounce delay, callbacks)
   * @returns true if watching started successfully
   */
  watch(options: WatchOptions = {}): boolean {
    if (this.watcher?.isActive()) return true;

    this.watcher = new FileWatcher(
      this.projectRoot,
      async () => {
        const result = await this.sync();
        // sync() returns this exact zero-shape iff it failed to acquire the
        // file lock (a real empty sync always has filesChecked > 0 because
        // scanDirectory ran). Surface that to the watcher as a typed error
        // so it keeps pendingFiles + reschedules instead of clearing them
        // (#449).
        if (result.filesChecked === 0 && result.durationMs === 0) {
          throw new LockUnavailableError();
        }
        const filesChanged = result.filesAdded + result.filesModified + result.filesRemoved;
        return { filesChanged, durationMs: result.durationMs };
      },
      options
    );

    return this.watcher.start();
  }

  /**
   * Stop watching for file changes.
   */
  unwatch(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  /**
   * Check if the file watcher is active.
   */
  isWatching(): boolean {
    return this.watcher?.isActive() ?? false;
  }

  /**
   * Files seen by the file watcher since the last successful sync —
   * the per-file "stale" signal MCP tools attach to responses so an agent
   * can fall back to {@link Read} for just the affected file without
   * waiting for a debounced sync to complete (issue #403).
   *
   * Returns an empty list when the watcher isn't active, or no events have
   * arrived. Each entry includes `firstSeenMs` and `lastSeenMs` (wall-clock
   * `Date.now()` values) so callers can render "edited Nms ago", plus an
   * `indexing` flag indicating whether the in-flight sync (if any) will
   * absorb that file.
   */
  getPendingFiles(): PendingFile[] {
    return this.watcher?.getPendingFiles() ?? [];
  }

  /**
   * Resolves once the file watcher has installed its watch set. Useful for
   * tests that need a deterministic boundary before asserting on
   * `getPendingFiles()`. Resolves immediately when no watcher is active.
   */
  waitUntilWatcherReady(timeoutMs?: number): Promise<void> {
    return this.watcher ? this.watcher.waitUntilReady(timeoutMs) : Promise.resolve();
  }

  /**
   * Get files that have changed since last index
   */
  getChangedFiles(): { added: string[]; modified: string[]; removed: string[] } {
    return this.orchestrator.getChangedFiles();
  }

  /**
   * Most recent index timestamp (ms since epoch) across all tracked files, or
   * null when nothing is indexed yet. Lets library consumers check index
   * freshness without shelling out to `specship status --json`. (#329)
   */
  getLastIndexedAt(): number | null {
    return this.queries.getLastIndexedAt();
  }

  /**
   * Extract nodes and edges from source code (without storing)
   */
  extractFromSource(filePath: string, source: string): ExtractionResult {
    return extractFromSource(filePath, source);
  }

  // ===========================================================================
  // Reference Resolution
  // ===========================================================================

  /**
   * Resolve unresolved references and create edges
   *
   * This method takes unresolved references from extraction and attempts
   * to resolve them using multiple strategies:
   * - Framework-specific patterns (React, Express, Laravel)
   * - Import-based resolution
   * - Name-based symbol matching
   */
  resolveReferences(onProgress?: (current: number, total: number) => void): ResolutionResult {
    // Get all unresolved references from the database
    const unresolvedRefs = this.queries.getUnresolvedReferences();
    return this.resolver.resolveAndPersist(unresolvedRefs, onProgress);
  }

  /**
   * Resolve references in batches to keep memory bounded on large codebases.
   * Processes chunks of unresolved refs, persisting results after each batch.
   */
  async resolveReferencesBatched(onProgress?: (current: number, total: number) => void): Promise<ResolutionResult> {
    return this.resolver.resolveAndPersistBatched(onProgress);
  }

  /**
   * Get detected frameworks in the project
   */
  getDetectedFrameworks(): string[] {
    return this.resolver.getDetectedFrameworks();
  }

  /**
   * Re-initialize the resolver (useful after adding new files)
   */
  reinitializeResolver(): void {
    this.resolver.initialize();
  }

  // ===========================================================================
  // Graph Statistics
  // ===========================================================================

  /**
   * Get statistics about the knowledge graph
   */
  getStats(): GraphStats {
    const stats = this.queries.getStats();
    stats.dbSizeBytes = this.db.getSize();
    return stats;
  }

  /**
   * Active SQLite backend for this project's connection (`node-sqlite` — Node's
   * built-in real-SQLite module). Surfaced via `specship status` and the
   * `specship_status` MCP tool alongside the effective journal mode.
   */
  getBackend(): import('./db').SqliteBackend {
    return this.db.getBackend();
  }

  /**
   * The journal mode actually in effect ('wal', 'delete', …). 'wal' means
   * readers never block on a concurrent writer; anything else means they can,
   * which is the precondition for the "database is locked" failures in issue
   * #238. Surfaced via `specship status` and the `specship_status` MCP tool.
   */
  getJournalMode(): string {
    return this.db.getJournalMode();
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Get a node by ID
   */
  getNode(id: string): Node | null {
    return this.queries.getNodeById(id);
  }

  /**
   * Get all nodes in a file
   */
  getNodesInFile(filePath: string): Node[] {
    return this.queries.getNodesByFile(filePath);
  }

  /**
   * Get all nodes of a specific kind
   */
  getNodesByKind(kind: Node['kind']): Node[] {
    return this.queries.getNodesByKind(kind);
  }

  /**
   * Get ALL nodes with an exact name (direct index lookup, not FTS-ranked/capped).
   * Used to enumerate every overload of a heavily-overloaded name so the specific
   * definition the caller wants is never dropped below a search cut.
   */
  getNodesByName(name: string): Node[] {
    return this.queries.getNodesByName(name);
  }

  /**
   * Search nodes by text
   */
  searchNodes(query: string, options?: SearchOptions): SearchResult[] {
    return this.queries.searchNodes(query, options);
  }

  /**
   * Find the project's "primary route file" — the file with the densest
   * concentration of framework-emitted `route` nodes (≥3 routes, ≥30%
   * of all non-test routes). Used to inline the routing config in
   * `specship_explore` responses on small realworld template repos
   * (rails-realworld, laravel-realworld, drupal-admintoolbar, …) where
   * Glob+Read of `routes.rb`/`urls.py`/etc. otherwise beats specship.
   */
  getTopRouteFile(): { filePath: string; routeCount: number; totalRoutes: number } | null {
    return this.queries.getTopRouteFile();
  }

  /**
   * Build a URL → handler routing manifest from the index. Each entry
   * pairs a route node (URL + method) with its handler function/method
   * via the `references` edge that framework resolvers emit. Returns
   * null when fewer than 3 valid (non-test) routes exist.
   */
  getRoutingManifest(limit?: number): {
    entries: Array<{ url: string; handler: string; handlerFile: string; handlerLine: number; handlerKind: string }>;
    topHandlerFile: string | null;
    topHandlerFileCount: number;
    totalRoutes: number;
  } | null {
    return this.queries.getRoutingManifest(limit);
  }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  /**
   * Get outgoing edges from a node
   */
  getOutgoingEdges(nodeId: string): Edge[] {
    return this.queries.getOutgoingEdges(nodeId);
  }

  /**
   * Get incoming edges to a node
   */
  getIncomingEdges(nodeId: string): Edge[] {
    return this.queries.getIncomingEdges(nodeId);
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Get a file record by path
   */
  getFile(filePath: string): FileRecord | null {
    return this.queries.getFileByPath(filePath);
  }

  /**
   * Get all tracked files
   */
  getFiles(): FileRecord[] {
    return this.queries.getAllFiles();
  }

  /**
   * Estimate the set of files an agent would have needed to Read if it had
   * NOT used the SpecShip graph to answer a query involving `symbols`.
   *
   * For each symbol name in `symbols`, `getNodesByName` is called (exact-match,
   * no FTS) and the distinct project-relative file paths of the returned nodes
   * are collected, capped at 5 files per symbol to avoid god-name blowup (a
   * single overly-common name like `handle` should not pull in the whole repo).
   * File paths are then deduped across all symbols and each path's byte size is
   * looked up via `getFile(path)`.
   *
   * Returns:
   *   - `files`: array of `{ path: string; size: number }` with project-relative
   *     paths (matching `Node.filePath` / `FileRecord.path`). Callers can dedup
   *     across multiple calls before summing.
   *   - `resolved`: `true` when at least one file was found; `false` is the
   *     safe "we couldn't estimate, claim nothing" sentinel.
   *
   * Synchronous — the graph is already open in memory like other query methods.
   */
  estimateReadEquivalent(symbols: string[]): { files: { path: string; size: number }[]; resolved: boolean } {
    // Cap per-symbol file count to prevent a god-name (e.g. "handle") from
    // pulling in hundreds of files and inflating the estimate.
    const MAX_FILES_PER_SYMBOL = 5;

    // Use a Map to dedup file paths across all symbols while preserving size.
    const fileMap = new Map<string, number>();

    for (const sym of symbols) {
      const nodes = this.getNodesByName(sym);
      let countForSymbol = 0;
      for (const node of nodes) {
        if (countForSymbol >= MAX_FILES_PER_SYMBOL) break;
        const filePath = node.filePath;
        if (fileMap.has(filePath)) {
          // Already known — still counts toward the per-symbol cap.
          countForSymbol++;
          continue;
        }
        const fileRecord = this.getFile(filePath);
        if (!fileRecord) continue; // node points to a file not tracked — skip
        fileMap.set(filePath, fileRecord.size);
        countForSymbol++;
      }
    }

    const files = Array.from(fileMap.entries()).map(([p, size]) => ({ path: p, size }));
    return { files, resolved: files.length > 0 };
  }

  // ===========================================================================
  // Graph Query Methods
  // ===========================================================================

  /**
   * Get the context for a node (ancestors, children, references)
   *
   * Returns comprehensive context about a node including its containment
   * hierarchy, children, incoming/outgoing references, type information,
   * and relevant imports.
   *
   * @param nodeId - ID of the focal node
   * @returns Context object with all related information
   */
  getContext(nodeId: string): Context {
    return this.graphManager.getContext(nodeId);
  }

  /**
   * Traverse the graph from a starting node
   *
   * Uses breadth-first search by default. Supports filtering by edge types,
   * node types, and traversal direction.
   *
   * @param startId - Starting node ID
   * @param options - Traversal options
   * @returns Subgraph containing traversed nodes and edges
   */
  traverse(startId: string, options?: TraversalOptions): Subgraph {
    return this.traverser.traverseBFS(startId, options);
  }

  /**
   * Get the call graph for a function
   *
   * Returns both callers (functions that call this function) and
   * callees (functions called by this function) up to the specified depth.
   *
   * @param nodeId - ID of the function/method node
   * @param depth - Maximum depth in each direction (default: 2)
   * @returns Subgraph containing the call graph
   */
  getCallGraph(nodeId: string, depth: number = 2): Subgraph {
    return this.traverser.getCallGraph(nodeId, depth);
  }

  /**
   * Get the type hierarchy for a class/interface
   *
   * Returns both ancestors (types this extends/implements) and
   * descendants (types that extend/implement this).
   *
   * @param nodeId - ID of the class/interface node
   * @returns Subgraph containing the type hierarchy
   */
  getTypeHierarchy(nodeId: string): Subgraph {
    return this.traverser.getTypeHierarchy(nodeId);
  }

  /**
   * Find all usages of a symbol
   *
   * Returns all nodes that reference the specified symbol through
   * any edge type (calls, references, type_of, etc.).
   *
   * @param nodeId - ID of the symbol node
   * @returns Array of nodes and edges that reference this symbol
   */
  findUsages(nodeId: string): Array<{ node: Node; edge: Edge }> {
    return this.traverser.findUsages(nodeId);
  }

  /**
   * Get callers of a function/method
   *
   * @param nodeId - ID of the function/method node
   * @param maxDepth - Maximum depth to traverse (default: 1)
   * @returns Array of nodes that call this function
   */
  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallers(nodeId, maxDepth);
  }

  /**
   * Get callees of a function/method
   *
   * @param nodeId - ID of the function/method node
   * @param maxDepth - Maximum depth to traverse (default: 1)
   * @returns Array of nodes called by this function
   */
  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallees(nodeId, maxDepth);
  }

  /**
   * Calculate the impact radius of a node
   *
   * Returns all nodes that could be affected by changes to this node.
   *
   * @param nodeId - ID of the node
   * @param maxDepth - Maximum depth to traverse (default: 3)
   * @returns Subgraph containing potentially impacted nodes
   */
  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    return this.traverser.getImpactRadius(nodeId, maxDepth);
  }

  /**
   * Find the shortest path between two nodes
   *
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @param edgeKinds - Edge types to consider (all if empty)
   * @returns Array of nodes and edges forming the path, or null if no path exists
   */
  findPath(
    fromId: string,
    toId: string,
    edgeKinds?: Edge['kind'][]
  ): Array<{ node: Node; edge: Edge | null }> | null {
    return this.traverser.findPath(fromId, toId, edgeKinds);
  }

  /**
   * Get ancestors of a node in the containment hierarchy
   *
   * @param nodeId - ID of the node
   * @returns Array of ancestor nodes from immediate parent to root
   */
  getAncestors(nodeId: string): Node[] {
    return this.traverser.getAncestors(nodeId);
  }

  /**
   * Get immediate children of a node
   *
   * @param nodeId - ID of the node
   * @returns Array of child nodes
   */
  getChildren(nodeId: string): Node[] {
    return this.traverser.getChildren(nodeId);
  }

  /**
   * Get dependencies of a file
   *
   * @param filePath - Path to the file
   * @returns Array of file paths this file depends on
   */
  getFileDependencies(filePath: string): string[] {
    return this.graphManager.getFileDependencies(filePath);
  }

  /**
   * Get dependents of a file
   *
   * @param filePath - Path to the file
   * @returns Array of file paths that depend on this file
   */
  getFileDependents(filePath: string): string[] {
    return this.graphManager.getFileDependents(filePath);
  }

  /**
   * Find circular dependencies in the codebase
   *
   * @returns Array of cycles, each cycle is an array of file paths
   */
  findCircularDependencies(): string[][] {
    return this.graphManager.findCircularDependencies();
  }

  /**
   * Find dead code (unreferenced symbols)
   *
   * @param kinds - Node kinds to check (default: functions, methods, classes)
   * @returns Array of unreferenced nodes
   */
  findDeadCode(kinds?: Node['kind'][]): Node[] {
    return this.graphManager.findDeadCode(kinds);
  }

  /**
   * Get complexity metrics for a node
   *
   * @param nodeId - ID of the node
   * @returns Object containing various complexity metrics
   */
  getNodeMetrics(nodeId: string): {
    incomingEdgeCount: number;
    outgoingEdgeCount: number;
    callCount: number;
    callerCount: number;
    childCount: number;
    depth: number;
  } {
    return this.graphManager.getNodeMetrics(nodeId);
  }

  // ===========================================================================
  // Context Building
  // ===========================================================================

  /**
   * Get the source code for a node
   *
   * Reads the file and extracts the code between startLine and endLine.
   *
   * @param nodeId - ID of the node
   * @returns Code string or null if not found
   */
  async getCode(nodeId: string): Promise<string | null> {
    return this.contextBuilder.getCode(nodeId);
  }

  /**
   * Find relevant subgraph for a query
   *
   * Combines semantic search with graph traversal to find the most
   * relevant nodes and their relationships for a given query.
   *
   * @param query - Natural language query describing the task
   * @param options - Search and traversal options
   * @returns Subgraph of relevant nodes and edges
   */
  async findRelevantContext(
    query: string,
    options?: FindRelevantContextOptions
  ): Promise<Subgraph> {
    return this.contextBuilder.findRelevantContext(query, options);
  }

  /**
   * Build context for a task
   *
   * Creates comprehensive context by:
   * 1. Running FTS search to find entry points
   * 2. Expanding the graph around entry points
   * 3. Extracting code blocks for key nodes
   * 4. Formatting output for Claude
   *
   * @param input - Task description (string or {title, description})
   * @param options - Build options (maxNodes, includeCode, format, etc.)
   * @returns TaskContext object or formatted string (markdown/JSON)
   */
  async buildContext(
    input: TaskInput,
    options?: BuildContextOptions
  ): Promise<TaskContext | string> {
    return this.contextBuilder.buildContext(input, options);
  }

  // ===========================================================================
  // Database Management
  // ===========================================================================

  /**
   * Optimize the database (vacuum and analyze)
   */
  optimize(): void {
    this.db.optimize();
  }

  /**
   * Clear all data from the graph
   */
  clear(): void {
    this.queries.clear();
  }

  /**
   * Alias for close() for backwards compatibility.
   * @deprecated Use close() instead
   */
  destroy(): void {
    this.close();
  }

  /**
   * Completely remove SpecShip from the project.
   * This closes the database and deletes the .SpecShip directory.
   *
   * WARNING: This permanently deletes all SpecShip data for the project.
   */
  uninitialize(): void {
    this.close();
    removeDirectory(this.projectRoot);
  }
}

// Default export
export default SpecShip;
