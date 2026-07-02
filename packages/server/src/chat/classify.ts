/**
 * Deterministic intent classifier for the dashboard chat (REQ-DASH-CHAT-002).
 *
 * A **pure** rule-based router: given the raw message text it returns the intent
 * and the query to run — **no language model, no I/O, no `cg`** (A4). The chat
 * route feeds the result to a dispatcher (`answerForIntent` in
 * `../routes/chat-answer.ts`) that runs the matching knowledge-base query; this
 * module never touches the graph itself, so it is unit-testable in isolation.
 *
 * Routing order (first match wins, most specific first):
 *   1. **Slash commands** (A1) — `/ss-spec <ID>` → spec, `/ss-explore …` →
 *      explore, `/ss-check …` → drift (the launch set has no separate
 *      gate/health intent, so the check family routes to drift).
 *   2. **Free-form keyword/pattern** (A2 / A5) — regexes on the lowercased
 *      message pick callers / callees / impact / explore / drift / domain, or a
 *      bare spec-id token → spec.
 *   3. **Fallback** (A3) — `{ intent: 'search', confident: false }`. Never null,
 *      never a guessed intent: an unmatched message runs full-text search.
 *
 * The subject/query is derived with `extractSubject` (shared with the answer
 * core) so tokenization — slash-token stripping, stopword removal — is
 * identical to what the search path expects.
 */

import { extractSubject } from '../routes/chat-answer.js';

/** The 8 launch intents every message routes to (A5). */
export type ChatIntent =
  | 'spec'
  | 'explore'
  | 'callers'
  | 'callees'
  | 'impact'
  | 'drift'
  | 'domain'
  | 'search';

/** The deterministic classification of one message. Pure data, no I/O. */
export interface ClassifiedIntent {
  /** Which capability the message routes to. */
  intent: ChatIntent;
  /** The query/subject to run against the knowledge base. */
  query: string;
  /** The extracted subject symbol/term, when one was isolated. */
  subject?: string;
  /** True when a slash command or a keyword pattern matched; false on fallback. */
  confident: boolean;
  /**
   * Set when the message used a legacy `/ss-*` slash form that has been renamed
   * to the `/specship:*` namespace (CMD-NS-DOC, REQ-CMD-NS-005). The message
   * still routes normally; this carries the old + new forms so the answer layer
   * can nudge the user toward the canonical command.
   */
  deprecatedAlias?: { from: string; to: string };
}

/**
 * Slash-command → intent routing table (CMD-NS-DOC, REQ-CMD-NS-005). Each door
 * is reachable by three tokens: the canonical `/specship:*` namespace form, the
 * legacy flat `/ss-*` form (kept as a deprecation alias), and the bare verb.
 * The check family routes to `drift` — the launch set has no separate
 * gate/health intent. Keys are lowercased to match `cmd`.
 */
const SLASH_ROUTES: Record<string, ChatIntent> = {
  'specship:spec': 'spec', 'ss-spec': 'spec', spec: 'spec',
  'specship:explore': 'explore', 'ss-explore': 'explore', explore: 'explore',
  'specship:check': 'drift', 'ss-check': 'drift', check: 'drift',
};

/** Legacy `/ss-*` slash forms → the canonical `/specship:*` command they were renamed to. */
const RENAMED_SLASH: Record<string, string> = {
  'ss-spec': '/specship:spec',
  'ss-explore': '/specship:explore',
  'ss-check': '/specship:check',
};

/** A spec-id-shaped token — `REQ-DASH-CHAT-002`, `DOMAIN-LEDGER`, `DASH-CHAT-DOC`. */
const SPEC_ID = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/;

/**
 * Intent-signalling words that survive the shared `extractSubject` stopword
 * pass (which stays conservative so the generic search path doesn't drop real
 * symbol names). Stripped here — inside the classifier — so a routed query like
 * "impact of recordEntry" or "define Ledger" reduces to just its subject.
 */
const INTENT_WORDS = new Set([
  'impact', 'define', 'definition', 'flow', 'trace',
  'drift', 'drifted', 'drifting', 'drifts',
  'caller', 'callers', 'callee', 'callees',
]);

/** The extracted subject with intent-signalling words removed. */
function subjectOf(message: string): string {
  const { query } = extractSubject(message);
  return query
    .split(' ')
    .filter((t) => t.length > 0 && !INTENT_WORDS.has(t.toLowerCase()))
    .join(' ');
}

/**
 * Classify a chat message into an intent + query. Pure function of the text
 * (A4): identical input always yields identical output, and nothing here reads
 * a file, a database, or a model.
 */
export function classifyIntent(message: string): ClassifiedIntent {
  const msg = message.trim();
  const subject = subjectOf(msg);

  // --- 1. Slash commands (A1) ----------------------------------------------
  const slash = msg.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (slash) {
    const cmd = (slash[1] ?? '').toLowerCase();
    const rest = (slash[2] ?? '').trim();
    const routed = SLASH_ROUTES[cmd];
    if (routed) {
      const result: ClassifiedIntent = {
        intent: routed, query: rest, subject: rest || undefined, confident: true,
      };
      // Legacy `/ss-*` form → flag it so the answer nudges toward `/specship:*`.
      const renamedTo = RENAMED_SLASH[cmd];
      if (renamedTo) result.deprecatedAlias = { from: `/${cmd}`, to: renamedTo };
      return result;
    }
    // Unknown slash command → fall through to keyword matching on the subject
    // (extractSubject has already stripped the leading slash token).
  }

  const lower = msg.toLowerCase();
  const withSubject = (intent: ChatIntent): ClassifiedIntent => ({
    intent,
    query: subject,
    subject: subject || undefined,
    confident: true,
  });

  // --- 2. Free-form keyword / pattern (A2, A5) ------------------------------
  // "who calls X" / "what calls X" → callers.
  if (/\b(who|what)\s+calls\b/.test(lower)) return withSubject('callers');
  // "what does X call" / "callees of X" → callees (checked before explore so a
  // "call" phrasing never falls through to the generic how-does path).
  if (/\bwhat\s+does\b[\s\S]*\bcalls?\b/.test(lower) || /\bcallees?\b/.test(lower)) {
    return withSubject('callees');
  }
  // "what breaks if I change X" / "impact of X" → impact.
  if (/\bwhat\s+breaks\b/.test(lower) || /\bimpact\s+of\b/.test(lower) || /\bif\s+i\s+change\b/.test(lower)) {
    return withSubject('impact');
  }
  // "how does X work" / "the flow" / "trace X" → explore.
  if (/\bhow\s+does\b/.test(lower) || /\bflow\b/.test(lower) || /\btrace\b/.test(lower)) {
    return withSubject('explore');
  }
  // "what's drifted" / "drift" → drift queue (before domain so "what's drifted"
  // doesn't get read as a "what is …" definition lookup).
  if (/\bdrift(ed|ing|s)?\b/.test(lower)) return withSubject('drift');
  // "what is <term>" / "define X" → domain lookup.
  if (/\bwhat\s+is\b/.test(lower) || /\bwhat\s+are\b/.test(lower) || /\bdefine\b/.test(lower) || /\bdefinition\s+of\b/.test(lower)) {
    return withSubject('domain');
  }
  // A bare spec-id token (e.g. `REQ-DASH-CHAT-002`) → spec lookup for that id.
  const specId = msg.match(SPEC_ID);
  if (specId && specId[0]) {
    return { intent: 'spec', query: specId[0], subject: specId[0], confident: true };
  }

  // --- 3. Fallback (A3) — never null, never a guessed intent ----------------
  return { intent: 'search', query: subject, subject: subject || undefined, confident: false };
}
