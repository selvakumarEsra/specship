/**
 * Node runner interface — one implementation per DagNode kind.
 *
 * Runners are pure functions over a RunnerContext + the typed node.
 * They produce a NodeRunResult discriminated on outcome:
 *   - 'completed' → success; emit `output` for downstream substitution
 *   - 'failed'    → error message + (optional) `transient` flag for retry
 *   - 'paused'    → approval gate; executor stops here, persists state
 *   - 'cancelled' → CancelNode fired; executor terminates the whole run
 */

import { DagNode } from '../schemas/workflow';
import { ApprovalContext, WorkflowEventType } from '../../types';
import { NodeOutput } from '../condition-evaluator';

export interface RunnerContext {
  /** Working directory for shell/script nodes (worktree path when isolated). */
  cwd: string;
  /** Directory for artifact files (`<runRoot>/nodes/<id>.md`, etc.). */
  artifactsDir: string;
  /** Logs directory for verbose JSONL output. */
  logsDir: string;
  /** Workflow run ID (used as the per-node log filename prefix). */
  runId: string;
  /** Inputs and variables for `$INPUT.X` / `$VAR` substitution. */
  inputs?: Record<string, string>;
  variables?: Record<string, string>;
  /** Outputs of completed upstream nodes (for `$nodeId.output` substitution). */
  outputs: Map<string, NodeOutput>;
  /** Verbose logging flag. */
  verbose?: boolean;
  /**
   * Emit a workflow event mid-step — used by the agent runner to stream its
   * live activity (tool calls, message turns) into the run view. No-op when
   * unset. The executor stamps the step id/kind; callers pass type + data.
   */
  emitEvent?: (type: WorkflowEventType, data?: Record<string, unknown>) => void;
}

/**
 * Optional execution stats a runner can report with a completed result.
 * The prompt runner fills these from the agent's stream frames; other
 * runners leave them unset. All fields optional so old runners/records
 * keep working (REQ-DESKTOP-023).
 */
export interface NodeRunStats {
  costUsd?: number;
  durationMs?: number;
  model?: string;
}

export type NodeRunResult =
  | { status: 'completed'; output: NodeOutput; stats?: NodeRunStats }
  | { status: 'failed'; error: string; transient?: boolean }
  | { status: 'paused'; approval: ApprovalContext }
  | { status: 'cancelled'; reason: string };

export interface NodeRunner {
  /** The node kinds this runner handles (one per file in practice). */
  readonly kind: DagNode['kind'];
  /** Execute the node and return a result. Should not throw — wrap errors in `{ status: 'failed' }`. */
  run(node: DagNode, ctx: RunnerContext): Promise<NodeRunResult>;
}
