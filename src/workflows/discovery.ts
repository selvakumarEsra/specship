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

  // 1. Bundled (lowest precedence)
  for (const entry of bundledDefaults) {
    const result = parseAndValidate(entry.yaml);
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
  loadFromDir(globalDir, 'global', byName, errors);

  // 3. Project (highest precedence)
  const projectDir = path.join(projectRoot, '.specship', 'workflows');
  loadFromDir(projectDir, 'project', byName, errors);

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
  errors: WorkflowLoadError[]
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

    const result = parseAndValidate(source);
    if (result.workflow) {
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

function parseAndValidate(source: string): {
  workflow?: WorkflowDefinition;
  errors: ValidationError[];
} {
  let parsed: unknown;
  try {
    parsed = yaml.parse(source);
  } catch (err) {
    return {
      errors: [
        {
          path: '$',
          message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  const validation = validateWorkflow(parsed);
  if (!validation.ok || !validation.workflow) {
    return { errors: validation.errors };
  }
  return { workflow: validation.workflow, errors: [] };
}
