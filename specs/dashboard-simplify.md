---
id: DASHSIMPLE-DOC
title: Simplified, agent-agnostic dashboard with a plan reader and a review queue
owner: dashboard
priority: high
version: 1
epicKey: SSHIP-635
jira: SSHIP-648
depends_on: [SPECSHIP-DESKTOP-DOC, DASH-LEAN-DOC]
jira_issue_REQ-DASHSIMPLE-001: SSHIP-636
jira_fingerprint_REQ-DASHSIMPLE-001: f3efde74f08d0341
jira_issue_REQ-DASHSIMPLE-002: SSHIP-643
jira_fingerprint_REQ-DASHSIMPLE-002: 31a71a65eb3f3d34
jira_issue_REQ-DASHSIMPLE-003: SSHIP-648
jira_fingerprint_REQ-DASHSIMPLE-003: b34ef463858aac49
jira_issue_REQ-DASHSIMPLE-004: SSHIP-655
jira_fingerprint_REQ-DASHSIMPLE-004: 238b5dc23b91446a
jira_issue_REQ-DASHSIMPLE-005: SSHIP-663
jira_fingerprint_REQ-DASHSIMPLE-005: 1967ad1034c0dbbf
---

<!-- id: DASHSIMPLE-DOC -->
# Simplified, agent-agnostic dashboard with a plan reader and a review queue

The dashboard has grown to sixteen screens. Seven of them (Sessions, Heatmap,
Costs, Compare projects, Memory, MCP, Tips) are built from one coding agent's
transcripts, and the two things a user most needs, the plan and the review
queue, are spread across Specs, Traceability and the Drift queue.

This document cuts the dashboard down to data every coding agent produces:
specs, their links to code, drift, the code graph and workflow runs. It adds
three things:

- a **plan reader** that shows epic → story → task the way a browser's reading
  mode shows an article;
- a **review queue** that sorts every requirement into completed, pending or
  drifted;
- a **split spec/code view** that makes the code graph searchable and
  navigable.

**Constraints.** The UI's runtime dependencies stay exactly `react` and
`react-dom`, and the dependency check (`scripts/check-ui-deps.mjs`) keeps
passing (DASH-LEAN-DOC). No screen, label or data source may name or assume a
specific coding agent (house rule: shared code is agent-agnostic).

**Non-goals.** Live JIRA status or any JIRA write from the dashboard; editing
specs or code in the dashboard (it stays read-only, DASH-LEAN-DOC); new graph
analytics; and deleting the transcript-ingest server routes (their removal is
separate cleanup work).

**Test plan.** Component tests in `ui/src/__tests__/` render each screen
against fixture API responses, following the `overview.test.tsx` /
`review.test.tsx` pattern. Server tests cover any new or changed endpoint. The
existing `check-ui-deps` build step covers the dependency constraint.

<!-- id: REQ-DASHSIMPLE-001 -->
## The navigation MUST show only agent-agnostic screens

The sidebar MUST contain exactly these screens: Overview, Plan, Review, Graph,
Traceability and Runs, with Settings and Design system pinned at the bottom.
Workflows stays reachable from Runs. The agent-specific group (Sessions,
Heatmap, Costs, Compare projects, Memory, MCP, Tips) is removed from the
sidebar and the command palette. Its old routes, and the old Specs and Drift
queue routes, MUST redirect so existing deep links still land somewhere
useful. No sidebar label, badge or screen title may name a coding agent. This
supersedes the sidebar layout fixed by REQ-DESKTOP-018.

implementations:
  - ui/src/App.tsx:App
  - ui/src/App.tsx:NAV
  - ui/src/App.tsx:PALETTE_PAGES
  - ui/src/router.ts:resolveRedirect
  - ui/src/router.ts:parse
  - ui/src/components/command-palette.tsx:CommandPalette
  - ui/src/pages/settings.tsx:SettingsPage

verifies:
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A1
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A2
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A3
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A4
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A5
  - __tests__/ui-build-guard.test.ts:reqDashsimple001A6
  - ui/src/__tests__/navigation.test.tsx:reqDashsimple001A7

## Acceptance
<!-- id: REQ-DASHSIMPLE-001.A1 -->
- The rendered sidebar lists Overview, Plan, Review, Graph, Traceability and
  Runs, then Settings and Design system, and nothing else.
<!-- id: REQ-DASHSIMPLE-001.A2 -->
- Navigating to `/sessions`, `/heatmap`, `/costs`, `/compare`, `/memory`,
  `/mcp` or `/tips` lands on Overview. Navigating to `/specs` or `/drift`
  lands on Review, and `/specs/<id>` lands on that requirement in Review.
<!-- id: REQ-DASHSIMPLE-001.A3 -->
- The command palette offers no removed screen.
<!-- id: REQ-DASHSIMPLE-001.A4 -->
- No rendered sidebar, palette or screen-title text contains "Claude",
  "Gemini", "Codex" or any other agent name.
<!-- id: REQ-DASHSIMPLE-001.A5 -->
- `specs/specship-desktop.md` carries a dated SUPERSEDED note on
  REQ-DESKTOP-018 naming REQ-DASHSIMPLE-001.
<!-- id: REQ-DASHSIMPLE-001.A6 -->
- The UI build's dependency check still passes with runtime dependencies
  exactly `react` and `react-dom`.
<!-- id: REQ-DASHSIMPLE-001.A7 -->
- No screen anywhere in the dashboard, including Settings, has a section,
  label or control named after a coding agent. The agent-specific transcript
  ingest setting is not offered in the UI.

<!-- id: REQ-DASHSIMPLE-002 -->
## The Overview MUST summarise the project in one screen of agent-agnostic facts

Overview replaces the current Dashboard screen. It MUST show, without
scrolling on a 1280×800 viewport:

- the completed, pending and drifted requirement counts as defined by
  REQ-DASHSIMPLE-004, each opening Review filtered to that group;
- index freshness;
- the five most recent workflow runs, with status and the agent each ran on.

It MUST NOT show token, cost, session or transcript-derived figures. When the
project has no specs, it shows a single clear next step instead of empty
charts.

implementations:
  - ui/src/pages/dashboard.tsx:DashboardPage
  - ui/src/pages/dashboard.tsx:useOverviewData
  - ui/src/pages/dashboard.tsx:OverviewCounts
  - ui/src/pages/dashboard.tsx:IndexFreshness
  - ui/src/pages/dashboard.tsx:RecentRuns
  - ui/src/pages/dashboard.tsx:OverviewEmpty
  - ui/src/api.ts:runAgentName

verifies:
  - ui/src/__tests__/overview.test.tsx:reqDashsimple002A1
  - ui/src/__tests__/overview.test.tsx:reqDashsimple002A2
  - ui/src/__tests__/overview.test.tsx:reqDashsimple002A3
  - ui/src/__tests__/overview.test.tsx:reqDashsimple002A4

## Acceptance
<!-- id: REQ-DASHSIMPLE-002.A1 -->
- With fixture data, Overview shows the three requirement counts matching
  Review's groups, and clicking a count opens Review filtered to that group.
<!-- id: REQ-DASHSIMPLE-002.A2 -->
- Overview shows index freshness and at most five recent runs, each with its
  status and agent name as recorded on the run.
<!-- id: REQ-DASHSIMPLE-002.A3 -->
- No token, cost, session or transcript value is rendered, and Overview makes
  no request to a transcript or cost endpoint.
<!-- id: REQ-DASHSIMPLE-002.A4 -->
- A project with zero specs shows one next-step message naming how to author a
  spec, and no empty charts.

<!-- id: REQ-DASHSIMPLE-003 -->
## The Plan screen MUST present epic → story → task as a distraction-free reader

Plan MUST render the project's work as a single readable column, like a
browser's reading mode. That means comfortable line length, document
typography, no side panels, and no chrome besides a level toggle and a filter.
The hierarchy comes from the spec files alone:

- **Epic:** a spec document's `epicKey`. Documents with no `epicKey` group
  under their own title, so a repo without JIRA still reads correctly.
- **Story:** each requirement, with its title, body and status.
- **Task:** each acceptance criterion, with its text and test-evidence state.

A JIRA key known from frontmatter (`epicKey`, `jira_issue_<REQ>`) is shown and
links to the issue when a JIRA base URL is configured, and is plain text
otherwise. Levels expand and collapse, and a story or task deep-links to its
place in Review.

implementations:
  - server/src/routes/spec.ts:buildPlan
  - server/src/routes/spec.ts:readJiraBaseUrl
  - ui/src/pages/plan.tsx:PlanPage
  - ui/src/pages/plan.tsx:PlanReader
  - ui/src/pages/plan.tsx:JiraKey
  - ui/src/pages/plan.tsx:storyStatus
  - ui/src/pages/plan.tsx:filterEpics
  - ui/src/pages/plan.tsx:EpicSection
  - ui/src/pages/plan.tsx:StorySection
  - ui/src/pages/plan.tsx:TaskItem
  - ui/src/pages/plan.tsx:reviewHref
  - ui/src/prefs.ts:getPlanLevel
  - ui/src/prefs.ts:setPlanLevel

verifies:
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A1
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A2
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A3
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A4
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A5
  - ui/src/__tests__/plan.test.tsx:reqDashsimple003A6

## Acceptance
<!-- id: REQ-DASHSIMPLE-003.A1 -->
- A fixture with two documents sharing `epicKey: SSHIP-600` renders one epic
  heading containing both documents' requirements as stories, in file order.
<!-- id: REQ-DASHSIMPLE-003.A2 -->
- Each story lists its acceptance criteria as tasks, with each task's
  test-evidence state (untested, tested, verified or broken).
<!-- id: REQ-DASHSIMPLE-003.A3 -->
- A document with no `epicKey` renders as its own top-level group titled after
  the document.
<!-- id: REQ-DASHSIMPLE-003.A4 -->
- A story's `jira_issue_<REQ>` key renders as a link when a JIRA base URL is
  configured, and as plain text when not. No JIRA network request is made.
<!-- id: REQ-DASHSIMPLE-003.A5 -->
- The reader column's width is capped for readability (no wider than about 75
  characters of body text), with no sidebar panels inside the reading area.
<!-- id: REQ-DASHSIMPLE-003.A6 -->
- Collapsing to "epics only", "epics + stories" and "everything" changes the
  rendered depth, and the choice survives a reload.
<!-- id: REQ-DASHSIMPLE-003.A7 -->
- A story's body renders as readable prose only. Its `implementations:` and
  `verifies:` blocks, `## Acceptance` heading and `<!-- id: … -->` markers
  never appear as text; acceptance criteria appear only as the story's tasks.

<!-- id: REQ-DASHSIMPLE-004 -->
## The Review screen MUST sort every requirement into completed, pending or drifted

Review replaces the Specs and Drift queue screens. It MUST place every
requirement in exactly one group:

- **Drifted:** any link is `drifted`, `broken` or `orphaned`. This group wins
  over the other two.
- **Completed:** not drifted, and every acceptance criterion's test-evidence
  verdict is `verified`. This comes from `tests` links, the same verdict as the
  coverage rollup. It does **not** come from code links, which stay
  `implemented` even when proven.
- **Pending:** everything else, tagged as unimplemented, implemented but
  unverified, or partly verified.

Each row shows the requirement ID, title and the reason for its group. A
drifted row says which link drifted and what changed (spec, code or test), and
names the command that fixes it. Opening a row shows the requirement's full
text and links.

implementations:
  - ui/src/review-groups.ts:classifyRequirement
  - ui/src/review-groups.ts:groupRequirements
  - ui/src/review-groups.ts:fixCommand
  - ui/src/review-groups.ts:driftReason
  - ui/src/pages/review.tsx:ReviewPage
  - ui/src/pages/dashboard.tsx:DashboardPage
  - ui/src/components/graph-rail.tsx:GraphDetailRail

verifies:
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A1
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A2
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A3
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A4
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A5
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A6
  - ui/src/__tests__/review.test.tsx:reqDashsimple004A7

## Acceptance
<!-- id: REQ-DASHSIMPLE-004.A1 -->
- With fixture data, every requirement appears in exactly one of the three
  groups, and the group counts add up to the total number of requirements.
<!-- id: REQ-DASHSIMPLE-004.A2 -->
- A requirement whose code links are `implemented` and whose every acceptance
  criterion has a `verified` test link is Completed.
<!-- id: REQ-DASHSIMPLE-004.A3 -->
- A requirement with one `orphaned` link is Drifted even if all its criteria
  are verified, and its row names the orphaned target and the fix command.
<!-- id: REQ-DASHSIMPLE-004.A4 -->
- A requirement with code but an untested criterion is Pending, tagged
  "implemented, unverified".
<!-- id: REQ-DASHSIMPLE-004.A5 -->
- Filtering by group (from the tabs or from an Overview count) shows only that
  group, and the filter is in the URL.
<!-- id: REQ-DASHSIMPLE-004.A6 -->
- A requirement with no acceptance criteria is never Completed. It is Pending,
  tagged "no acceptance criteria".
<!-- id: REQ-DASHSIMPLE-004.A7 -->
- When the spec or link data fails to load, Review shows an error with a retry
  control, not three empty groups.
<!-- id: REQ-DASHSIMPLE-004.A8 -->
- With requirements indexed and none selected, the detail panel invites
  picking a requirement and does not suggest indexing or initialising specs.

<!-- id: REQ-DASHSIMPLE-005 -->
## Searching the code graph MUST show the spec on the left and its code on the right

Graph MUST offer one search box over specs and code symbols. Selecting a
result opens a split view:

- **A requirement:** its text on the left and the verbatim source of every
  linked symbol on the right.
- **A code symbol:** its source on the right and every requirement linked to
  it on the left.

From the code side the user MUST be able to step to the symbol's callers and
callees, with the left side updating to their linked specs. Back and forward
retrace these steps, and every view has a shareable URL. An unlinked symbol
shows its code with "no linked requirement" on the left.

implementations:
  - ui/src/pages/graph.tsx:GraphPage
  - ui/src/components/graph-split.tsx:SplitView
  - ui/src/components/graph-split.tsx:SplitSearch
  - server/src/routes/graph.ts:registerGraphRoutes
  - ui/src/api.ts:api

verifies:
  - ui/src/__tests__/graph-split.test.tsx:reqDashsimple005A1
  - ui/src/__tests__/graph-split.test.tsx:reqDashsimple005A2
  - ui/src/__tests__/graph-split.test.tsx:reqDashsimple005A3
  - ui/src/__tests__/graph-split.test.tsx:reqDashsimple005A4
  - ui/src/__tests__/graph-split.test.tsx:reqDashsimple005A5

## Acceptance
<!-- id: REQ-DASHSIMPLE-005.A1 -->
- Searching a requirement ID and selecting it shows its text on the left and
  each linked symbol's source on the right.
<!-- id: REQ-DASHSIMPLE-005.A2 -->
- Searching a function name and selecting it shows its source on the right and
  its linked requirements on the left.
<!-- id: REQ-DASHSIMPLE-005.A3 -->
- Clicking a callee moves the right side to that symbol and updates the left
  side to its requirements. Browser Back returns to the previous pair.
<!-- id: REQ-DASHSIMPLE-005.A4 -->
- Reloading the page at a split-view URL restores the same pair.
<!-- id: REQ-DASHSIMPLE-005.A5 -->
- A symbol with no linked requirement shows its source and "no linked
  requirement", not an error.

<!-- id: REQ-DASHSIMPLE-005.A6 -->
- The requirement shown in the split view renders as readable prose, with the
  same rules as REQ-DASHSIMPLE-003.A7: no link blocks, acceptance heading or
  id markers as text.