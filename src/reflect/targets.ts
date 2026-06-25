/**
 * Target resolution (REQ-REFLECT-002).
 *
 * Each proposal type maps to a concrete write target with its own marker
 * convention so the apply can be idempotent (re-apply = no-op) and reversible
 * (undo strips exactly what apply added — REQ-REFLECT-004):
 *
 *   - memory_rule, project scope  → a `<!-- SPECSHIP_LEARNING:<id> -->` block in
 *                                    the project CLAUDE.md
 *   - memory_rule, portable scope → a new `~/.claude/memory/<slug>.md` note
 *                                    (carrying a `specship_proposal:` frontmatter
 *                                    marker) + a one-line `MEMORY.md` pointer
 *   - skill                       → a new `commands/ss-<name>.md` (carrying a
 *                                    leading marker comment)
 *   - hook                        → a hook entry merged into `.claude/settings.json`
 *
 * This module is pure: it builds the payload + path, it does not touch disk.
 */

import * as path from 'path';
import { proposalHash } from './hash';
import {
  Proposal,
  ProposalEvidence,
  ProposalPayload,
  ProposalSeverity,
  ProposalType,
  ReflectContext,
  TargetKind,
} from './types';

/** Marker bounding an engine-written block in CLAUDE.md / command files. */
export function learningMarkers(id: string): { start: string; end: string } {
  return {
    start: `<!-- SPECSHIP_LEARNING:${id} -->`,
    end: `<!-- /SPECSHIP_LEARNING:${id} -->`,
  };
}

/** Frontmatter marker line stamped into an engine-created memory note. */
export function memoryNoteMarker(id: string): string {
  return `specship_proposal: ${id}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'learning';
}

/**
 * Assemble a fully-formed Proposal from a rule's raw inputs. Computes the target
 * path, builds the type-specific payload (including its markers), and derives the
 * stable content hash. `createdAt`/`updatedAt` are stamped by the caller (the
 * store) — here they default to 0 so the object is pure/deterministic.
 */
export function buildProposal(
  ctx: ReflectContext,
  input: {
    type: ProposalType;
    severity: ProposalSeverity;
    title: string;
    body: string;
    evidence: ProposalEvidence;
    /** memory_rule scope: 'project' → CLAUDE.md, 'portable' → ~/.claude/memory note. */
    scope?: 'project' | 'portable';
    /** The durable rule/skill/hook content, type-dependent. */
    content: string;
    /** Hook-only: the settings.json event + matcher + command. */
    hook?: { event: string; matcher: string; command: string };
    /** A short name seed (for slug / command name). */
    nameSeed: string;
  },
): Proposal {
  let targetKind: TargetKind;
  let targetPath: string;
  let payload: ProposalPayload;

  if (input.type === 'memory_rule') {
    if (input.scope === 'portable') {
      const slug = slugify(input.nameSeed);
      targetKind = 'memory_note';
      targetPath = path.join(ctx.homeDir, '.claude', 'memory', `${slug}.md`);
      // Hash needs a deterministic id; derive a provisional one from the slug so
      // the marker is stable, then fold everything into the final hash below.
      const note = renderMemoryNote(slug, input.title, input.content);
      const indexLine = `- [${input.title}](${slug}.md) — ${firstSentence(input.body)}`;
      payload = { kind: 'memory_note', slug, note, indexLine };
    } else {
      targetKind = 'claude_md';
      targetPath = path.join(ctx.projectRoot, 'CLAUDE.md');
      // markerId is finalized after we know the hash; use a placeholder then
      // re-render once hashed (below) so the block carries its own id.
      payload = { kind: 'claude_md', markerId: '', block: '' };
    }
  } else if (input.type === 'skill') {
    const name = slugify(input.nameSeed).replace(/^ss-/, '');
    targetKind = 'command';
    targetPath = path.join(ctx.projectRoot, 'commands', `ss-${name}.md`);
    payload = { kind: 'command', name: `ss-${name}`, content: '' };
  } else {
    // hook
    targetKind = 'settings_hook';
    targetPath = path.join(ctx.projectRoot, '.claude', 'settings.json');
    const h = input.hook!;
    payload = {
      kind: 'settings_hook',
      event: h.event,
      matcher: h.matcher,
      entry: { type: 'command', command: h.command },
    };
  }

  // First-pass hash over the (still-placeholder) identity, then bake the id into
  // marker-bearing payloads and re-hash so the persisted hash matches the bytes.
  let contentHash = proposalHash({ type: input.type, targetKind, targetPath, payload });

  if (payload.kind === 'claude_md') {
    const { start, end } = learningMarkers(contentHash);
    const block = `${start}\n${renderClaudeRule(input.title, input.content)}\n${end}`;
    payload = { kind: 'claude_md', markerId: contentHash, block };
    contentHash = proposalHash({ type: input.type, targetKind, targetPath, payload });
  } else if (payload.kind === 'command') {
    const content = renderCommand(contentHash, payload.name, input.title, input.content);
    payload = { kind: 'command', name: payload.name, content };
    contentHash = proposalHash({ type: input.type, targetKind, targetPath, payload });
  }

  return {
    contentHash,
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    targetKind,
    targetPath,
    payload,
    evidence: input.evidence,
    state: 'open',
    createdAt: 0,
    updatedAt: 0,
    appliedAt: null,
  };
}

function firstSentence(s: string): string {
  const m = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return m.length > 100 ? m.slice(0, 100) + '…' : m;
}

/** The rule body written inside a CLAUDE.md marked block. */
function renderClaudeRule(title: string, content: string): string {
  return `## ${title}\n\n${content}\n\n_(Added by SpecShip reflection — edit or remove freely.)_`;
}

/** A self-contained memory note matching the user's memory-file convention. */
function renderMemoryNote(slug: string, title: string, content: string): string {
  return [
    '---',
    `name: ${slug}`,
    `description: ${firstSentence(title)}`,
    `${memoryNoteMarker(slug)}`,
    'metadata:',
    '  type: feedback',
    '---',
    '',
    content,
    '',
  ].join('\n');
}

/** A minimal slash-command skill file. */
function renderCommand(id: string, name: string, title: string, content: string): string {
  const { start, end } = learningMarkers(id);
  return [
    start,
    `# ${title}`,
    '',
    `> \`/${name}\` — proposed by SpecShip reflection from a recurring pattern.`,
    '',
    content,
    '',
    end,
    '',
  ].join('\n');
}
