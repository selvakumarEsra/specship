/**
 * Spec & link MCP tools.
 *
 * Adds four new tool surfaces:
 *   - `specship_spec`         — fetch a spec by ID (body, children, linked code, state)
 *   - `specship_link_assert`  — agent declares a spec→code link after editing
 *   - `specship_link_verify`  — agent reports the outcome of running verification
 *   - `specship_drifted`      — list drifted / orphaned / broken links (review queue)
 *
 * Definitions are kept here so `tools.ts` doesn't grow further; handlers are
 * also here as free functions taking the SpecShip instance + args. The
 * ToolHandler in `tools.ts` calls these via thin wrappers.
 */

import type SpecShip from '../index';
import type { SpecLink, SpecLinkState, SpecLinkKind, NodeKind } from '../types';
import type { ToolDefinition, ToolResult } from './tools';

const projectPathProperty = {
  type: 'string',
  description:
    'Path to a different project with .specship/ initialized. If omitted, uses current project. Use this to query other codebases.',
} as const;

export const SPEC_LINK_STATES: SpecLinkState[] = [
  'drafted',
  'implementing',
  'implemented',
  'verified',
  'drifted',
  'broken',
  'orphaned',
];

export const SPEC_LINK_KINDS: SpecLinkKind[] = [
  'implements',
  'tests',
  'validates',
  'documents',
  'depends_on',
];

/**
 * Tool definitions. Append these to the main `tools` array.
 *
 * Tool guidance follows the CLAUDE.md "adapt to the agent" rule: the
 * descriptions point the agent at `specship_spec` *first* when a user
 * mentions a spec ID, and at `specship_link_assert` immediately after an
 * edit. These low-salience hints are reinforced by the bundled workflow
 * harness (a separate v1 surface) which enforces the call via tool restriction.
 */
export const specToolDefinitions: ToolDefinition[] = [
  {
    name: 'specship_spec',
    description:
      'Fetch a spec/requirement by its ID. Call this FIRST whenever the user mentions a spec ID (e.g., REQ-AUTH-005) or a requirement. Returns the spec body, its parent doc and sibling requirements, and the code it currently links to with link state (verified / drifted / orphaned). Use this instead of Read-ing the spec file — it returns more (linked code + state) than the file alone.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_id: {
          type: 'string',
          description: 'Embedded spec ID (e.g., "REQ-AUTH-005", "AUTH-DOC")',
        },
        projectPath: projectPathProperty,
      },
      required: ['spec_id'],
    },
  },
  {
    name: 'specship_link_assert',
    description:
      'Declare that a code symbol implements (or tests / documents / validates) a spec. Call this AFTER editing code in response to a spec — before reporting done. Idempotent: calling it again refreshes the link with the latest signature snapshot. Higher-priority signal than the // @implements REQ-X comment backstop (the extractor catches comment-only links automatically).',
    inputSchema: {
      type: 'object',
      properties: {
        spec_id: {
          type: 'string',
          description: 'Spec ID this code implements (e.g., "REQ-AUTH-005")',
        },
        target_file_path: {
          type: 'string',
          description: 'Project-relative path to the code file (e.g., "src/auth/login.ts")',
        },
        target_qualified_name: {
          type: 'string',
          description: 'Fully-qualified symbol name (e.g., "authenticateUser", "AuthService.login")',
        },
        target_node_kind: {
          type: 'string',
          description: 'Kind of code symbol',
          enum: ['function', 'method', 'class', 'interface', 'route', 'component', 'type_alias'],
        },
        kind: {
          type: 'string',
          description: 'How this code relates to the spec',
          enum: ['implements', 'tests', 'validates', 'documents', 'depends_on'],
          default: 'implements',
        },
        projectPath: projectPathProperty,
      },
      required: ['spec_id', 'target_file_path', 'target_qualified_name'],
    },
  },
  {
    name: 'specship_link_verify',
    description:
      'Report the outcome of verifying a spec→code link (e.g., after running tests). pass → state moves to "verified"; fail → "broken" with the optional reason in metadata. Use this in spec-verify / spec-fix workflows or after manual test runs.',
    inputSchema: {
      type: 'object',
      properties: {
        link_id: {
          type: 'number',
          description: 'The link ID returned by specship_link_assert or specship_spec',
        },
        result: {
          type: 'string',
          description: 'Verification outcome',
          enum: ['pass', 'fail'],
        },
        reason: {
          type: 'string',
          description: 'Optional explanation (test name, failure message, etc.)',
        },
        projectPath: projectPathProperty,
      },
      required: ['link_id', 'result'],
    },
  },
  {
    name: 'specship_drifted',
    description:
      'List spec→code links in concerning states: drifted (spec or code changed after link was set), broken (verification failed), orphaned (target code symbol no longer exists). The non-coder review queue. Use --state to filter.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'Comma-separated states to include (default: "drifted,broken,orphaned")',
        },
        limit: {
          type: 'number',
          description: 'Maximum links to return (default: 50)',
          default: 50,
        },
        projectPath: projectPathProperty,
      },
    },
  },
];

// ===========================================================================
// Handlers — free functions called by ToolHandler wrappers in tools.ts
// ===========================================================================

const text = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
});

const error = (msg: string): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${msg}` }],
  isError: true,
});

/** Format one link line for inclusion in `specship_spec` / `specship_drifted`. */
function formatLink(link: SpecLink): string {
  const resolved = link.resolvedNodeId ? '✓' : '✗';
  const driftSuffix = link.driftAxis ? ` [drift=${link.driftAxis}]` : '';
  const conf = link.confidence !== undefined ? ` (${link.confidence.toFixed(2)})` : '';
  return `  - [${link.state}${driftSuffix}] ${resolved} ${link.kind} → ${link.targetFilePath}:${link.targetQualifiedName} <${link.provenance}${conf}>  #${link.id}`;
}

export async function handleSpecshipSpec(
  cg: SpecShip,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const specId = args.spec_id;
  if (typeof specId !== 'string' || specId.length === 0) {
    return error('spec_id is required (string)');
  }
  const sq = cg.getSpecQueries();
  const spec = sq.getSpecById(specId);
  if (!spec) {
    return error(`Spec "${specId}" not found. Use specship_drifted or specship_search to discover specs.`);
  }

  const parent = spec.parentId ? sq.getSpecById(spec.parentId) : null;
  const children = sq.getSpecsByParent(spec.id);
  const siblings = parent ? sq.getSpecsByParent(parent.id).filter((s) => s.id !== spec.id) : [];
  const links = sq.getLinksBySpec(spec.id);

  const lines: string[] = [];
  lines.push(`# ${spec.id} — ${spec.title}`);
  lines.push(`*kind: ${spec.kind}*${spec.owner ? ` · *owner: ${spec.owner}*` : ''}${spec.priority ? ` · *priority: ${spec.priority}*` : ''}`);
  lines.push(`*source: ${spec.sourcePath}${spec.startLine ? `:${spec.startLine}` : ''}*`);
  lines.push('');
  if (parent) {
    lines.push(`**Parent:** ${parent.id} — ${parent.title}`);
  }
  if (siblings.length > 0) {
    lines.push(`**Siblings:** ${siblings.map((s) => `${s.id}`).join(', ')}`);
  }
  if (children.length > 0) {
    lines.push(`**Children:** ${children.map((c) => `${c.id}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## Body');
  lines.push(spec.body || '_(empty)_');
  lines.push('');
  lines.push('## Linked code');
  if (links.length === 0) {
    lines.push('_No linked code yet. Implement this spec, then call specship_link_assert._');
  } else {
    for (const link of links) lines.push(formatLink(link));
  }

  return text(lines.join('\n'));
}

export async function handleSpecshipLinkAssert(
  cg: SpecShip,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const specId = args.spec_id;
  const targetFilePath = args.target_file_path;
  const targetQualifiedName = args.target_qualified_name;
  const targetNodeKind = (args.target_node_kind as NodeKind | undefined) ?? 'function';
  const kind = (args.kind as SpecLinkKind | undefined) ?? 'implements';

  if (typeof specId !== 'string' || specId.length === 0) {
    return error('spec_id is required');
  }
  if (typeof targetFilePath !== 'string' || targetFilePath.length === 0) {
    return error('target_file_path is required');
  }
  if (typeof targetQualifiedName !== 'string' || targetQualifiedName.length === 0) {
    return error('target_qualified_name is required');
  }

  const sq = cg.getSpecQueries();
  const spec = sq.getSpecById(specId);
  if (!spec) {
    return error(`Spec "${specId}" not found. Make sure the spec file is indexed (specship index).`);
  }

  // Find current node (if any) so we can snapshot its signature.
  const resolver = cg.getSpecLinkResolver();
  // Use the resolver's logical target lookup indirectly via SpecQueries: a
  // separate small lookup keeps spec-tools standalone.
  const candidates = cg
    .getSpecQueries()
    .getLinksByLogicalTarget(targetFilePath, targetQualifiedName);
  // The lookup above returns existing links, not current nodes — use the
  // queries directly for that.
  // Lightweight node lookup via QueryBuilder is not exposed here, so let the
  // resolver fill in resolved_node_id on its next pass; we leave it NULL
  // for this assertion and rely on the upcoming resolveAll to populate.
  void candidates;

  const now = Date.now();
  const linkId = sq.upsertSpecLink({
    specId,
    targetFilePath,
    targetQualifiedName,
    targetNodeKind,
    resolvedNodeId: undefined,
    kind,
    state: 'implemented',
    driftAxis: null,
    specHashAtLink: spec.contentHash,
    nodeSigAtLink: undefined,
    provenance: 'agent-asserted',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  });

  // Run the resolver against this single file so resolved_node_id gets
  // populated immediately (otherwise it sits NULL until the next index/sync).
  resolver.resolveLinksForFiles([targetFilePath]);

  return text(
    `Asserted ${kind} link: ${specId} → ${targetFilePath}:${targetQualifiedName} (link #${linkId})`
  );
}

export async function handleSpecshipLinkVerify(
  cg: SpecShip,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const linkId = args.link_id;
  const result = args.result;
  const reason = typeof args.reason === 'string' ? args.reason : undefined;

  if (typeof linkId !== 'number' || !Number.isFinite(linkId)) {
    return error('link_id is required (number)');
  }
  if (result !== 'pass' && result !== 'fail') {
    return error('result must be "pass" or "fail"');
  }

  const sq = cg.getSpecQueries();
  const link = sq.getLinkById(linkId);
  if (!link) {
    return error(`Link #${linkId} not found`);
  }

  const newState: SpecLinkState = result === 'pass' ? 'verified' : 'broken';
  sq.updateSpecLinkState(linkId, newState, null);

  return text(
    `Link #${linkId} (${link.specId} → ${link.targetQualifiedName}): ${newState}${
      reason ? ` — ${reason}` : ''
    }`
  );
}

export async function handleSpecshipDrifted(
  cg: SpecShip,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const stateArg = typeof args.state === 'string' ? args.state : 'drifted,broken,orphaned';
  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
      ? Math.min(args.limit, 500)
      : 50;

  const states = stateArg
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SpecLinkState =>
      (SPEC_LINK_STATES as readonly string[]).includes(s)
    );
  if (states.length === 0) {
    return error(
      `state must be a comma-separated list of: ${SPEC_LINK_STATES.join(', ')}`
    );
  }

  const sq = cg.getSpecQueries();
  const links = sq.getLinksByState(states).slice(0, limit);

  if (links.length === 0) {
    return text(`No links in states: ${states.join(', ')}. ✨ Drift queue is clean.`);
  }

  const lines: string[] = [];
  lines.push(`# Drifted / broken / orphaned links (${links.length})`);
  lines.push('');
  for (const link of links) {
    const spec = sq.getSpecById(link.specId);
    const title = spec ? ` — ${spec.title}` : '';
    lines.push(`### ${link.specId}${title}`);
    lines.push(formatLink(link));
    lines.push('');
  }
  lines.push(
    `Re-attach: call specship_link_assert with the corrected target. Resolve drift: edit code (or spec) to match, then specship_link_verify {link_id, result: "pass"}.`
  );

  return text(lines.join('\n'));
}

/**
 * Render the "Linked specs" section appended to `specship_node` output.
 * Returns empty string when the node has no linked specs (so the caller
 * doesn't emit a header for nothing).
 */
export function renderLinkedSpecsForNode(cg: SpecShip, nodeId: string): string {
  const sq = cg.getSpecQueries();
  const links = sq.getLinksByNode(nodeId);
  if (links.length === 0) return '';
  const lines: string[] = ['', '### Linked specs'];
  for (const link of links) {
    const spec = sq.getSpecById(link.specId);
    const title = spec ? ` — ${spec.title}` : '';
    lines.push(
      `- **${link.specId}**${title} · ${link.state}${link.driftAxis ? ` (drift=${link.driftAxis})` : ''} · ${link.kind} <${link.provenance}>`
    );
  }
  return lines.join('\n');
}
