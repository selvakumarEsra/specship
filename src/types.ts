/**
 * SpecShip Type Definitions
 *
 * Core types for the semantic knowledge graph system.
 */

// =============================================================================
// Union Types
// =============================================================================

/**
 * Types of nodes in the knowledge graph.
 *
 * Defined as a runtime-iterable `as const` array so the same source
 * of truth backs both the TS type and any runtime validation
 * (e.g. the search query parser).
 */
export const NODE_KINDS = [
  'file',
  'module',
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'property',
  'field',
  'variable',
  'constant',
  'enum',
  'enum_member',
  'type_alias',
  'namespace',
  'parameter',
  'import',
  'export',
  'route',
  'component',
  // Spec-layer virtual node projection (v5). The heavy spec content lives in
  // the `specs` table; a thin row in `nodes` with kind='spec' lets the
  // existing traversal machinery (specship_explore, edges) cross from spec
  // to code transparently.
  'spec',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Types of edges (relationships) between nodes
 */
export type EdgeKind =
  | 'contains'        // Parent contains child (file→class, class→method)
  | 'calls'           // Function/method calls another
  | 'imports'         // File imports from another
  | 'exports'         // File exports a symbol
  | 'extends'         // Class/interface extends another
  | 'implements'      // Class implements interface — overloaded post-v5: also spec→code "implements"
  | 'references'      // Generic reference to another symbol
  | 'type_of'         // Variable/parameter has type
  | 'returns'         // Function returns type
  | 'instantiates'    // Creates instance of class
  | 'overrides'       // Method overrides parent method
  | 'decorates'       // Decorator applied to symbol
  | 'documents'       // Spec documents a code symbol (non-binding intent)
  | 'validates';      // Test/contract validates a code symbol

/**
 * Supported programming languages. See NODE_KINDS for why this is a
 * runtime-iterable const array.
 */
export const LANGUAGES = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'dart',
  'svelte',
  'vue',
  'liquid',
  'pascal',
  'scala',
  'lua',
  'luau',
  'objc',
  'yaml',
  'twig',
  'xml',
  'properties',
  'unknown',
] as const;

export type Language = (typeof LANGUAGES)[number];

// =============================================================================
// Core Graph Types
// =============================================================================

/**
 * A node in the knowledge graph representing a code symbol
 */
export interface Node {
  /** Unique identifier (hash of file path + qualified name) */
  id: string;

  /** Type of code element */
  kind: NodeKind;

  /** Simple name (e.g., "calculateTotal") */
  name: string;

  /** Fully qualified name (e.g., "src/utils.ts::MathHelper.calculateTotal") */
  qualifiedName: string;

  /** File path relative to project root */
  filePath: string;

  /** Programming language */
  language: Language;

  /** Starting line number (1-indexed) */
  startLine: number;

  /** Ending line number (1-indexed) */
  endLine: number;

  /** Starting column (0-indexed) */
  startColumn: number;

  /** Ending column (0-indexed) */
  endColumn: number;

  /** Documentation string if present */
  docstring?: string;

  /** Function/method signature */
  signature?: string;

  /** Visibility modifier */
  visibility?: 'public' | 'private' | 'protected' | 'internal';

  /** Whether symbol is exported */
  isExported?: boolean;

  /** Whether symbol is async */
  isAsync?: boolean;

  /** Whether symbol is static */
  isStatic?: boolean;

  /** Whether symbol is abstract */
  isAbstract?: boolean;

  /** Decorators/annotations applied */
  decorators?: string[];

  /** Generic type parameters */
  typeParameters?: string[];

  /** When the node was last updated */
  updatedAt: number;
}

/**
 * An edge representing a relationship between two nodes
 */
export interface Edge {
  /** Source node ID */
  source: string;

  /** Target node ID */
  target: string;

  /** Type of relationship */
  kind: EdgeKind;

  /** Additional context about the relationship */
  metadata?: Record<string, unknown>;

  /** Line number where relationship occurs (e.g., call site) */
  line?: number;

  /** Column number where relationship occurs */
  column?: number;

  /** How this edge was created */
  provenance?: 'tree-sitter' | 'scip' | 'heuristic';
}

/**
 * Metadata about a tracked file
 */
export interface FileRecord {
  /** File path relative to project root */
  path: string;

  /** Content hash for change detection */
  contentHash: string;

  /** Detected language */
  language: Language;

  /** File size in bytes */
  size: number;

  /** Last modification timestamp */
  modifiedAt: number;

  /** When last indexed */
  indexedAt: number;

  /** Number of nodes extracted */
  nodeCount: number;

  /** Any extraction errors */
  errors?: ExtractionError[];
}

// =============================================================================
// Extraction Types
// =============================================================================

/**
 * Result from parsing a source file
 */
export interface ExtractionResult {
  /** Extracted nodes */
  nodes: Node[];

  /** Extracted edges */
  edges: Edge[];

  /** References that couldn't be resolved yet */
  unresolvedReferences: UnresolvedReference[];

  /** Any errors during extraction */
  errors: ExtractionError[];

  /** Extraction duration in milliseconds */
  durationMs: number;
}

/**
 * Error during code extraction
 */
export interface ExtractionError {
  /** Error message */
  message: string;

  /** File path where the error occurred */
  filePath?: string;

  /** Line number if available */
  line?: number;

  /** Column number if available */
  column?: number;

  /** Error severity */
  severity: 'error' | 'warning';

  /** Error code for categorization */
  code?: string;
}

/**
 * A reference that couldn't be resolved during extraction
 */
export interface UnresolvedReference {
  /** ID of the node containing the reference */
  fromNodeId: string;

  /** Name being referenced */
  referenceName: string;

  /** Type of reference (call, type, import, etc.) */
  referenceKind: EdgeKind;

  /** Location of the reference */
  line: number;
  column: number;

  /** File path where reference occurs (denormalized for performance) */
  filePath?: string;

  /** Language of the source file (denormalized for performance) */
  language?: Language;

  /** Possible qualified names it might resolve to */
  candidates?: string[];
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * A subgraph containing a subset of the knowledge graph
 */
export interface Subgraph {
  /** Nodes in this subgraph */
  nodes: Map<string, Node>;

  /** Edges in this subgraph */
  edges: Edge[];

  /** Root node IDs (entry points) */
  roots: string[];

  /**
   * Retrieval confidence for context-style queries. `'low'` means the query
   * resolved only to isolated common-word matches (no entry point corroborated
   * by 2+ distinct query terms) — callers should surface an honest handoff to
   * explore/trace rather than present the results as comprehensive. Undefined
   * for graph traversals that don't run the search-ranking path.
   */
  confidence?: 'high' | 'low';
}

/**
 * Options for graph traversal
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number;

  /** Edge types to follow (default: all) */
  edgeKinds?: EdgeKind[];

  /** Node types to include (default: all) */
  nodeKinds?: NodeKind[];

  /** Direction of traversal */
  direction?: 'outgoing' | 'incoming' | 'both';

  /** Maximum nodes to return */
  limit?: number;

  /** Whether to include the starting node */
  includeStart?: boolean;
}

/**
 * Options for searching the graph
 */
export interface SearchOptions {
  /** Node types to search */
  kinds?: NodeKind[];

  /** Languages to include */
  languages?: Language[];

  /** File path patterns to include */
  includePatterns?: string[];

  /** File path patterns to exclude */
  excludePatterns?: string[];

  /** Maximum results to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Whether search is case-sensitive */
  caseSensitive?: boolean;
}

/**
 * A search result with relevance scoring
 */
export interface SearchResult {
  /** Matching node */
  node: Node;

  /** Relevance score (0-1) */
  score: number;

  /** Matched text snippets for highlighting */
  highlights?: string[];
}

// =============================================================================
// Context Types
// =============================================================================

/**
 * Context information for code understanding
 */
export interface Context {
  /** Primary node being examined */
  focal: Node;

  /** Nodes containing the focal node (file, class, etc.) */
  ancestors: Node[];

  /** Nodes directly contained by focal node */
  children: Node[];

  /** Incoming references (who calls/uses this) */
  incomingRefs: Array<{ node: Node; edge: Edge }>;

  /** Outgoing references (what this calls/uses) */
  outgoingRefs: Array<{ node: Node; edge: Edge }>;

  /** Related type information */
  types: Node[];

  /** Relevant imports */
  imports: Node[];
}

/**
 * A block of code with context
 */
export interface CodeBlock {
  /** The code content */
  content: string;

  /** File path */
  filePath: string;

  /** Starting line */
  startLine: number;

  /** Ending line */
  endLine: number;

  /** Language for syntax highlighting */
  language: Language;

  /** Associated node if extracted */
  node?: Node;
}

// =============================================================================
// Database Types
// =============================================================================

/**
 * Database schema version info
 */
export interface SchemaVersion {
  /** Current schema version */
  version: number;

  /** When schema was created/updated */
  appliedAt: number;

  /** Description of this version */
  description?: string;
}

/**
 * Statistics about the knowledge graph
 */
export interface GraphStats {
  /** Total number of nodes */
  nodeCount: number;

  /** Total number of edges */
  edgeCount: number;

  /** Number of tracked files */
  fileCount: number;

  /** Node counts by kind */
  nodesByKind: Record<NodeKind, number>;

  /** Edge counts by kind */
  edgesByKind: Record<EdgeKind, number>;

  /** File counts by language */
  filesByLanguage: Record<Language, number>;

  /** Database size in bytes */
  dbSizeBytes: number;

  /** Last update timestamp */
  lastUpdated: number;
}

// =============================================================================
// Task Context Types (for buildContext)
// =============================================================================

/**
 * Input for building task context
 */
export type TaskInput = string | { title: string; description?: string };

/**
 * Options for building task context
 */
export interface BuildContextOptions {
  /** Maximum number of nodes to include (default: 50) */
  maxNodes?: number;

  /** Maximum number of code blocks to include (default: 10) */
  maxCodeBlocks?: number;

  /** Maximum characters per code block (default: 2000) */
  maxCodeBlockSize?: number;

  /** Whether to include code blocks (default: true) */
  includeCode?: boolean;

  /** Output format (default: 'markdown') */
  format?: 'markdown' | 'json';

  /** Number of semantic search results (default: 5) */
  searchLimit?: number;

  /** Graph traversal depth from entry points (default: 2) */
  traversalDepth?: number;

  /** Minimum semantic similarity score (default: 0.3) */
  minScore?: number;
}

/**
 * Full context for a task, ready for Claude
 */
export interface TaskContext {
  /** The original query/task */
  query: string;

  /** Subgraph of relevant nodes and edges */
  subgraph: Subgraph;

  /** Entry point nodes (from semantic search) */
  entryPoints: Node[];

  /** Code blocks extracted from key nodes */
  codeBlocks: CodeBlock[];

  /** Files involved in this context */
  relatedFiles: string[];

  /** Brief summary of the context */
  summary: string;

  /** Statistics about the context */
  stats: {
    /** Number of nodes included */
    nodeCount: number;
    /** Number of edges included */
    edgeCount: number;
    /** Number of files touched */
    fileCount: number;
    /** Number of code blocks included */
    codeBlockCount: number;
    /** Total characters in code blocks */
    totalCodeSize: number;
  };
}

/**
 * Options for finding relevant context
 */
export interface FindRelevantContextOptions {
  /** Number of semantic search results (default: 5) */
  searchLimit?: number;

  /** Graph traversal depth (default: 2) */
  traversalDepth?: number;

  /** Maximum nodes in result (default: 50) */
  maxNodes?: number;

  /** Minimum semantic similarity score (default: 0.3) */
  minScore?: number;

  /** Edge types to follow in traversal */
  edgeKinds?: EdgeKind[];

  /** Node types to include */
  nodeKinds?: NodeKind[];
}

// =============================================================================
// Spec Layer (schema v5)
// =============================================================================

/**
 * Kind of spec entity. Specs are stored in their own table but project a
 * thin row into `nodes` with kind='spec' so graph traversal works transparently.
 *
 * - `document`: the spec file's top-level container
 * - `requirement`: a specific requirement under a document
 * - `acceptance`: an acceptance criterion under a requirement
 * - `contract`: an API/data contract (OpenAPI, AsyncAPI, etc.)
 * - `data_schema`: a data shape definition
 */
export const SPEC_KINDS = [
  'document',
  'requirement',
  'acceptance',
  'contract',
  'data_schema',
  // A brainstorm brief (`specs/<slug>/brief.md`) — the "idea" stage of the
  // spec lifecycle, indexed as a first-class entity so the idea → spec →
  // implemented funnel is queryable (REQ-FUNNEL-001).
  'brief',
] as const;

export type SpecKind = (typeof SPEC_KINDS)[number];

/**
 * Spec source format. Each format has its own extractor under
 * `src/extraction/specs/`.
 */
export const SPEC_FORMATS = ['markdown', 'yaml', 'gherkin', 'openapi'] as const;
export type SpecFormat = (typeof SPEC_FORMATS)[number];

/**
 * A spec entity (requirement, acceptance criterion, contract, …).
 *
 * IDs are EMBEDDED in the source (per locked decision in the v1 plan).
 * Path-derived fallback was explicitly rejected — every spec must carry
 * its own stable identifier (`<!-- id: REQ-X -->` in Markdown,
 * `id: REQ-X` in YAML frontmatter, etc.).
 */
export interface Spec {
  /** Embedded, author-assigned ID. Stable across edits, reorders, renames. */
  id: string;

  /** Kind of spec entity */
  kind: SpecKind;

  /** Short human-readable title (typically the heading text) */
  title: string;

  /** Full body of the spec section (Markdown / YAML / etc.) */
  body: string;

  /** Source format */
  format: SpecFormat;

  /** File path where this spec lives, relative to project root */
  sourcePath: string;

  /** Line range within the source file */
  startLine?: number;
  endLine?: number;

  /** Parent spec ID (e.g., a requirement points to its containing document) */
  parentId?: string;

  /**
   * Content hash of the body. Used for drift detection: when the hash
   * changes, all spec_links for this spec flip to `drifted (drift_axis=spec)`.
   */
  contentHash: string;

  /** Monotonic version number, bumped on each meaningful edit */
  version?: number;

  /** If this spec has been replaced, the ID of the replacement */
  supersededBy?: string;

  /** Owner / accountable party (free-form) */
  owner?: string;

  /** Priority (free-form: P0/P1/P2 or low/med/high) */
  priority?: string;

  /** Additional metadata: tags, links, custom fields */
  metadata?: Record<string, unknown>;

  /** Created/updated timestamps (epoch ms) */
  createdAt: number;
  updatedAt: number;
}

/**
 * A tracked spec file. Mirrors `FileRecord` for spec sources so the
 * watcher and re-extract pipeline can hash-key spec files independently
 * of code files.
 */
export interface SpecFile {
  path: string;
  contentHash: string;
  format: SpecFormat;
  size: number;
  modifiedAt: number;
  indexedAt: number;
  specCount: number;
  errors?: ExtractionError[];
}

/**
 * State of a spec → code link. Persistent, mutates as code and spec change.
 *
 * - `drafted`: spec exists, no code linked yet
 * - `implementing`: agent currently working on it (transient, optional in v1)
 * - `implemented`: code exists, link asserted, not yet verified
 * - `verified`: link asserted AND verification (tests, etc.) passed
 * - `drifted`: spec or code changed after link was established (see drift_axis)
 * - `broken`: verification ran and failed
 * - `orphaned`: target code symbol no longer exists at its logical address
 */
export type SpecLinkState =
  | 'drafted'
  | 'implementing'
  | 'implemented'
  | 'verified'
  | 'drifted'
  | 'broken'
  | 'orphaned';

/**
 * Which side of a `drifted` link moved.
 *  - `spec`: spec body changed since link was established
 *  - `code`: code symbol's signature changed
 *  - null when state is not `drifted`
 */
export type SpecLinkDriftAxis = 'spec' | 'code' | null;

/**
 * How a spec link was created (highest confidence first).
 *  - `agent-asserted`: coding agent called specship_link_assert (confidence 1.0)
 *  - `code-comment`:   extractor found `// @implements REQ-X` (confidence 0.9)
 *  - `spec-declaration`: spec frontmatter declared `implementations: [...]` (confidence 0.7)
 *  - `resolver`:       heuristic match (confidence ≤ 0.5)
 */
export type SpecLinkProvenance =
  | 'agent-asserted'
  | 'code-comment'
  | 'spec-declaration'
  | 'resolver';

/**
 * Kind of relationship from spec to code.
 */
export type SpecLinkKind =
  | 'implements'  // Code implements the spec requirement
  | 'tests'       // Test covers the spec
  | 'validates'   // Contract validates the symbol
  | 'documents'   // Spec documents the symbol (descriptive, non-binding)
  | 'depends_on'; // Spec depends on the symbol (e.g., references its shape)

/**
 * A spec → code link.
 *
 * Keyed on LOGICAL identity: `(target_file_path, target_qualified_name,
 * target_node_kind)`. This survives line shifts and code re-extracts —
 * `nodes.id` bakes line numbers into its hash, so a node-id-keyed link
 * would orphan on every refactor.
 *
 * `resolvedNodeId` is a cache, repopulated by SpecLinkResolver each sync.
 * It's NULL when the logical target doesn't currently exist (state moves
 * to `orphaned`).
 */
export interface SpecLink {
  /** DB row ID (auto-increment) */
  id: number;

  /** ID of the spec this link belongs to */
  specId: string;

  /** Logical identity of the target code symbol (durable join key) */
  targetFilePath: string;
  targetQualifiedName: string;
  targetNodeKind: NodeKind;

  /** Resolved nodes.id for the current sync — cached, may be NULL when orphaned */
  resolvedNodeId?: string;

  /** What the link asserts */
  kind: SpecLinkKind;

  /** Current state of the link */
  state: SpecLinkState;

  /** Which side moved when state is `drifted` */
  driftAxis?: SpecLinkDriftAxis;

  /** Spec content_hash at the time the link was established (drift baseline) */
  specHashAtLink: string;

  /** Node signature at the time the link was established (drift baseline) */
  nodeSigAtLink?: string;

  /** How the link got created */
  provenance: SpecLinkProvenance;

  /** Confidence score (1.0 = agent-asserted, lower for heuristic) */
  confidence?: number;

  /** Free-form metadata: last verification result, agent session ID, test refs */
  metadata?: Record<string, unknown>;

  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Workflow Engine (schema v5)
// =============================================================================

/**
 * Lifecycle state of a workflow run. Mirrors Archon's workflow run states
 * so existing reasoning about resumability transfers.
 *
 * Terminal: `completed`, `failed`, `cancelled` (no further transitions).
 * Resumable: `paused`, `failed` (can be resumed with `manage_run` resume).
 */
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Node-level state within a workflow run.
 */
export type WorkflowNodeState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Event types emitted by the workflow executor.
 */
export type WorkflowEventType =
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'
  | 'tool_called'
  | 'artifact_created'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'run_paused';

/**
 * A workflow run record (one invocation of a workflow definition).
 */
export interface WorkflowRun {
  /** Unique run ID (UUID) */
  id: string;

  /** Name of the workflow definition that produced this run */
  workflowName: string;

  /** Current status */
  status: WorkflowRunStatus;

  /** Inputs provided at start time ($SPEC_ID, $LINK_ID, …) */
  inputs?: Record<string, string>;

  /**
   * ID of the isolation environment (git worktree) this run owns.
   * Contract: equal to the worktree's filesystem path.
   */
  isolationEnvId?: string;

  /** Timestamps */
  startedAt?: number;
  completedAt?: number;
  lastActivityAt: number;
  createdAt: number;

  /** If failed, the error message that caused the failure */
  errorMessage?: string;

  /**
   * Run-level metadata: approval context (when paused), prior_completed_nodes
   * (for resume), tool call summaries, etc.
   */
  metadata?: Record<string, unknown>;
}

/**
 * A single workflow event row.
 */
export interface WorkflowEvent {
  id: number;
  workflowRunId: string;
  eventType: WorkflowEventType;
  stepId?: string;
  stepKind?: WorkflowNodeKind;
  data?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Kinds of nodes a workflow DAG can contain (v1 subset — no `command` or
 * `loop` per the Archon adoption plan).
 */
export type WorkflowNodeKind = 'prompt' | 'bash' | 'script' | 'approval' | 'cancel';

/**
 * An isolation environment (git worktree) owned by a workflow run.
 * Contract: `id` equals the worktree's filesystem path so envId is
 * self-describing.
 */
export interface IsolationEnvironment {
  id: string;
  workflowRunId?: string;
  workflowName: string;
  workingPath: string;
  branchName: string;
  status: 'active' | 'destroyed';
  createdAt: number;
  destroyedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Approval context stored in `workflow_runs.metadata` when a run is paused
 * at an approval gate.
 */
export interface ApprovalContext {
  type: 'approval' | 'interactive_loop';
  nodeId: string;
  message: string;
  captureResponse?: boolean;
  onReject?: { prompt: string; maxAttempts?: number };
  iteration?: number;
  sessionId?: string;
}
