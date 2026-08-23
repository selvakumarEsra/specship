/**
 * Spec → JIRA publishing and tracking (JIRAPUB-DOC).
 *
 * The reverse of `spec-generator.ts` (which turns a JIRA issue into a spec):
 * this module turns an authored spec into a JIRA Story whose Sub-tasks mirror
 * the acceptance criteria (REQ-JIRAPUB-001), writes the JIRA identity back
 * into the spec's frontmatter (REQ-JIRAPUB-002), advances Sub-tasks when
 * acceptance evidence verifies (REQ-JIRAPUB-005), comments drift transitions
 * onto the issue (REQ-JIRAPUB-006), stamps release fix versions
 * (REQ-JIRAPUB-007), and fingerprints published content so JIRA-side edits
 * are detectable (REQ-JIRAPUB-008).
 *
 * All network I/O goes through an injectable structural client (the subset of
 * `JiraClient` each operation needs), so the test suite drives every path
 * with fakes and no real JIRA is ever touched. No function here handles or
 * echoes a credential (REQ-JIRA-009) — only public keys and spec-derived text.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { JiraEpicRequiredError, type JiraIssueResult, type JiraTransitionResult } from './types';
import { reqIdForIssue } from './spec-generator';
import {
  postMilestoneComment,
  type MilestoneJiraClient,
} from './milestone-comment';

// ---------------------------------------------------------------------------
// Structural client slices — each op declares only what it uses.
// ---------------------------------------------------------------------------

export interface PublishJiraClient {
  createIssue(fields: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    parentKey?: string;
  }): Promise<{ key: string; id: string }>;
  updateIssue(
    key: string,
    fields: { summary?: string; description?: string },
  ): Promise<void>;
  getIssue(key: string): Promise<JiraIssueResult>;
  /** The user's accessible projects (REQ-JIRAPUB-009) — the picker source. */
  listProjects(): Promise<Array<{ key: string; name: string }>>;
}

export interface AdvanceJiraClient {
  getIssue(key: string): Promise<JiraIssueResult>;
  transitionIssue(key: string, nameOrId: string): Promise<JiraTransitionResult>;
}

export interface CommentJiraClient {
  addComment(key: string, body: string): Promise<void>;
}

/**
 * Client slice for the watermarked, edit-in-place comment path
 * (REQ-JIRATEAM-004.A3). The GET enumerates comments to find the prior post;
 * POST creates a new one; PUT edits it in place. Kept structural so tests
 * inject a fake without a live host.
 */
export interface WatermarkedCommentJiraClient {
  listCommentsDetailed(key: string): Promise<Array<{ id: string; body: string }>>;
  addComment(key: string, body: string): Promise<{ id: string } | void>;
  updateComment(key: string, commentId: string, body: string): Promise<void>;
}

export interface UpsertWatermarkedCommentResult {
  action: 'created' | 'updated';
  commentId: string;
}

/**
 * Post `body` as a single watermarked comment on `issueKey`, edited in place
 * on re-post (REQ-JIRATEAM-004.A3). The caller passes a `watermark` string
 * (an HTML comment token like `<!-- specship:coverage v1 -->`); the first
 * existing comment whose body starts with that watermark is updated in place,
 * and if none exists a new one is created. The single-comment discipline is
 * enforced by starting from the FIRST matching comment — a re-run never
 * creates a duplicate.
 */
export async function upsertWatermarkedComment(
  client: WatermarkedCommentJiraClient,
  issueKey: string,
  watermark: string,
  body: string,
): Promise<UpsertWatermarkedCommentResult> {
  const existing = await client.listCommentsDetailed(issueKey);
  const prior = existing.find((c) => c.body.startsWith(watermark));
  if (prior) {
    await client.updateComment(issueKey, prior.id, body);
    return { action: 'updated', commentId: prior.id };
  }
  const created = await client.addComment(issueKey, body);
  const commentId =
    created && typeof (created as { id?: unknown }).id === 'string'
      ? (created as { id: string }).id
      : '';
  return { action: 'created', commentId };
}

export interface ReleaseJiraClient {
  ensureProjectVersion(projectKey: string, name: string): Promise<{ created: boolean }>;
  setFixVersion(key: string, versionName: string): Promise<{ added: boolean }>;
  listComments(key: string): Promise<string[]>;
  addComment(key: string, body: string): Promise<void>;
  // The milestone dispatcher's shape (optional here — release_stamped routes
  // through it when the real client is passed; older test seams that only
  // implement `listComments`/`addComment` still work via the legacy path).
  listCommentsDetailed?(key: string): Promise<Array<{ id: string; body: string }>>;
  updateComment?(key: string, commentId: string, body: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Publish (REQ-JIRAPUB-001)
// ---------------------------------------------------------------------------

/** The spec data a publish needs — plain data, supplied from the index. */
export interface SpecPublishSource {
  /** Requirement spec id, e.g. `REQ-FOO-001`. */
  specId: string;
  /** Requirement title (the Story summary). */
  title: string;
  /** Requirement body (prose). */
  body: string;
  /** Repo-relative path of the spec file (embedded in the description). */
  specRelPath: string;
  /** Acceptance criteria in order, each becoming a Sub-task. */
  acceptance: Array<{ id: string; text: string }>;
}

export interface PublishOptions {
  projectKey: string;
  /** Issue type for the main issue. Default `Story`. */
  issueType?: string;
  /** Issue type for the acceptance children. Default `Sub-task`. */
  subtaskType?: string;
  /**
   * Epic anchor for the Story (REQ-JIRATEAM-006). On CREATE this is used as
   * the Story's `parent.key`. On UPDATE the recorded epic is compared to the
   * live parent and a mismatch logs a `reparent_skipped` warning — the live
   * parent is NEVER changed silently (A4).
   */
  epicKey?: string;
  /**
   * When true (bound-repo intake gate, REQ-JIRATEAM-006.A3), publishing
   * without a resolvable `epicKey` throws `JiraEpicRequiredError` instead of
   * creating an unanchored Story. Default: false (backwards compat).
   */
  requireEpic?: boolean;
}

export interface PublishResult {
  key: string;
  created: boolean;
  subtasksCreated: number;
  /** Fingerprint of what was written (REQ-JIRAPUB-008). */
  fingerprint: string;
  /**
   * The epic the Story is anchored to (REQ-JIRATEAM-006): set on create
   * from `opts.epicKey`, on update reflects the LIVE parent read from JIRA
   * (so callers can detect the A4 mismatch without a separate GET). Absent
   * when no epic is anchored.
   */
  epicKey?: string;
  /**
   * True when the caller passed `opts.epicKey` but the Story's live parent
   * differs and update-time re-parenting was skipped (REQ-JIRATEAM-006.A4).
   */
  reparentSkipped?: boolean;
}

/** JIRA summaries cap at 255 chars; stay comfortably under it. */
const SUMMARY_MAX = 240;

/** One-line, length-bounded Sub-task summary for an acceptance criterion. */
export function subtaskSummary(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > SUMMARY_MAX
    ? `${oneLine.slice(0, SUMMARY_MAX - 1)}…`
    : oneLine;
}

/** Build the Story's summary + description from the spec source. */
export function buildIssueFields(source: SpecPublishSource): {
  summary: string;
  description: string;
} {
  const summary = subtaskSummary(source.title || source.specId);
  const lines: string[] = [];
  if (source.body.trim()) lines.push(source.body.trim(), '');
  if (source.acceptance.length > 0) {
    lines.push('Acceptance criteria:');
    for (const a of source.acceptance) lines.push(`* ${subtaskSummary(a.text)}`);
    lines.push('');
  }
  lines.push(`Spec: ${source.specRelPath} (${source.specId}, published by SpecShip)`);
  return { summary, description: lines.join('\n') };
}

/**
 * Content fingerprint of what publish wrote to the issue (REQ-JIRAPUB-008).
 * Stable, short, and safe for frontmatter.
 */
export function issueContentFingerprint(summary: string, description: string): string {
  return crypto
    .createHash('sha256')
    .update(summary)
    .update(' ')
    .update(description)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Publish a spec as a Story with one Sub-task per acceptance criterion
 * (REQ-JIRAPUB-001). Idempotent on `existingKey`: when the spec already
 * carries a key, the Story is updated in place and only the Sub-tasks whose
 * summaries are missing are created — never a duplicate Story, never a
 * Sub-task deletion.
 */
export async function publishSpecToJira(
  client: PublishJiraClient,
  source: SpecPublishSource,
  opts: PublishOptions,
  existingKey: string | null,
): Promise<PublishResult> {
  const issueType = opts.issueType ?? 'Story';
  const subtaskType = opts.subtaskType ?? 'Sub-task';
  const fields = buildIssueFields(source);
  const fingerprint = issueContentFingerprint(fields.summary, fields.description);
  const epicKey = opts.epicKey?.trim() || undefined;

  if (opts.requireEpic && !epicKey) {
    throw new JiraEpicRequiredError(
      `Refusing to publish ${source.specId} without an epic anchor. ` +
        `Set "jira.epicKey" in specship.config.json or pick an epic — ` +
        `an unanchored Story would break the board-first intake gate.`,
    );
  }

  let key: string;
  let created: boolean;
  let existingSummaries: Set<string>;
  let liveParentKey: string | undefined;
  let reparentSkipped = false;

  if (existingKey) {
    await client.updateIssue(existingKey, fields);
    key = existingKey;
    created = false;
    const detail = await client.getIssue(existingKey);
    existingSummaries = new Set(
      (detail.issue.subtasks ?? []).map(s => s.summary.trim()),
    );
    liveParentKey = detail.issue.parentKey;
    // A4: never re-parent a live Story silently. When the caller supplied
    // an epicKey (from frontmatter or the binding default) and it differs
    // from what JIRA reports as the parent, log and leave JIRA untouched.
    if (epicKey && liveParentKey && liveParentKey !== epicKey) {
      reparentSkipped = true;
      // Credential-free by construction — only public keys travel here.
      console.warn(
        `[specship] reparent_skipped: ${key} lives under ${liveParentKey}, ` +
          `frontmatter names ${epicKey}. Not re-parenting; edit JIRA directly ` +
          `to move the Story.`,
      );
    }
  } else {
    const made = await client.createIssue({
      projectKey: opts.projectKey,
      issueType,
      summary: fields.summary,
      description: fields.description,
      ...(epicKey ? { parentKey: epicKey } : {}),
    });
    key = made.key;
    created = true;
    existingSummaries = new Set();
  }

  let subtasksCreated = 0;
  for (const a of source.acceptance) {
    const summary = subtaskSummary(a.text);
    if (existingSummaries.has(summary)) continue;
    await client.createIssue({
      projectKey: opts.projectKey,
      issueType: subtaskType,
      summary,
      parentKey: key,
    });
    subtasksCreated++;
  }

  // On CREATE we return the requested epic so the caller stamps it into
  // frontmatter. On UPDATE we return undefined — the frontmatter is the
  // source of truth for intent; overwriting it with the live parent would
  // silently erase a user's re-anchor request (A4).
  return {
    key,
    created,
    subtasksCreated,
    fingerprint,
    ...(created && epicKey ? { epicKey } : {}),
    ...(reparentSkipped ? { reparentSkipped: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Frontmatter write-back (REQ-JIRAPUB-002 / -008)
// ---------------------------------------------------------------------------

/** Read one scalar frontmatter value out of spec-file content, or null. */
export function readFrontmatterValue(content: string, key: string): string | null {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '---') break;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    if (line.slice(0, colon).trim() !== key) continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Frontmatter key names carrying requirement `specId`'s JIRA identity in a
 * MULTI-requirement file (REQ-JIRATEAM-010). File-level `jira_issue:` is
 * ambiguous the moment a file holds two requirements — resolving it for the
 * second requirement updated the first one's issue, last writer wins. A
 * single-requirement file keeps the plain names for back-compat.
 */
export function perSpecFrontmatterKeys(specId: string): {
  issueKey: string;
  fingerprintKey: string;
} {
  return {
    issueKey: `jira_issue_${specId}`,
    fingerprintKey: `jira_fingerprint_${specId}`,
  };
}

/** Upsert scalar keys into the leading frontmatter, creating a block if absent. */
function upsertFrontmatter(
  content: string,
  entries: Record<string, string>,
): string {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') {
    const block = ['---', ...Object.entries(entries).map(([k, v]) => `${k}: ${v}`), '---', ''];
    return block.join('\n') + content;
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) end = 1; // tolerate an unclosed block: insert right after open
  const pending = { ...entries };
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? '';
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const k = line.slice(0, colon).trim();
    if (k in pending) {
      lines[i] = `${k}: ${pending[k]}`;
      delete pending[k];
    }
  }
  const additions = Object.entries(pending).map(([k, v]) => `${k}: ${v}`);
  lines.splice(end, 0, ...additions);
  return lines.join('\n');
}

export interface WriteBackOptions {
  /** Fingerprint of the published content (REQ-JIRAPUB-008). */
  fingerprint: string;
  /**
   * When present (REQ-JIRATEAM-006.A1/A2), also stamps `epicKey:` into the
   * spec frontmatter so a re-publish honours the same anchor next time.
   */
  epicKey?: string;
  /**
   * Re-id instruction (REQ-JIRAPUB-002): rewrite `<!-- id: from -->` markers
   * (and `.A<n>` children) to the key-derived id. Pass null to keep ids —
   * the caller decides (only safe pre-links, single-requirement files).
   */
  reId: { from: string } | null;
  /** New basename (`<key>-<slug>.md`) to rename to, or null to keep the name. */
  renameTo: string | null;
  /**
   * When set (multi-requirement file, REQ-JIRATEAM-010), the identity is
   * written under the per-requirement keys (`jira_issue_<id>` /
   * `jira_fingerprint_<id>`) instead of the ambiguous plain file-level pair.
   */
  forSpecId?: string;
}

/**
 * Write the JIRA identity into the spec file (REQ-JIRAPUB-002): frontmatter
 * `jira_issue:` + `jira_fingerprint:`, optional marker re-id, optional rename.
 * Returns the (possibly new) absolute path.
 */
export function writeBackJiraIdentity(
  specPath: string,
  issueKey: string,
  opts: WriteBackOptions,
): { path: string } {
  let content = fs.readFileSync(specPath, 'utf8');

  if (opts.reId) {
    const from = opts.reId.from;
    const to = reqIdForIssue(issueKey);
    if (from && from !== to) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`(<!--\\s*id:\\s*)${escaped}((?:\\.A\\d+)?\\s*-->)`, 'g'),
        `$1${to}$2`,
      );
    }
  }

  const names = opts.forSpecId
    ? perSpecFrontmatterKeys(opts.forSpecId)
    : { issueKey: 'jira_issue', fingerprintKey: 'jira_fingerprint' };
  content = upsertFrontmatter(content, {
    [names.issueKey]: issueKey,
    [names.fingerprintKey]: opts.fingerprint,
    ...(opts.epicKey ? { epicKey: opts.epicKey } : {}),
  });

  let target = specPath;
  if (opts.renameTo && path.basename(specPath) !== opts.renameTo) {
    target = path.join(path.dirname(specPath), opts.renameTo);
  }
  fs.writeFileSync(target, content, 'utf8');
  if (target !== specPath) fs.rmSync(specPath, { force: true });
  return { path: target };
}

/** `<key>-<title-slug>.md` filename for a published, link-less spec. */
export function publishedSpecFilename(issueKey: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  const keyPart = issueKey.toLowerCase();
  return slug ? `${keyPart}-${slug}.md` : `${keyPart}.md`;
}

// ---------------------------------------------------------------------------
// Verified evidence → Sub-task advance (REQ-JIRAPUB-005)
// ---------------------------------------------------------------------------

/** Statuses that count as "already done" when checking Story completion. */
const DONE_STATUSES = new Set(['done', 'closed', 'resolved']);

export interface AdvanceResult {
  /** What happened to the Sub-task. */
  subtask:
    | { key: string; result: JiraTransitionResult }
    | { skipped: true; reason: string };
  /** Set when every Sub-task is done and the Story transition was attempted. */
  story?: { key: string; result: JiraTransitionResult };
}

/**
 * Advance the Sub-task that mirrors a just-verified acceptance criterion
 * (REQ-JIRAPUB-005), then — when every Sub-task of the Story reads done —
 * advance the Story itself. Skip-tolerant end to end: a missing Sub-task or
 * missing transition reports a skip, never throws past the client's own
 * auth/network faults.
 */
export async function advanceSubtaskForAcceptance(
  client: AdvanceJiraClient,
  storyKey: string,
  acceptanceText: string,
  doneTransition: string,
): Promise<AdvanceResult> {
  const wanted = subtaskSummary(acceptanceText);
  const detail = await client.getIssue(storyKey);
  const subtasks = detail.issue.subtasks ?? [];
  const match = subtasks.find(s => s.summary.trim() === wanted);
  if (!match) {
    return {
      subtask: {
        skipped: true,
        reason: `no Sub-task of ${storyKey} matches the acceptance text`,
      },
    };
  }

  const result = await client.transitionIssue(match.key, doneTransition);
  const out: AdvanceResult = { subtask: { key: match.key, result } };

  // Story roll-up: re-read so the just-transitioned Sub-task counts.
  const after = await client.getIssue(storyKey);
  const all = after.issue.subtasks ?? [];
  const allDone =
    all.length > 0 && all.every(s => DONE_STATUSES.has(s.status.trim().toLowerCase()));
  if (allDone) {
    out.story = {
      key: storyKey,
      result: await client.transitionIssue(storyKey, doneTransition),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drift comment (REQ-JIRAPUB-006)
// ---------------------------------------------------------------------------

/**
 * Comment a genuine drift TRANSITION onto the issue (REQ-JIRAPUB-006). The
 * caller fires this only from transition events (the resolver's stats record
 * a transition once, not on every re-observation), which is what keeps the
 * comment single per ongoing drift (A2).
 */
export async function commentSpecDrift(
  client: CommentJiraClient,
  issueKey: string,
  specId: string,
  symbol: string,
  axis: string,
): Promise<void> {
  // When the client supports the watermarked/milestone shape (real JiraClient
  // does), route through the shared milestone dispatcher so drift comments get
  // the same idempotency + evidence discipline as every other milestone
  // (REQ-JIRATEAM-003.A1/A2). Older test seams that only implement
  // `addComment` fall through to the plain path — preserving REQ-JIRAPUB-006
  // behavior.
  const maybe = client as Partial<MilestoneJiraClient>;
  if (
    typeof maybe.listCommentsDetailed === 'function' &&
    typeof maybe.updateComment === 'function' &&
    typeof maybe.addComment === 'function'
  ) {
    await postMilestoneComment(maybe as MilestoneJiraClient, issueKey, 'drift_transition', {
      specId,
      driftSymbol: symbol,
      driftAxis: axis,
    });
    return;
  }
  await client.addComment(
    issueKey,
    `SpecShip drift: ${symbol} drifted (axis: ${axis}) under ${specId}. ` +
      'The code that realizes this requirement changed since it was linked — re-verify before relying on it.',
  );
}

/** The shape of one drift transition event (from the resolver stats). */
export interface DriftTransitionLike {
  specId: string;
  axis: string;
  symbol: string;
}

/**
 * Comment a batch of drift TRANSITIONS onto their JIRA issues
 * (REQ-JIRAPUB-006). Driven from the sync path's transition events, so a
 * still-drifted link on a later sync produces no event and no repeat comment
 * (A2). Specs without a `jira_issue:` key are skipped with no JIRA call (A3);
 * per-item failures degrade to a note and never block the sync.
 */
export async function commentDriftTransitionsOnJira(opts: {
  transitions: DriftTransitionLike[];
  /** Resolve a spec id to the ABSOLUTE path of its spec file, or null. */
  specPathFor: (specId: string) => string | null;
  /** Read the spec file's jira_issue key (null → not JIRA-backed). */
  readKey: (absPath: string) => string | null;
  /** Lazily build the comment client — called only when a comment is due. */
  makeClient: () => CommentJiraClient;
}): Promise<string[]> {
  const notes: string[] = [];
  let client: CommentJiraClient | null = null;
  const commented = new Set<string>();
  for (const t of opts.transitions) {
    try {
      const specPath = opts.specPathFor(t.specId);
      if (!specPath) continue;
      const key = opts.readKey(specPath);
      if (!key) continue; // not JIRA-backed → no JIRA call (A3)
      const dedupe = `${key}|${t.specId}|${t.symbol}|${t.axis}`;
      if (commented.has(dedupe)) continue;
      commented.add(dedupe);
      client = client ?? opts.makeClient();
      await commentSpecDrift(client, key, t.specId, t.symbol, t.axis);
      notes.push(`commented drift on ${key} (${t.symbol})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`couldn't comment drift for ${t.specId} (${msg})`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Release fixVersion (REQ-JIRAPUB-007)
// ---------------------------------------------------------------------------

export interface ReleaseIssuesResult {
  versionCreated: boolean;
  issues: Array<{ key: string; fixVersionAdded: boolean; commented: boolean }>;
}

/** The idempotency marker inside the shipped-in comment. */
function shippedMarker(version: string): string {
  return `SpecShip: shipped in ${version}`;
}

/**
 * Stamp `version` onto `keys` (REQ-JIRAPUB-007): ensure the project version
 * exists, add it as fixVersion on each issue, and add one shipped-in comment
 * per issue. Every step is idempotent — a re-run creates no duplicate
 * version, fixVersion, or comment.
 */
export async function releaseIssues(
  client: ReleaseJiraClient,
  projectKey: string,
  version: string,
  keys: string[],
  opts?: { specIdForIssue?: (issueKey: string) => string | undefined },
): Promise<ReleaseIssuesResult> {
  const { created } = await client.ensureProjectVersion(projectKey, version);
  const issues: ReleaseIssuesResult['issues'] = [];
  const canMilestone =
    typeof client.listCommentsDetailed === 'function' &&
    typeof client.updateComment === 'function';
  for (const key of keys) {
    const { added } = await client.setFixVersion(key, version);
    let commented = false;
    if (canMilestone) {
      // Route through the shared milestone dispatcher — it recognizes the
      // pre-existing `SpecShip: shipped in X` legacy marker and skips
      // instead of double-commenting (REQ-JIRATEAM-003.A1 idempotency
      // with pre-migration comments).
      const specId = opts?.specIdForIssue?.(key) ?? key;
      const outcome = await postMilestoneComment(
        client as MilestoneJiraClient,
        key,
        'release_stamped',
        { specId, version },
      );
      commented = outcome.status === 'created' || outcome.status === 'updated';
    } else {
      const marker = shippedMarker(version);
      const existing = await client.listComments(key);
      if (!existing.some((body) => body.includes(marker))) {
        await client.addComment(key, marker);
        commented = true;
      }
    }
    issues.push({ key, fixVersionAdded: added, commented });
  }
  return { versionCreated: created, issues };
}
