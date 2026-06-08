/**
 * Workflow YAML schema (v1 subset).
 *
 * Adopted (with deliberate trimming) from Archon's
 * `packages/workflows/src/schemas/workflow.ts:114-119` and
 * `packages/workflows/src/schemas/dag-node.ts:212-356`. We:
 *   - Keep 5 of 6 DAG node kinds (drop `command`, drop `loop`).
 *   - Adopt `depends_on`, `trigger_rule`, `when`, `retry`, `allowed_tools`,
 *     `denied_tools`, `hooks`, `mcp`, `skills`, `agents`, `output_type`,
 *     `persist_session`, `always_run`, `idle_timeout`.
 *   - Skip provider abstraction — Claude Code only.
 *   - Skip Zod — hand-rolled type guards surface clearer errors at validation.
 *
 * Workflow files live under `<project>/.specship/workflows/` or
 * `~/.specship/workflows/`, with bundled defaults in
 * `src/workflows/defaults/` (compile-time embedded — see discovery.ts).
 */

import { WorkflowNodeKind } from '../../types';

// =============================================================================
// Common shapes
// =============================================================================

/** When all upstream `depends_on` nodes succeed (default), or other rules. */
export type TriggerRule =
  | 'all_success'
  | 'one_success'
  | 'none_failed_min_one_success'
  | 'all_done';

export interface RetryConfig {
  /** 1..5 (number of retries after the initial attempt). */
  max_attempts: number;
  /** Delay between retries in ms (default 3000). Doubled each retry. */
  delay_ms?: number;
  /** 'transient' = only retry transient errors (rate-limit, timeout, network); 'all' = retry on any failure. */
  on_error?: 'transient' | 'all';
}

/** Capability gate: workflow refuses to run if any required capability is missing. */
export type WorkflowCapability = 'specship' | 'git' | 'tests';

// =============================================================================
// DAG nodes (5 kinds)
// =============================================================================

/** Fields common to every DAG node kind. */
export interface BaseNode {
  /** Unique node ID within the workflow (referenced by `depends_on` and `$nodeId.output`). */
  id: string;

  /** Node kind discriminator. */
  kind: WorkflowNodeKind;

  /** Other node IDs whose completion gates this one. */
  depends_on?: string[];

  /** Gating semantics: how `depends_on` results combine. Default: `all_success`. */
  trigger_rule?: TriggerRule;

  /** Boolean condition expression. Skips the node when false. Uses `$nodeId.output` substitution. */
  when?: string;

  /** Per-node retry config. Default: 2 retries on transient errors. */
  retry?: RetryConfig;

  /**
   * Optional semantic tag for this node's output (e.g. 'plan', 'diff',
   * 'test_results', 'link_summary'). Drives artifact filename + UI surfacing.
   */
  output_type?: string;

  /** Run even when an upstream is failed (used for cleanup nodes). */
  always_run?: boolean;

  /** Persist the provider session ID across runs so a re-run resumes context. */
  persist_session?: boolean;

  /** Hard cap on idle wall-clock time before the node is failed (ms). */
  idle_timeout?: number;
}

/** Invoke the coding agent (Claude Code SDK) with a prompt. */
export interface PromptNode extends BaseNode {
  kind: 'prompt';
  prompt: string;

  /** Restrict the agent to a specific set of tools (allowlist). */
  allowed_tools?: string[];

  /** Block specific tools (denylist). Applied after allowlist. */
  denied_tools?: string[];

  /** Model override (defaults to the workflow's `model` or Claude Code default). */
  model?: string;

  /** Per-node MCP server config (in addition to globally configured servers). */
  mcp?: Record<string, unknown>;

  /** Skills to make available to this prompt. */
  skills?: string[];

  /** Sub-agents this prompt can summon via the Task tool. */
  agents?: string[];

  /** Hook callbacks (PreToolUse, PostToolUse, etc.) — passed through to the SDK. */
  hooks?: Record<string, unknown>;

  /** Append to the system prompt for THIS node only. */
  systemPromptAppend?: string;
}

/** Run a bash command. Exit 0 = success; non-zero = node failure. */
export interface BashNode extends BaseNode {
  kind: 'bash';
  bash: string;
  /** Timeout in ms (default 60_000). */
  timeout?: number;
  /** Working directory override (default = run's isolation env or cwd). */
  cwd?: string;
  /** Extra env vars merged into the child process. */
  env?: Record<string, string>;
}

/** Run a TypeScript/Python script via `bun run` or `uv run`. */
export interface ScriptNode extends BaseNode {
  kind: 'script';
  script: string;
  runtime: 'bun' | 'uv';
  /** Optional dependencies installed via the chosen runtime's package manager. */
  deps?: string[];
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

/** Pause the workflow for human review. Resume via `manage_run.approve`. */
export interface ApprovalNode extends BaseNode {
  kind: 'approval';
  /** Message shown to the user when the workflow pauses. */
  message: string;
  /** If true, the user's reply text becomes `$nodeId.output`. */
  capture_response?: boolean;
  /** Optional on-reject retry config. */
  on_reject?: {
    prompt: string;
    max_attempts?: number;
  };
}

/** Terminate the workflow with a reason. */
export interface CancelNode extends BaseNode {
  kind: 'cancel';
  /** Reason for cancellation. */
  cancel: string;
}

/** Union of all DAG node types. */
export type DagNode = PromptNode | BashNode | ScriptNode | ApprovalNode | CancelNode;

// =============================================================================
// Workflow definition
// =============================================================================

export interface WorkflowDefinition {
  /** Workflow name (filename stem by convention). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Free-form tags. */
  tags?: string[];
  /** Required capabilities; the executor fails fast if any is unavailable. */
  requires?: WorkflowCapability[];

  /** Default model for prompt nodes. */
  model?: string;
  /** Default systemPromptAppend for every prompt node. */
  systemPromptAppend?: string;

  /** Worktree isolation policy. Default: { enabled: false }. */
  worktree?: {
    enabled: boolean;
    /** Override the base branch (defaults to the current branch of repoRoot). */
    base_branch?: string;
  };

  /** Inputs the workflow accepts at start time (e.g., SPEC_ID, LINK_ID). */
  inputs?: Array<{
    name: string;
    description?: string;
    required?: boolean;
    default?: string;
  }>;

  /** The DAG. Each node has a unique `id`. */
  nodes: DagNode[];
}

// =============================================================================
// Validation — hand-rolled type guards with structured error reporting
// =============================================================================

const NODE_KINDS_SET: ReadonlySet<WorkflowNodeKind> = new Set([
  'prompt',
  'bash',
  'script',
  'approval',
  'cancel',
]);

const TRIGGER_RULES_SET: ReadonlySet<TriggerRule> = new Set([
  'all_success',
  'one_success',
  'none_failed_min_one_success',
  'all_done',
]);

const CAPABILITIES_SET: ReadonlySet<WorkflowCapability> = new Set([
  'specship',
  'git',
  'tests',
]);

export interface ValidationError {
  /** Dotted path into the workflow object (e.g., `nodes[2].depends_on`). */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  workflow?: WorkflowDefinition;
  errors: ValidationError[];
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate a parsed YAML object as a `WorkflowDefinition`. Returns errors
 * collected from the full tree — does not short-circuit so the author sees
 * all issues at once.
 */
export function validateWorkflow(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ path: '$', message: 'workflow must be a YAML object' });
    return { ok: false, errors };
  }

  const obj = input as Record<string, unknown>;

  if (!isString(obj.name) || obj.name.length === 0) {
    errors.push({ path: 'name', message: 'workflow.name (string) is required' });
  }
  if (obj.description !== undefined && !isString(obj.description)) {
    errors.push({ path: 'description', message: 'must be a string' });
  }
  if (obj.tags !== undefined && !isStringArray(obj.tags)) {
    errors.push({ path: 'tags', message: 'must be an array of strings' });
  }
  if (obj.requires !== undefined) {
    if (!isStringArray(obj.requires)) {
      errors.push({ path: 'requires', message: 'must be an array of strings' });
    } else {
      for (let i = 0; i < obj.requires.length; i++) {
        const cap = obj.requires[i];
        if (!CAPABILITIES_SET.has(cap as WorkflowCapability)) {
          errors.push({
            path: `requires[${i}]`,
            message: `unknown capability "${cap}". Known: ${[...CAPABILITIES_SET].join(', ')}`,
          });
        }
      }
    }
  }

  if (obj.worktree !== undefined) {
    if (obj.worktree === null || typeof obj.worktree !== 'object' || Array.isArray(obj.worktree)) {
      errors.push({ path: 'worktree', message: 'must be an object' });
    } else {
      const w = obj.worktree as Record<string, unknown>;
      if (typeof w.enabled !== 'boolean') {
        errors.push({ path: 'worktree.enabled', message: 'must be a boolean' });
      }
      if (w.base_branch !== undefined && !isString(w.base_branch)) {
        errors.push({ path: 'worktree.base_branch', message: 'must be a string' });
      }
    }
  }

  if (!Array.isArray(obj.nodes)) {
    errors.push({ path: 'nodes', message: 'workflow.nodes (array) is required' });
    return { ok: false, errors };
  }

  const seenIds = new Set<string>();
  const nodes: DagNode[] = [];

  for (let i = 0; i < obj.nodes.length; i++) {
    const node = obj.nodes[i];
    const nodePath = `nodes[${i}]`;
    const validated = validateNode(node, nodePath, errors);
    if (validated) {
      if (seenIds.has(validated.id)) {
        errors.push({ path: `${nodePath}.id`, message: `duplicate node id "${validated.id}"` });
      } else {
        seenIds.add(validated.id);
        nodes.push(validated);
      }
    }
  }

  // Cross-reference depends_on after all IDs are known.
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    if (node.depends_on) {
      for (let j = 0; j < node.depends_on.length; j++) {
        const dep = node.depends_on[j];
        if (dep === undefined) continue;
        if (!seenIds.has(dep)) {
          errors.push({
            path: `nodes[${i}].depends_on[${j}]`,
            message: `references unknown node id "${dep}"`,
          });
        }
        if (dep === node.id) {
          errors.push({
            path: `nodes[${i}].depends_on[${j}]`,
            message: `node "${node.id}" cannot depend on itself`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const workflow: WorkflowDefinition = {
    name: obj.name as string,
    description: obj.description as string | undefined,
    tags: obj.tags as string[] | undefined,
    requires: obj.requires as WorkflowCapability[] | undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    systemPromptAppend:
      typeof obj.systemPromptAppend === 'string' ? obj.systemPromptAppend : undefined,
    worktree: obj.worktree as WorkflowDefinition['worktree'],
    inputs: obj.inputs as WorkflowDefinition['inputs'],
    nodes,
  };

  return { ok: true, workflow, errors: [] };
}

function validateNode(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): DagNode | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ path, message: 'node must be an object' });
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (!isString(obj.id) || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: 'node.id (string) is required' });
    return null;
  }
  if (!isString(obj.kind) || !NODE_KINDS_SET.has(obj.kind as WorkflowNodeKind)) {
    errors.push({
      path: `${path}.kind`,
      message: `must be one of ${[...NODE_KINDS_SET].join(', ')}`,
    });
    return null;
  }

  // Common base validation.
  const base: BaseNode = {
    id: obj.id,
    kind: obj.kind as WorkflowNodeKind,
  };

  if (obj.depends_on !== undefined) {
    if (!isStringArray(obj.depends_on)) {
      errors.push({ path: `${path}.depends_on`, message: 'must be an array of strings' });
    } else {
      base.depends_on = obj.depends_on;
    }
  }

  if (obj.trigger_rule !== undefined) {
    if (
      !isString(obj.trigger_rule) ||
      !TRIGGER_RULES_SET.has(obj.trigger_rule as TriggerRule)
    ) {
      errors.push({
        path: `${path}.trigger_rule`,
        message: `must be one of ${[...TRIGGER_RULES_SET].join(', ')}`,
      });
    } else {
      base.trigger_rule = obj.trigger_rule as TriggerRule;
    }
  }

  if (obj.when !== undefined) {
    if (!isString(obj.when)) {
      errors.push({ path: `${path}.when`, message: 'must be a string expression' });
    } else {
      base.when = obj.when;
    }
  }

  if (obj.retry !== undefined) {
    if (obj.retry === null || typeof obj.retry !== 'object' || Array.isArray(obj.retry)) {
      errors.push({ path: `${path}.retry`, message: 'must be an object' });
    } else {
      const r = obj.retry as Record<string, unknown>;
      const max = r.max_attempts;
      if (typeof max !== 'number' || max < 1 || max > 5) {
        errors.push({
          path: `${path}.retry.max_attempts`,
          message: 'must be a number 1..5',
        });
      } else {
        base.retry = { max_attempts: max };
        if (r.delay_ms !== undefined) {
          if (typeof r.delay_ms !== 'number' || r.delay_ms < 0) {
            errors.push({ path: `${path}.retry.delay_ms`, message: 'must be a non-negative number' });
          } else {
            base.retry.delay_ms = r.delay_ms;
          }
        }
        if (r.on_error !== undefined) {
          if (r.on_error !== 'transient' && r.on_error !== 'all') {
            errors.push({ path: `${path}.retry.on_error`, message: 'must be "transient" or "all"' });
          } else {
            base.retry.on_error = r.on_error;
          }
        }
      }
    }
  }

  if (obj.output_type !== undefined && !isString(obj.output_type)) {
    errors.push({ path: `${path}.output_type`, message: 'must be a string' });
  } else if (isString(obj.output_type)) {
    base.output_type = obj.output_type;
  }

  if (obj.always_run !== undefined) {
    if (typeof obj.always_run !== 'boolean') {
      errors.push({ path: `${path}.always_run`, message: 'must be a boolean' });
    } else {
      base.always_run = obj.always_run;
    }
  }

  if (obj.persist_session !== undefined) {
    if (typeof obj.persist_session !== 'boolean') {
      errors.push({ path: `${path}.persist_session`, message: 'must be a boolean' });
    } else {
      base.persist_session = obj.persist_session;
    }
  }

  if (obj.idle_timeout !== undefined) {
    if (typeof obj.idle_timeout !== 'number' || obj.idle_timeout <= 0) {
      errors.push({ path: `${path}.idle_timeout`, message: 'must be a positive number (ms)' });
    } else {
      base.idle_timeout = obj.idle_timeout;
    }
  }

  // Per-kind validation.
  switch (base.kind) {
    case 'prompt': {
      if (!isString(obj.prompt) || obj.prompt.length === 0) {
        errors.push({ path: `${path}.prompt`, message: 'prompt nodes require a non-empty `prompt`' });
        return null;
      }
      const node: PromptNode = { ...base, kind: 'prompt', prompt: obj.prompt };
      if (obj.allowed_tools !== undefined) {
        if (!isStringArray(obj.allowed_tools)) {
          errors.push({ path: `${path}.allowed_tools`, message: 'must be array of strings' });
        } else {
          node.allowed_tools = obj.allowed_tools;
        }
      }
      if (obj.denied_tools !== undefined) {
        if (!isStringArray(obj.denied_tools)) {
          errors.push({ path: `${path}.denied_tools`, message: 'must be array of strings' });
        } else {
          node.denied_tools = obj.denied_tools;
        }
      }
      if (obj.model !== undefined && isString(obj.model)) node.model = obj.model;
      if (obj.systemPromptAppend !== undefined && isString(obj.systemPromptAppend)) {
        node.systemPromptAppend = obj.systemPromptAppend;
      }
      if (obj.skills !== undefined) {
        if (!isStringArray(obj.skills)) {
          errors.push({ path: `${path}.skills`, message: 'must be array of strings' });
        } else {
          node.skills = obj.skills;
        }
      }
      if (obj.agents !== undefined) {
        if (!isStringArray(obj.agents)) {
          errors.push({ path: `${path}.agents`, message: 'must be array of strings' });
        } else {
          node.agents = obj.agents;
        }
      }
      if (obj.mcp !== undefined && typeof obj.mcp === 'object' && obj.mcp !== null) {
        node.mcp = obj.mcp as Record<string, unknown>;
      }
      if (obj.hooks !== undefined && typeof obj.hooks === 'object' && obj.hooks !== null) {
        node.hooks = obj.hooks as Record<string, unknown>;
      }
      return node;
    }
    case 'bash': {
      if (!isString(obj.bash) || obj.bash.length === 0) {
        errors.push({ path: `${path}.bash`, message: 'bash nodes require a non-empty `bash` command' });
        return null;
      }
      const node: BashNode = { ...base, kind: 'bash', bash: obj.bash };
      if (obj.timeout !== undefined) {
        if (typeof obj.timeout !== 'number' || obj.timeout <= 0) {
          errors.push({ path: `${path}.timeout`, message: 'must be a positive number (ms)' });
        } else {
          node.timeout = obj.timeout;
        }
      }
      if (obj.cwd !== undefined && isString(obj.cwd)) node.cwd = obj.cwd;
      if (obj.env !== undefined && typeof obj.env === 'object' && obj.env !== null && !Array.isArray(obj.env)) {
        node.env = obj.env as Record<string, string>;
      }
      return node;
    }
    case 'script': {
      if (!isString(obj.script) || obj.script.length === 0) {
        errors.push({ path: `${path}.script`, message: 'script nodes require a non-empty `script`' });
        return null;
      }
      if (obj.runtime !== 'bun' && obj.runtime !== 'uv') {
        errors.push({ path: `${path}.runtime`, message: 'must be "bun" or "uv"' });
        return null;
      }
      const node: ScriptNode = {
        ...base,
        kind: 'script',
        script: obj.script,
        runtime: obj.runtime,
      };
      if (obj.deps !== undefined) {
        if (!isStringArray(obj.deps)) {
          errors.push({ path: `${path}.deps`, message: 'must be an array of strings' });
        } else {
          node.deps = obj.deps;
        }
      }
      if (obj.timeout !== undefined) {
        if (typeof obj.timeout !== 'number' || obj.timeout <= 0) {
          errors.push({ path: `${path}.timeout`, message: 'must be a positive number (ms)' });
        } else {
          node.timeout = obj.timeout;
        }
      }
      if (obj.cwd !== undefined && isString(obj.cwd)) node.cwd = obj.cwd;
      if (obj.env !== undefined && typeof obj.env === 'object' && obj.env !== null && !Array.isArray(obj.env)) {
        node.env = obj.env as Record<string, string>;
      }
      return node;
    }
    case 'approval': {
      if (!isString(obj.message) || obj.message.length === 0) {
        errors.push({ path: `${path}.message`, message: 'approval nodes require a non-empty `message`' });
        return null;
      }
      const node: ApprovalNode = { ...base, kind: 'approval', message: obj.message };
      if (obj.capture_response !== undefined) {
        if (typeof obj.capture_response !== 'boolean') {
          errors.push({ path: `${path}.capture_response`, message: 'must be a boolean' });
        } else {
          node.capture_response = obj.capture_response;
        }
      }
      if (obj.on_reject !== undefined) {
        if (
          obj.on_reject === null ||
          typeof obj.on_reject !== 'object' ||
          Array.isArray(obj.on_reject)
        ) {
          errors.push({ path: `${path}.on_reject`, message: 'must be an object' });
        } else {
          const oj = obj.on_reject as Record<string, unknown>;
          if (!isString(oj.prompt) || oj.prompt.length === 0) {
            errors.push({ path: `${path}.on_reject.prompt`, message: 'required when on_reject is set' });
          } else {
            const r: { prompt: string; max_attempts?: number } = { prompt: oj.prompt };
            if (oj.max_attempts !== undefined) {
              if (typeof oj.max_attempts !== 'number' || oj.max_attempts < 1) {
                errors.push({ path: `${path}.on_reject.max_attempts`, message: 'must be a positive number' });
              } else {
                r.max_attempts = oj.max_attempts;
              }
            }
            node.on_reject = r;
          }
        }
      }
      return node;
    }
    case 'cancel': {
      if (!isString(obj.cancel) || obj.cancel.length === 0) {
        errors.push({ path: `${path}.cancel`, message: 'cancel nodes require a non-empty `cancel` reason' });
        return null;
      }
      const node: CancelNode = { ...base, kind: 'cancel', cancel: obj.cancel };
      return node;
    }
  }
}
