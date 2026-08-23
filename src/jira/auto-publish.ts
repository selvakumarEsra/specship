/**
 * Auto-publish specs to JIRA on sync (REQ-JIRATEAM-002).
 *
 * With a repo-committed JIRA project binding in `specship.config.json`
 * (REQ-JIRATEAM-001), every cleanly-indexed requirement spec is
 * published/refreshed to JIRA during `sync` — reusing the existing
 * idempotent `publishSpecToJira` primitive so the fingerprint short-circuits
 * unchanged specs, missing Sub-tasks are added, and `writeBackJiraIdentity`
 * stamps the `jira_issue:` back into the file.
 *
 * A5 gate: with NO binding, this returns immediately without constructing a
 * JIRA client or reading credentials — zero JIRA calls. Even with a binding,
 * a repo whose user has no credentials configured degrades to a single
 * per-sync note (never crashes, never blocks sync). Per-spec publish failures
 * are collected as `failed` results; siblings still publish.
 */

import * as path from 'path';
import { resolveJiraCredentials } from './config';
import { bindingIssueTypes, loadRepoJiraBinding } from './repo-config';
import { JiraClient } from './client';
import {
  buildIssueFields,
  issueContentFingerprint,
  publishSpecToJira,
  perSpecFrontmatterKeys,
  readFrontmatterValue,
  writeBackJiraIdentity,
  type PublishJiraClient,
  type SpecPublishSource,
} from './publish';
import { readSpecJiraKey } from './spec-writer';
import { postMilestoneComment, type MilestoneJiraClient } from './milestone-comment';
import * as fs from 'fs';

export type AutoPublishStatus = 'published' | 'unchanged' | 'opted_out' | 'failed';

export interface AutoPublishResultRow {
  specId: string;
  status: AutoPublishStatus;
  jiraKey?: string;
  subtasksCreated?: number;
  note?: string;
}

export interface AutoPublishReport {
  /**
   * Present when the pass short-circuited before touching JIRA:
   *   - 'unbound'         → no repo binding (A5)
   *   - 'no-credentials'  → binding present but user credentials missing (A4-like)
   */
  skipped?: 'unbound' | 'no-credentials';
  /** Human-readable note when `skipped` is set (surfaced by the caller). */
  note?: string;
  results: AutoPublishResultRow[];
}

/** The structural slice of SpecQueries this pass reads. */
export interface AutoPublishSpecQueries {
  getAllSpecs(): Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    sourcePath: string;
  }>;
  getSpecsByParent(id: string): Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
  }>;
}

export interface AutoPublishDeps {
  specQueries: AutoPublishSpecQueries;
  projectRoot: string;
  /** Test seam: build a JIRA client from resolved creds. Default: JiraClient. */
  makeClient?: (creds: ReturnType<typeof resolveJiraCredentials>) => PublishJiraClient;
}

/**
 * Publish/refresh every requirement spec to JIRA when a repo binding is
 * present. Never throws — every failure lands in the returned report.
 */
export async function autoPublishSpecsOnSync(
  deps: AutoPublishDeps,
): Promise<AutoPublishReport> {
  // A5: no repo binding → do NOTHING. No client construction, no credential
  // read, no JIRA call.
  const binding = loadRepoJiraBinding(deps.projectRoot);
  if (!binding.binding) {
    return { skipped: 'unbound', results: [] };
  }

  // Bound repo without user credentials: one per-sync note, never a crash.
  let creds: ReturnType<typeof resolveJiraCredentials>;
  try {
    creds = resolveJiraCredentials(deps.projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      skipped: 'no-credentials',
      note: msg,
      results: [],
    };
  }

  const projectKey = creds.project;
  if (!projectKey) {
    return {
      skipped: 'no-credentials',
      note: 'No JIRA project resolved from binding or user config.',
      results: [],
    };
  }

  const client: PublishJiraClient = deps.makeClient
    ? deps.makeClient(creds)
    : (new JiraClient(creds) as unknown as PublishJiraClient);

  const results: AutoPublishResultRow[] = [];
  const requirements = deps.specQueries.getAllSpecs().filter(
    (s) => s.kind === 'requirement',
  );

  // Requirements per file (REQ-JIRATEAM-010): a file holding >1 requirement
  // keys each one's JIRA identity per-requirement — the plain file-level
  // `jira_issue:` is only trusted when the file has exactly one.
  const reqsPerFile = new Map<string, number>();
  for (const s of requirements) {
    reqsPerFile.set(s.sourcePath, (reqsPerFile.get(s.sourcePath) ?? 0) + 1);
  }

  for (const spec of requirements) {
    const absPath = path.isAbsolute(spec.sourcePath)
      ? spec.sourcePath
      : path.join(deps.projectRoot, spec.sourcePath);

    // Per-spec frontmatter opt-out (A3). Note: readFrontmatterValue reads
    // the file's leading frontmatter block only — a `jira_publish:` mention
    // in the body cannot opt a spec out.
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(absPath, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ specId: spec.id, status: 'failed', note: msg });
      continue;
    }
    const optOut = readFrontmatterValue(fileContent, 'jira_publish');
    if (optOut !== null && optOut.toLowerCase() === 'false') {
      results.push({ specId: spec.id, status: 'opted_out' });
      continue;
    }

    const acceptance = deps.specQueries
      .getSpecsByParent(spec.id)
      .filter((c) => c.kind === 'acceptance')
      .map((c) => ({ id: c.id, text: (c.title || c.body || '').trim() }))
      .filter((c) => c.text.length > 0);

    const source: SpecPublishSource = {
      specId: spec.id,
      title: spec.title,
      body: spec.body ?? '',
      specRelPath: spec.sourcePath,
      acceptance,
    };

    // REQ-JIRATEAM-010.A4: never resolve another requirement's issue. The
    // per-requirement key wins; the plain file-level key applies only when
    // this requirement is the file's sole one.
    const soleRequirement = (reqsPerFile.get(spec.sourcePath) ?? 1) === 1;
    const perKeys = perSpecFrontmatterKeys(spec.id);
    const existingKey =
      readFrontmatterValue(fileContent, perKeys.issueKey) ??
      (soleRequirement ? readSpecJiraKey(absPath) : null);
    // REQ-JIRATEAM-006: resolve the epic anchor — frontmatter first, then
    // the binding default. `requireEpic` is off here so a bound repo whose
    // spec pre-dates board-first intake doesn't hard-fail on every sync;
    // the intake gate is what fences new specs. A refresh with no epic and
    // no live parent still publishes unchanged Story text.
    const specEpicKey =
      readFrontmatterValue(fileContent, 'epicKey') ??
      binding.binding.epicKey ??
      undefined;

    // Fingerprint short-circuit (A1): an already-published spec whose
    // rendered Story fields match the last-published fingerprint performs
    // ZERO JIRA writes — no updateIssue, no getIssue, no Sub-task probe.
    if (existingKey) {
      const priorFp =
        readFrontmatterValue(fileContent, perKeys.fingerprintKey) ??
        (soleRequirement
          ? readFrontmatterValue(fileContent, 'jira_fingerprint')
          : null);
      if (priorFp) {
        const fields = buildIssueFields(source);
        const nextFp = issueContentFingerprint(fields.summary, fields.description);
        if (priorFp === nextFp) {
          results.push({
            specId: spec.id,
            status: 'unchanged',
            jiraKey: existingKey,
            subtasksCreated: 0,
          });
          continue;
        }
      }
    }

    try {
      const result = await publishSpecToJira(
        client,
        source,
        {
          projectKey,
          // REQ-JIRATEAM-009: honor the binding's issue-type overrides — a
          // team-managed project without a `Story` type publishes as `Task`.
          ...bindingIssueTypes(deps.projectRoot),
          ...(specEpicKey ? { epicKey: specEpicKey } : {}),
        },
        existingKey,
      );
      // Frontmatter write-back stamps jira_issue: and the fingerprint. Never
      // re-id or rename here — auto-publish runs on every sync and must be
      // safe on files that already carry links or share a file with siblings.
      writeBackJiraIdentity(absPath, result.key, {
        fingerprint: result.fingerprint,
        reId: null,
        renameTo: null,
        ...(result.epicKey ? { epicKey: result.epicKey } : {}),
        // REQ-JIRATEAM-010.A2: per-requirement keys in multi-REQ files.
        ...(soleRequirement ? {} : { forSpecId: spec.id }),
      });
      const status: AutoPublishStatus =
        result.created || result.subtasksCreated > 0 ? 'published' : 'unchanged';
      results.push({
        specId: spec.id,
        status,
        jiraKey: result.key,
        subtasksCreated: result.subtasksCreated,
      });
      // Milestone: spec_published (REQ-JIRATEAM-003.A1). Idempotent — the
      // dispatcher itself skips when the marker already exists, so calling
      // it on every publish (including refresh) is safe. Soft-fail so a
      // milestone comment issue never breaks auto-publish (A3).
      if (status === 'published') {
        await postMilestoneOnSuccess(client, result.key, spec.id, deps.projectRoot);
      }
    } catch (err) {
      // A4: one spec's failure never blocks the sync or its siblings.
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ specId: spec.id, status: 'failed', note: msg });
    }
  }

  return { results };
}

/**
 * Best-effort spec_published milestone comment. A fake `PublishJiraClient`
 * (some tests) doesn't implement the milestone methods — probe first and
 * silently skip when they're missing, so test seams stay narrow.
 */
async function postMilestoneOnSuccess(
  client: PublishJiraClient,
  issueKey: string,
  specId: string,
  projectRoot: string,
): Promise<void> {
  const maybe = client as unknown as Partial<MilestoneJiraClient>;
  if (
    typeof maybe.listCommentsDetailed !== 'function' ||
    typeof maybe.addComment !== 'function' ||
    typeof maybe.updateComment !== 'function'
  ) {
    return;
  }
  await postMilestoneComment(
    maybe as MilestoneJiraClient,
    issueKey,
    'spec_published',
    { specId },
    { projectRoot },
  );
}

/** One-line summary suitable for CLI output. */
export function summarizeAutoPublishReport(report: AutoPublishReport): string {
  if (report.skipped === 'unbound') return '';
  if (report.skipped === 'no-credentials') {
    return `JIRA auto-publish skipped: ${report.note ?? 'no credentials'}`;
  }
  let published = 0;
  let unchanged = 0;
  let optedOut = 0;
  let failed = 0;
  for (const r of report.results) {
    if (r.status === 'published') published++;
    else if (r.status === 'unchanged') unchanged++;
    else if (r.status === 'opted_out') optedOut++;
    else if (r.status === 'failed') failed++;
  }
  return (
    `JIRA auto-publish: ${published} published, ${unchanged} unchanged, ` +
    `${optedOut} opted out, ${failed} failed`
  );
}
