#!/usr/bin/env bash
# SessionStart hook: print SpecShip usage tips to the user (systemMessage).
# Wired from .claude/settings.json → hooks.SessionStart. Edit the TIPS block
# below; it renders in the terminal UI at session start, not in Claude's context.
set -uo pipefail

# Load the tips into $msg without $()-command-substitution (which mis-parses
# apostrophes/backticks in a heredoc body). read -d '' returns non-zero at EOF.
IFS='' read -r -d '' msg <<'TIPS' || true
📦 SpecShip tips — code intelligence + spec-driven flow over the indexed graph

── The four doors (slash commands) ──────────────────────────────
• /specship:explore  — reads door. "how does X work / reach Y", blast radius.
• /specship:spec     — intent door. list · new · fast · design · implement ·
                       review · triage a spec. The spec is the contract.
• /specship:check    — gate & health door (see Drift/Health below).
• /specship:learn    — lessons door (see Lessons/Memory below).

── Explore before you Read/Grep ─────────────────────────────────
• specship_explore is PRIMARY: one capped call returns verbatim source grouped
  by file (Read-equivalent) — usually the only call you need.
• Flow: name both ends, e.g. "mutateElement renderScene" — it rides dynamic
  hops (callbacks, React re-render, JSX children) grep cannot follow.
• Locate → specship_search · one symbol/overloads → specship_node ·
  impact → specship_impact · callers/callees → specship_callers/_callees.

── JIRA (no "use specship" prefix needed) ───────────────────────
• "my JIRA issues" → specship_jira_issues · "show PROJ-123" → specship_jira_issue.
• "pick PROJ-123" → specship_jira_pick (authors a spec under specs/).
• "start it"      → specship_jira_start (runs spec-implement to the plan gate).
• "how is my JIRA going" → specship_jira_track (work-state × live JIRA status).
• "publish REQ-X to JIRA" → specship_jira_publish (Story + Sub-tasks per AC).

── Drift & health ───────────────────────────────────────────────
• /specship:check             — the enforcement gate (opt-in; advises by default).
• /specship:check drifted     — drifted / broken / orphaned spec↔code links.
• /specship:check fix <ID>    — repair a link (diagnose → approve → verify).
• /specship:check relink <ID> — re-point an orphaned link to the symbol's new home.
• /specship:check health      — code health (god files, cycles, oversized symbols).

── Lessons & memory ─────────────────────────────────────────────
• /specship:learn — crystallize what just worked into a reusable skill proposal
  (human-gated: review + apply from the dashboard's Improvements page).
• Auto-memory has four types — user · feedback · project · reference; durable
  facts persist across sessions and surface as background context.

── Verify (close the loop) ──────────────────────────────────────
• The gate runs the spec→test→verify behaviour chain; specship_link_verify
  drives a link back to "verified". Durable spec↔code links need an
  'implementations: path:Symbol' block in the spec, not a bare path.

• Index lags edits ~1s via the watcher; specship_status shows freshness + which
  SQLite backend is live. Read/Grep only to confirm what explore missed.
TIPS

if command -v jq >/dev/null 2>&1; then
  jq -n --arg m "$msg" '{systemMessage: $m}'
else
  # jq-less fallback: escape backslashes and quotes, join lines with literal \n.
  esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}')
  printf '{"systemMessage":"%s"}\n' "$esc"
fi
