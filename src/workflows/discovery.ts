/**
 * Workflow discovery — three-tier precedence loader.
 *
 * Inspired by Archon's `packages/workflows/src/workflow-discovery.ts:205-361`.
 *
 * Precedence (highest wins on filename collision):
 *   1. Bundled defaults  (compiled-in, see ./defaults/index.ts)
 *   2. Global   `~/.specship/workflows/`
 *   3. Project  `<projectRoot>/.specship/workflows/`
 *
 * One level of nesting (`subdir/foo.yaml`) is allowed; deeper paths are
 * silently ignored to keep discovery cheap and predictable. Per-file YAML
 * parse or validation failures are isolated — one broken workflow does
 * not abort discovery of its peers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  WorkflowDefinition,
  validateWorkflow,
  ValidationError,
} from './schemas/workflow';
import { bundledDefaults } from './defaults';

export type WorkflowScope = 'bundled' | 'global' | 'project';

export interface WorkflowWithSource {
  workflow: WorkflowDefinition;
  scope: WorkflowScope;
  sourcePath: string;
}

export interface WorkflowLoadError {
  scope: WorkflowScope;
  sourcePath: string;
  errors: ValidationError[];
}

export interface WorkflowLoadResult {
  /** Discovered workflows, after precedence resolution. */
  workflows: WorkflowWithSource[];
  /** Errors per failed workflow file. */
  errors: WorkflowLoadError[];
}

/**
 * Discover workflows from bundled defaults + global + project scopes.
 * Project overrides global; global overrides bundled. Matching is by
 * filename stem (e.g. `spec-implement.yaml` at project level overrides
 * any `spec-implement.yaml` from bundled).
 */
export function discoverWorkflows(projectRoot: string): WorkflowLoadResult {
  const byName = new Map<string, WorkflowWithSource>();
  const errors: WorkflowLoadError[] = [];

  // Raw (pre-validation) definitions by name, so `extends:` can resolve
  // against any workflow loaded at the same or a lower-precedence scope.
  const rawByName = new Map<string, Record<string, unknown>>();
  for (const entry of bundledDefaults) {
    const raw = parseRaw(entry.yaml);
    if (raw.value && typeof raw.value.name === 'string') rawByName.set(raw.value.name, raw.value);
  }

  // 1. Bundled (lowest precedence)
  for (const entry of bundledDefaults) {
    const result = parseAndValidate(entry.yaml, rawByName);
    if (result.workflow) {
      byName.set(entry.name, {
        workflow: result.workflow,
        scope: 'bundled',
        sourcePath: `bundled:${entry.name}.yaml`,
      });
    } else {
      errors.push({
        scope: 'bundled',
        sourcePath: `bundled:${entry.name}.yaml`,
        errors: result.errors,
      });
    }
  }

  // 2. Global
  const globalDir = path.join(os.homedir(), '.specship', 'workflows');
  loadFromDir(globalDir, 'global', byName, errors, rawByName);

  // 3. Project (highest precedence)
  const projectDir = path.join(projectRoot, '.specship', 'workflows');
  loadFromDir(projectDir, 'project', byName, errors, rawByName);

  return {
    workflows: [...byName.values()].sort((a, b) =>
      a.workflow.name.localeCompare(b.workflow.name)
    ),
    errors,
  };
}

/**
 * Load a single workflow by name from the resolved discovery layer.
 * Returns null if no workflow with that name exists in any scope.
 */
export function loadWorkflowByName(
  projectRoot: string,
  name: string
): WorkflowWithSource | null {
  const all = discoverWorkflows(projectRoot);
  return all.workflows.find((w) => w.workflow.name === name) ?? null;
}

// =============================================================================
// internal
// =============================================================================

function loadFromDir(
  dir: string,
  scope: WorkflowScope,
  byName: Map<string, WorkflowWithSource>,
  errors: WorkflowLoadError[],
  rawByName: Map<string, Record<string, unknown>> = new Map()
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist — fine, scope is empty
  }

  const filesToLoad: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && isYamlFile(entry.name)) {
      filesToLoad.push(full);
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      // One level of nesting only.
      try {
        const nested = fs.readdirSync(full, { withFileTypes: true });
        for (const n of nested) {
          if (n.isFile() && isYamlFile(n.name)) {
            filesToLoad.push(path.join(full, n.name));
          }
        }
      } catch {
        // ignore
      }
    }
  }

  for (const file of filesToLoad) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      errors.push({
        scope,
        sourcePath: file,
        errors: [
          {
            path: '$',
            message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
      continue;
    }

    const result = parseAndValidate(source, rawByName);
    if (result.workflow) {
      const raw = parseRaw(source).value;
      if (raw) rawByName.set(result.workflow.name, raw);
      byName.set(result.workflow.name, {
        workflow: result.workflow,
        scope,
        sourcePath: file,
      });
    } else {
      errors.push({ scope, sourcePath: file, errors: result.errors });
    }
  }
}

function isYamlFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.yaml') || lower.endsWith('.yml');
}

function parseRaw(source: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const v = yaml.parse(source);
    return v && typeof v === 'object' && !Array.isArray(v) ? { value: v as Record<string, unknown> } : { value: undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve `extends: <workflow>` + `node_overrides` (THROUGHPUT-DOC,
 * REQ-THRU-004): the result is the base workflow's raw definition with the
 * extending file's top-level fields on top and each named node's fields
 * shallow-merged from `node_overrides`. One source for shared nodes — a
 * variant like spec-implement-mixed only states what differs. Chains resolve
 * recursively; a cycle, an unknown base, or an override naming no base node
 * is an error.
 */
export function resolveExtends(
  raw: Record<string, unknown>,
  getBase: (name: string) => Record<string, unknown> | undefined,
  seen: Set<string> = new Set()
): { value?: Record<string, unknown>; errors: ValidationError[] } {
  const baseName = raw.extends;
  if (baseName === undefined) return { value: raw, errors: [] };
  if (typeof baseName !== 'string' || baseName.trim() === '') {
    return { errors: [{ path: '$.extends', message: '`extends` must name a workflow' }] };
  }
  if (seen.has(baseName)) {
    return { errors: [{ path: '$.extends', message: `extends cycle through "${baseName}"` }] };
  }
  const baseRaw = getBase(baseName);
  if (!baseRaw) {
    return { errors: [{ path: '$.extends', message: `extends unknown workflow "${baseName}"` }] };
  }
  const base = resolveExtends(baseRaw, getBase, new Set([...seen, baseName]));
  if (!base.value) return base;

  const { extends: _e, node_overrides: overridesRaw, ...own } = raw;
  const overrides =
    overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)
      ? (overridesRaw as Record<string, Record<string, unknown>>)
      : {};
  const baseNodes = Array.isArray(base.value.nodes) ? (base.value.nodes as Array<Record<string, unknown>>) : [];
  const ids = new Set(baseNodes.map((n) => n.id));
  const errors: ValidationError[] = [];
  for (const id of Object.keys(overrides)) {
    if (!ids.has(id)) errors.push({ path: `$.node_overrides.${id}`, message: `override names no node "${id}" in "${baseName}"` });
  }
  if (errors.length > 0) return { errors };
  const nodes = baseNodes.map((n) => {
    const o = overrides[String(n.id)];
    return o && typeof o === 'object' ? { ...n, ...o, id: n.id } : n;
  });
  return { value: { ...base.value, ...own, nodes }, errors: [] };
}

function parseAndValidate(
  source: string,
  rawByName: Map<string, Record<string, unknown>> = new Map()
): {
  workflow?: WorkflowDefinition;
  errors: ValidationError[];
} {
  const raw = parseRaw(source);
  if (raw.error !== undefined) {
    return { errors: [{ path: '$', message: `YAML parse error: ${raw.error}` }] };
  }
  if (!raw.value) {
    return { errors: [{ path: '$', message: 'workflow must be a YAML mapping' }] };
  }
  const resolved = resolveExtends(raw.value, (name) => rawByName.get(name));
  if (!resolved.value) return { errors: resolved.errors };
  const validation = validateWorkflow(resolved.value);
  if (!validation.ok || !validation.workflow) {
    return { errors: validation.errors };
  }
  return { workflow: validation.workflow, errors: [] };
}
