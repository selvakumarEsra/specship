/**
 * Lifecycle milestone comments on a JIRA issue (REQ-JIRATEAM-003).
 *
 * A single dispatcher every milestone site calls: spec published, plan
 * approved, PR raised, criterion verified, drift transition, release
 * stamped. Comments are watermarked, idempotent (upserted in place when
 * evidence changes, never duplicated), and soft-fail — a JIRA hiccup
 * degrades to a local note and never blocks the operation that triggered
 * it (A3). No credential and no non-public URL is ever embedded (A2).
 */
import * as fs from 'fs';
import * as path from 'path';

/** The closed set of milestones (A4 — nothing else earns a comment). */
export type MilestoneKind =
  | 'spec_published'
  | 'plan_approved'
  | 'pr_raised'
  | 'criterion_verified'
  | 'drift_transition'
  | 'release_stamped';

/** Repo-side evidence for a milestone. Fields are kind-specific. */
export interface MilestoneEvidence {
  /** Requirement id (e.g. REQ-FOO-001) — always present (A2). */
  specId: string;
  /** PR URL for `pr_raised`. */
  prUrl?: string;
  /** Verified acceptance criterion id(s) for `criterion_verified`. */
  criterionIds?: string[];
  /** Released version for `release_stamped`. */
  version?: string;
  /** Prior/next drift state for `drift_transition`. */
  driftFrom?: string;
  driftTo?: string;
  /** Symbol / axis for `drift_transition`. */
  driftSymbol?: string;
  driftAxis?: string;
}

/** Structural slice — same shape as publish.ts's watermarked client. */
export interface MilestoneJiraClient {
  listCommentsDetailed(key: string): Promise<Array<{ id: string; body: string }>>;
  addComment(key: string, body: string): Promise<{ id: string } | void>;
  updateComment(key: string, commentId: string, body: string): Promise<void>;
}

export interface PostMilestoneOptions {
  /** Where to write soft-fail notes. Default: `<projectRoot>/.specship/jira-notes.log`. */
  localNoteSink?: (note: string) => void;
  /** Project root used to derive the default note sink. */
  projectRoot?: string;
  /** Override the watermark version tag (defaults to reading package.json). */
  specshipVersion?: string;
}

export interface PostMilestoneResult {
  status: 'created' | 'updated' | 'skipped' | 'soft_failed';
  commentId?: string;
  /** When soft_failed, the reason string that went to the note sink. */
  reason?: string;
}

/**
 * Stable marker line placed at the TOP of every milestone comment.
 * Key: kind + specId (+ criterion id for `criterion_verified`, +
 * version for `release_stamped`, + from/to/symbol for `drift_transition`).
 * The listComments scan finds a prior comment by this exact prefix.
 */
export function milestoneMarker(kind: MilestoneKind, ev: MilestoneEvidence): string {
  const parts: string[] = [kind, ev.specId];
  if (kind === 'criterion_verified' && ev.criterionIds && ev.criterionIds.length > 0) {
    parts.push(ev.criterionIds.slice().sort().join(','));
  }
  if (kind === 'release_stamped' && ev.version) parts.push(ev.version);
  if (kind === 'drift_transition') {
    if (ev.driftSymbol) parts.push(ev.driftSymbol);
    if (ev.driftFrom || ev.driftTo) parts.push(`${ev.driftFrom ?? ''}>${ev.driftTo ?? ''}`);
  }
  return `<!-- specship:milestone:${parts.join(':')} -->`;
}

/**
 * Recognize a pre-existing `SpecShip: shipped in <version>` line placed by
 * the legacy release path (REQ-JIRAPUB-007). A tracked issue that already
 * carries this marker for the same version MUST NOT receive a second
 * comment (see the corrections applied to REQ-JIRATEAM-003).
 */
function legacyShippedLine(version: string): string {
  return `SpecShip: shipped in ${version}`;
}

let cachedVersion = '';
function readSpecShipVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    cachedVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * A2: reject a URL that carries credentials, resolves to a private/local
 * host, or uses a non-http(s) scheme. Any https host (github.com, GHE,
 * GitLab, self-hosted) is acceptable evidence — enterprises don't run
 * public GitHub.
 */
export function isPublicEvidenceUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  // user:pass@host embeds a credential — never accepted.
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  return true;
}

const CREDENTIAL_LINE_RE =
  /^\s*(authorization|x-atlassian-token|cookie|set-cookie|api[-_ ]?key|token|password|bearer)\s*[:=]/i;

/** Strip any line that looks like a header/credential dump (A2). */
function sanitizeBody(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !CREDENTIAL_LINE_RE.test(line))
    .join('\n');
}

/**
 * Render the human-readable milestone body. Callers never construct this
 * directly — everything flows through `postMilestoneComment` so the
 * watermark, marker, sanitization, and URL check apply uniformly.
 */
export function renderMilestoneBody(
  kind: MilestoneKind,
  ev: MilestoneEvidence,
  version: string,
): string {
  const marker = milestoneMarker(kind, ev);
  const lines: string[] = [marker, ''];
  switch (kind) {
    case 'spec_published':
      lines.push(`SpecShip: spec ${ev.specId} published to JIRA.`);
      break;
    case 'plan_approved':
      lines.push(`SpecShip: implementation plan for ${ev.specId} was approved.`);
      break;
    case 'pr_raised': {
      const suffix = ev.prUrl ? `: ${ev.prUrl}` : '';
      lines.push(`SpecShip: pull request raised for ${ev.specId}${suffix}`);
      break;
    }
    case 'criterion_verified': {
      const ids = (ev.criterionIds ?? []).join(', ') || ev.specId;
      lines.push(`SpecShip: acceptance criterion verified — ${ids} (spec ${ev.specId}).`);
      break;
    }
    case 'drift_transition': {
      const sym = ev.driftSymbol ?? '(symbol unknown)';
      const axis = ev.driftAxis ? ` axis: ${ev.driftAxis}` : '';
      const trans = ev.driftFrom && ev.driftTo ? ` (${ev.driftFrom} → ${ev.driftTo})` : '';
      lines.push(
        `SpecShip: drift on ${sym} under ${ev.specId}${trans}${axis}. ` +
          'Re-verify before relying on the linked code.',
      );
      break;
    }
    case 'release_stamped':
      lines.push(
        ev.version
          ? `${legacyShippedLine(ev.version)} (spec ${ev.specId}).`
          : `SpecShip: release stamped for ${ev.specId}.`,
      );
      break;
  }
  lines.push('', `— SpecShip v${version}`);
  return sanitizeBody(lines.join('\n'));
}

/**
 * Post (or upsert) a milestone comment. See file header for the invariants.
 */
export async function postMilestoneComment(
  client: MilestoneJiraClient,
  issueKey: string,
  kind: MilestoneKind,
  evidence: MilestoneEvidence,
  opts: PostMilestoneOptions = {},
): Promise<PostMilestoneResult> {
  const noteSink = opts.localNoteSink ?? defaultNoteSink(opts.projectRoot);

  // A2: an invalid/non-public URL in the evidence is a caller bug — refuse
  // to post rather than emit a comment linking to an internal host.
  if (evidence.prUrl && !isPublicEvidenceUrl(evidence.prUrl)) {
    const reason = `refused to post ${kind} for ${evidence.specId}: prUrl "${evidence.prUrl}" is not a public URL`;
    noteSink(reason);
    return { status: 'soft_failed', reason };
  }

  const version = opts.specshipVersion ?? readSpecShipVersion();
  const body = renderMilestoneBody(kind, evidence, version);
  const marker = milestoneMarker(kind, evidence);

  try {
    const existing = await client.listCommentsDetailed(issueKey);

    // Legacy shippedMarker recognition for `release_stamped` — an issue
    // already carrying the pre-existing marker for this version MUST NOT
    // get a duplicate comment (correction #2).
    if (kind === 'release_stamped' && evidence.version) {
      const legacy = legacyShippedLine(evidence.version);
      const legacyHit = existing.find(
        (c) => !c.body.startsWith('<!-- specship:milestone:') && c.body.includes(legacy),
      );
      if (legacyHit) {
        return { status: 'skipped', commentId: legacyHit.id };
      }
    }

    const prior = existing.find((c) => c.body.startsWith(marker));
    if (prior) {
      if (prior.body === body) {
        return { status: 'skipped', commentId: prior.id };
      }
      await client.updateComment(issueKey, prior.id, body);
      return { status: 'updated', commentId: prior.id };
    }

    const created = await client.addComment(issueKey, body);
    const commentId =
      created && typeof (created as { id?: unknown }).id === 'string'
        ? (created as { id: string }).id
        : undefined;
    return { status: 'created', commentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = `couldn't post ${kind} comment on ${issueKey} for ${evidence.specId}: ${msg}`;
    noteSink(reason);
    return { status: 'soft_failed', reason };
  }
}

function defaultNoteSink(projectRoot?: string): (note: string) => void {
  return (note: string) => {
    try {
      const dir = path.join(projectRoot ?? process.cwd(), '.specship');
      fs.mkdirSync(dir, { recursive: true });
      const line = `${new Date().toISOString()} ${note}\n`;
      fs.appendFileSync(path.join(dir, 'jira-notes.log'), line, 'utf8');
    } catch {
      /* the note sink itself must never throw — A3 */
    }
  };
}
