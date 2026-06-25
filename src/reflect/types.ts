/**
 * Reflection engine types (REFLECT-DOC).
 *
 * A Proposal is a durable, human-gated self-improvement suggestion mined from
 * the ingested `claude_*` transcript tables. It is never advisory text alone —
 * it resolves to a concrete, previewable file change (REQ-REFLECT-002), keyed by
 * a stable `contentHash` so re-mining the same pattern converges to one row
 * (REQ-REFLECT-007). The engine PROPOSES; bytes reach disk only on an explicit
 * per-proposal apply (REQ-REFLECT-005).
 */

/** The kind of durable artifact a proposal produces. */
export type ProposalType = 'memory_rule' | 'skill' | 'hook';

/** Severity, reusing the tips engine's scale. `high` drives sweep notifications. */
export type ProposalSeverity = 'high' | 'warn' | 'info';

/** Persisted lifecycle state (REQ-REFLECT-007). */
export type ProposalState = 'open' | 'applied' | 'undone' | 'dismissed';

/** The concrete file the apply writes. */
export type TargetKind = 'claude_md' | 'memory_note' | 'command' | 'settings_hook';

/** What the proposal was derived from, so the user can judge it (REQ-REFLECT-001). */
export interface ProposalEvidence {
  /** Contributing session ids. */
  sessions: string[];
  /** Contributing prompt ids. */
  prompts: string[];
  /** Human-readable one-line summary of the observed pattern. */
  detail: string;
}

/**
 * Artifact-type-specific payload — the exact intended content the preview
 * renders and the apply writes (REQ-REFLECT-002.A4). Discriminated on `kind`,
 * which matches the proposal's `targetKind`.
 */
export type ProposalPayload =
  | { kind: 'claude_md'; markerId: string; block: string }
  | { kind: 'memory_note'; slug: string; note: string; indexLine: string }
  | { kind: 'command'; name: string; content: string }
  | { kind: 'settings_hook'; event: string; matcher: string; entry: Record<string, unknown> };

/** A single reflection proposal. */
export interface Proposal {
  /** Stable id over (type, targetKind, targetPath, payload) — excludes evidence/timestamps. */
  contentHash: string;
  type: ProposalType;
  severity: ProposalSeverity;
  title: string;
  body: string;
  targetKind: TargetKind;
  /** Absolute path the apply will write. */
  targetPath: string;
  payload: ProposalPayload;
  evidence: ProposalEvidence;
  state: ProposalState;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
}

/** Result of applying a proposal (REQ-REFLECT-004). */
export type ApplyOutcome = 'applied' | 'unchanged' | 'conflict';

/** Result of undoing a proposal (REQ-REFLECT-004.A3). */
export type UndoOutcome = 'undone' | 'noop';

/** A non-mutating preview of the change a proposal would make (REQ-REFLECT-003). */
export interface PreviewResult {
  targetPath: string;
  targetKind: TargetKind;
  /** Whether the target file already exists on disk. */
  exists: boolean;
  /** Current file content (empty string when the file is absent). */
  before: string;
  /** File content after the change would be applied. */
  after: string;
  /** A line-based unified-style diff of before → after. */
  diff: string;
  /** Set when the apply would be refused — a non-marked file already occupies the path. */
  conflict?: boolean;
}

/** Options the engine needs to resolve target paths. */
export interface ReflectContext {
  /** Absolute project root (for project CLAUDE.md / commands / .claude/settings.json). */
  projectRoot: string;
  /** Home directory (for ~/.claude/memory notes). */
  homeDir: string;
}
