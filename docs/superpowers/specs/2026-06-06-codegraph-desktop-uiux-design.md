# SpecShip Desktop — UI/UX Design Spec

**Status:** Draft for design handoff
**Owner:** Selvakumar Esra
**Last updated:** 2026-06-06

> This spec is the design brief, not the engineering plan. Use it to produce
> screen designs, component visuals, and interaction prototypes. A separate
> implementation plan covers schemas, APIs, and code organization. Pass this
> doc to a designer (or Claude Design) and ask for a polished design system +
> page comps. The wireframes here are content / hierarchy guides, not visual
> targets.

---

## 1. Product overview

**SpecShip Desktop** is a single-user Electron app that wraps the existing
SpecShip CLI/MCP server (a local code-and-spec knowledge graph) and pairs
it with two new surfaces:

- A **visual graph explorer** for code, specs, and the links between them.
- A **Claude Code analytics dashboard** that reads `~/.claude/projects/*.jsonl`
  transcripts and surfaces cost, tool usage, cache effectiveness, subagent
  attribution, project comparisons, and a rule-based tips engine.

The app is a companion to Claude Code, not a replacement: developers still
write code in their editor and chat with Claude Code in the terminal or the
in-app chat. SpecShip Desktop is where they **see** the structural picture
of their project and **understand** how their AI-assisted sessions are
spending money and time.

### Tagline candidates (pick or rephrase)

- "See your codebase. Understand your sessions."
- "The picture behind the prompts."
- "Spec → Code → Session — all in one view."

### Design goals

1. **Information density without overwhelm.** A senior engineer should be
   able to spot a wasteful pattern or a drifted spec in under five seconds
   on the dashboard. A non-coding spec author should be able to find a
   requirement and see whether it's implemented without reading code.
2. **The graph IS the product.** Most other tools relegate the graph to a
   side panel. Here, the visual graph is a first-class navigable surface
   used to enter every other view.
3. **No dashboards-for-dashboards' sake.** Every panel must directly drive
   an action: open a file, run a workflow, approve a step, fix a drift,
   reduce tool-call cost. Static "you used 1.2M tokens" cards without a
   suggested action are out of scope.
4. **Quiet by default, loud when it matters.** Most of the UI sits in a
   muted dark palette. Drift, broken links, and expensive prompts use
   saturated alerts. The user should be able to scan the whole app in a
   peripheral-vision pass and feel where the problems are.

### Out of scope (do not design)

- Multi-user accounts, login, billing, organizations.
- Slack/Discord/Telegram/GitHub adapters or notifications.
- A code editor pane. (We "Reveal in editor" to the user's existing editor.)
- A terminal pane.
- Mobile responsive layouts. Target window size 1280×800 minimum.
- A web-hosted version. Browser preview is for designers; runtime is Electron.

---

## 2. Personas

The product serves three personas, in priority order.

### P1 — The AI-assisted senior engineer (primary)

Writes code daily, runs Claude Code 4–20 hours a week, spends $50–$400/mo
on Anthropic API. Cares about: cost optimization, identifying wasteful
prompts, finding lurking quality issues (drifted specs, orphaned links),
fast structural navigation of unfamiliar code.

Visits the app 1–5 times per session. **Primary surfaces:** Dashboard,
Graph, Drift queue, Claude Code analytics. Chat is occasional ("quick
question with specship context" rather than primary workflow).

### P2 — The non-coding spec author (PM / domain lead)

Writes requirements in Markdown but does not edit code. Needs to verify
that the agent implemented what they specified, see what's drifted, kick
off a `spec-implement` workflow without remembering CLI syntax, review the
diff before merging.

Visits the app 1–3 times per requirement. **Primary surfaces:** Specs page,
Drift queue, Workflows, Runs, Chat (for natural-language follow-up).

### P3 — The team lead reviewing AI session economics

Periodic: weekly or monthly. Wants to see cost trends, which projects are
cost-efficient vs hungry, where subagents are spending budget, whether the
team's prompts cluster around wasteful patterns. Probably wants to share
findings or export a report.

Visits the app 1–2 times per week. **Primary surfaces:** Claude Code
analytics, especially the cross-project comparison view and the tips
engine output. Export-to-PDF / CSV is a P3 must-have.

---

## 3. Information architecture

Single sidebar nav, two groups, no nested submenus.

```
PROJECT
  Dashboard          /dashboard         (default route)
  Graph              /graph
  Specs              /specs
  Drift queue        /drift             (badge: count)
  Workflows          /workflows
  Runs               /runs              (badge: paused-awaiting-approval count)
  Chat               /chat

CLAUDE CODE
  Sessions           /claude/sessions
  Heatmap            /claude/heatmap
  Costs              /claude/costs
  Compare projects   /claude/compare
  Tips               /claude/tips       (badge: actionable-tip count)

SETTINGS              /settings         (icon button at bottom of sidebar)
```

The sidebar is **always visible**, fixed width, collapsible to icons only
when window < 1100px wide.

At the top of every page: a thin **status strip** showing current project
path · backend (better-sqlite3 / node:sqlite) · graph node count · drift
count · last index time. Reuses the structure of the existing
`specship status` CLI output but visual.

A **command palette** (Cmd/Ctrl+K) opens a global search:
- Find a node by name
- Find a spec by ID or title
- Run a workflow
- Jump to a route

---

## 4. Design system

### Mode

**Dark by default.** Light mode is a stretch goal — the primary persona
codes in dark IDEs and runs the app on a second monitor for ambient
awareness. Design dark first, light as a follow-up.

### Palette (semantic, not literal — pick exact hex)

| Token | Use | Suggested feel |
|---|---|---|
| `bg/canvas` | Main background | Near-black, slight blue tint (#0F1115-ish) |
| `bg/panel` | Cards, sidebars | One step lighter (#1A1D24-ish) |
| `bg/elevated` | Modals, dropdowns | Two steps lighter |
| `border/subtle` | Card edges | Low-contrast grey |
| `text/primary` | Headings, primary copy | Near-white |
| `text/secondary` | Body, labels | Mid-grey |
| `text/muted` | Captions, timestamps | Low-contrast grey |
| `accent/primary` | Buttons, links, focus rings | Blue (#2563EB-ish) |
| `accent/spec` | Spec entities, requirement nodes | Cool blue, distinct from primary |
| `accent/code` | Code nodes (functions, classes) | Purple |
| `accent/test` | Test/validation nodes | Green |
| `accent/route` | Route/endpoint nodes | Teal |
| `state/success` | Verified spec links | Green |
| `state/warn` | Drifted spec links, cache-opportunity tips | Amber |
| `state/error` | Broken links, orphaned links, expensive prompts | Red |
| `state/info` | Informational tips, idle states | Blue |

The five **node-color** tokens (`accent/*`) need to be **visually distinct
at 4px** so the graph remains parseable when zoomed out. Designer should
test this.

### Typography

- UI font: a clean modern sans (Inter, Geist, or system). One family.
- Mono font: JetBrains Mono / Fira Code / system mono. Used for: code
  blocks, file paths, qualified symbol names, tool names, model IDs.
- Two display sizes: 22px (page titles), 14px (everything else).
- Numeric tabular figures for cost columns and token counts.

### Density

Higher than a marketing site, lower than a trading terminal. Dashboard
cards: ~10px internal padding, 6px grid gap. List rows: 36–40px tall.
Sidebar items: 32px tall. Optimize for a senior engineer skimming, not for
touch screens.

### Motion

- Page transitions: instant. No fade. Snappy.
- Hovered elements: 100ms subtle background lift.
- Tips appearing: 200ms slide-in from the right.
- Workflow run status changes: pulse the status pill for 600ms once on change.
- Graph: smooth pan/zoom; node click animates the side panel open in 150ms.
- **Reduced motion** preference (OS-level) disables all of the above; instant transitions only.

### Iconography

Lucide (already an Archon dep). Pick a single icon for each major concept and
do not vary by context:

- Node (code symbol): `Box`
- Spec: `BookOpen`
- Drift: `AlertTriangle`
- Workflow: `Workflow`
- Run: `Play`
- Tool call: `Wrench`
- Cache: `Database`
- Subagent: `Bot`
- Project: `FolderTree`

### Empty / loading / error states

Every list page must specify these three.

- **Empty** is the most-designed state — usually the user's first impression.
- **Loading** uses a subtle skeleton (grey blocks matching the final layout) — no spinners.
- **Error** shows what failed + a concrete next action ("Run `specship init -i`", "Open settings"). No raw stack traces in the UI.

---

## 5. Key screens

The dashboard, graph view, and Claude Code surfaces are the load-bearing
designs. Specs, drift, workflows, runs reuse common list/detail patterns
and can be designed as a family.

### 5.1 Dashboard `/dashboard`

The home page. Default route. Designed to answer four questions in one
glance:

1. What's the structural state of my codebase right now? (graph stats)
2. What needs attention? (drift, broken links, expensive prompts)
3. What did my last session cost me? Was it efficient?
4. What should I do about it? (tips)

**Layout zones (top to bottom, left to right):**

- **Status strip** (entire width, ~28px): project path · backend · node/edge
  counts · drift count · last index time.
- **Stat tiles row** (4 across, ~70px tall): last-session cost · tool calls
  (7-day) · subagent spend % · drift queue count. Each tile is clickable
  and routes to its detail surface.
- **Center row, two columns:**
  - Left (2/3): **Mini graph preview** — the most recent 15–25 nodes
    around recently-edited files, rendered as a small interactive xyflow
    canvas. Click any node → routes to `/graph?focus=<id>`.
  - Right (1/3): **Tips panel** — 3–6 actionable tips ranked by impact
    (cost saved, drift severity). Each tip has a left-edge colored bar by
    severity, a one-line title, a one-line "what to do", and a "Apply"
    or "Dismiss" affordance.
- **Tool/file heatmap** (full width, ~80px): a strip of small cells, one
  per file, color-coded by how many tool calls touched it in the selected
  range. Hover shows the file path + counts.
- **Bottom row, two columns:**
  - Left: **Recent prompts** with cost — list of last 8–12 user prompts
    across the current project's sessions. Each row: truncated prompt
    text + cost + token count + cache hit %. Bar visualization makes
    expensive prompts visible at a glance.
  - Right: **Cache analytics** — one big number (cache read rate %), with
    breakdown beneath: creation tokens (with 1h/5m split), read tokens,
    estimated dollars saved this week, week-over-week delta.

**Range selector** (top-right, persistent): Today / This week / This month
/ All time. Affects every numeric panel on the page.

A working mockup of this layout is in
`.superpowers/brainstorm/<session>/content/dashboard-layout.html` —
use it as content/hierarchy reference, not as visual target.

### 5.2 Graph view `/graph`

The full-screen graph explorer. The most distinctive surface in the app.

**Layout:**

- **Top toolbar** (~44px): layout mode toggle (Hierarchical / Force) ·
  filter chips (language, node kind, spec link state, file path prefix) ·
  search box (fuzzy match on node names) · zoom controls · "Recenter".
- **Main canvas** (~85% of remaining height): xyflow + Dagre. Pannable,
  zoomable. Nodes are pills with the symbol name; spec nodes are
  rounded-rectangles with the spec ID. Edges are directed; dashed for
  synthesized (heuristic) edges, solid for tree-sitter extracted.
- **Right side panel** (~360px, resizable, collapsible): node detail.
  Empty state when no selection. Otherwise shows:
  - Node name, kind, language, file path:line
  - Signature (mono)
  - Linked specs (badge per link: state + drift axis)
  - Callers (top 10, click to navigate)
  - Callees (top 10, click to navigate)
  - "Reveal in editor" button
  - For spec nodes: body excerpt, parent doc, sibling reqs, linked code
    list with state, "Implement" / "Fix" / "Relink" workflow buttons.

**Node visual rules:**

- Code nodes (function, method, class, interface): **purple** family,
  pill shape, label inside.
- Spec nodes: **blue** family, slight rounded-rectangle shape (distinct
  silhouette from code nodes). Drifted/broken spec nodes get a colored
  outline (amber/red) and a small status dot.
- Route nodes: **teal** family, dot-shaped.
- Synthesized edges: dashed.
- Hover: subtle outline + tooltip with full qualified name.
- Selected: stronger outline + side panel opens.
- Hidden (filtered out): 20% opacity, still visible for context.

**Layout modes:**

- **Hierarchical** (Dagre, top-down): file → class → method → calls.
  Default for most queries. Compact, predictable.
- **Force-directed**: drag-to-position, exploratory. Used when the user
  wants to discover clusters.
- **Spec-anchored**: anchor a chosen spec in the center, fan out by
  `implements` / `tests` / `documents` edges. Triggered when entering
  graph view from a spec detail page.

**Search behavior:** Fuzzy match by symbol name as you type, no enter
required. Results appear as a dropdown below the search box. Selecting
one centers the camera on it with a smooth zoom-in.

**Performance budget:** Graphs up to 5,000 nodes should remain interactive
(pan/zoom < 16ms frame). Beyond that, lazy-render: only nodes in the
viewport + 1 hop neighbors. Designer doesn't need to design this, but
should not propose any layout that requires all nodes drawn at once.

### 5.3 Specs `/specs`

Browse and search the spec library.

- **Left rail** (~280px, resizable): tree of all spec documents grouped
  by source path. Each doc expands to show its requirements; requirements
  expand to show acceptance criteria. Drift/orphan badges next to each.
- **Right panel**: spec detail. Mirrors the structure of the spec MCP
  tool's output but visually:
  - Spec ID, title, kind, owner, priority
  - Parent / siblings / children navigation
  - Body (rendered Markdown)
  - "Linked code" list, each row: state pill · drift axis · target
    path:symbol · provenance badge · "Reveal" link
  - Quick-action buttons: "Implement" (kicks off `spec-implement`),
    "Verify" (kicks off `spec-verify`), "Edit spec" (opens source file
    in editor), "Show in graph" (routes to `/graph?focus=spec:<id>`)
- **Empty state** when no spec is selected: "Pick a spec from the tree,
  or run `specship init -i` to index your `specs/` folder if you
  haven't yet."

### 5.4 Drift queue `/drift`

Single-purpose page: review and resolve links that need attention.

- **Filter bar**: state (drifted / broken / orphaned, multi-select) ·
  drift axis (spec / code) · provenance.
- **List** (one row per link, virtual-scrolled for thousands of rows):
  state pill · spec ID · spec title · arrow icon · target path:symbol ·
  provenance · age. Click a row to expand inline with full link metadata
  and quick-action buttons.
- **Bulk actions** when multi-select: "Re-verify all", "Open all in editor"
- **Empty state** is celebratory — clean drift queue is a goal. Show a
  small reassuring graphic + "All ## links in good standing."

### 5.5 Workflows `/workflows` and Runs `/runs`, `/runs/:id`

Two related screens.

`/workflows`:

- **List of available workflows** (bundled + global + project tier,
  with scope badges).
- For each: name, description, tags, `requires:` capabilities, input
  schema preview.
- "Run" button per workflow opens an input modal asking for required
  inputs ($SPEC_ID, etc.), then launches and routes to `/runs/<runId>`.

`/runs`:

- **List of recent runs** with status pill, workflow name, duration,
  cost (if attributable via Claude session), worktree path.
- Filter by status (pending/running/paused/completed/failed/cancelled).

`/runs/:id`:

- **DAG visualizer** (top half, reusing the same xyflow infrastructure as
  the code graph) — shows the workflow nodes with state coloring:
  - pending: muted
  - running: animated outline (subtle pulse)
  - completed: green check overlay
  - failed: red x overlay
  - skipped: dotted outline
  - paused (awaiting approval): amber outline + pause icon
- **Bottom half**: tabbed panel
  - **Events tab**: live SSE stream of workflow events
    (`step_started`, `step_completed`, `tool_called`, `artifact_created`,
    `approval_requested`...) with timestamps. Auto-scrolls.
  - **Artifacts tab**: per-node typed artifacts (plan.md, diff.md,
    test_results.md, link_summary.md). Markdown-rendered.
  - **Cost tab**: if the run produced Claude Code transcript entries,
    show the per-node cost rollup.
- **Approval gate UI**: when a run is paused at an approval node, a
  prominent banner appears with the gate's message and three buttons:
  "Approve" / "Reject (with reason)" / "Inspect artifacts". Approving
  optionally captures a free-text comment that becomes the node's output.

### 5.6 Chat `/chat`

A specship-aware Claude Code companion chat.

- **Layout**: classic chat — message list (90%) + composer (10%). No
  Slack-style sidebar of conversations; this is per-project, single
  thread by default.
- **Composer**: textarea, "Attach" button (drag-and-drop files or spec
  IDs), "Run" button. Slash commands work inline (`/cg-spec REQ-AUTH-005`
  triggers a spec lookup, `/cg-implement REQ-AUTH-001` kicks off a
  workflow). Tab-completion for spec IDs and symbol names from the graph.
- **Messages**: user messages right-aligned (subtle), assistant messages
  left-aligned (richer). Tool calls inline-collapsed by default; click
  to expand with full input/output. Cost footer appears at the end of
  each assistant turn (small, muted).
- **Right side panel** (collapsible): "Context" — shows what specship
  state the chat agent has access to (current project, indexed file count,
  current drift queue summary). Lets the user toggle which MCP tools are
  available.
- **Settings inline**: model dropdown, tool-restriction mode toggle
  ("Ask first" / "Auto-allow safe" / "Auto-allow all").

### 5.7 Claude Code analytics surfaces

Five sub-pages, all read-only.

**Sessions `/claude/sessions`**

- Filter bar: project (multi-select), date range, model.
- Virtual-scrolled list: session ID prefix · project · started/ended ·
  prompts · cost · cache hit %. Sortable.
- Click a session → detail page with the prompt timeline, per-prompt cost,
  per-tool call counts, full thread.

**Heatmap `/claude/heatmap`**

- Range selector: today / week / month / custom.
- **Files heatmap** (grid): one cell per file, sized by file path length
  (more readable than a uniform grid). Color intensity = tool calls
  involving this file. Click → file detail with tool breakdown.
- **Tools heatmap** (separate panel): one bar per tool, length = total
  calls, color = total result tokens. Lets the user spot which tools
  return the most data.
- **Subagents heatmap**: identical UI to the tools heatmap but grouped
  by `isSidechain` attribution.

**Costs `/claude/costs`**

- Big number at top: total cost in selected range, with week-over-week
  delta.
- **Per-prompt cost ranking** (sortable list, top 50 most expensive):
  prompt text (truncated) · cost · token breakdown · model · cache hit %.
  Click to expand inline.
- **Per-day cost line chart**: simple line graph, 30 days, hover to see
  daily total + prompt count.
- **By-model breakdown** (donut or stacked bar): Opus vs Sonnet vs Haiku
  cost share.

**Compare projects `/claude/compare`**

- Multi-select project list at top (default: all projects).
- **Comparison table** (rows = projects, columns = metrics):
  total cost · session count · avg cost/session · cache hit rate ·
  Top 3 tools used · drift queue size (joined from SpecShip).
- **Stacked bar chart**: cost by model per project.
- **"Most efficient project" callout**: highlight the project with best
  cache hit rate and lowest avg cost/session.

**Tips `/claude/tips`**

- The expanded version of the dashboard's tips panel.
- Each tip is a card with:
  - Severity bar (error / warn / info)
  - Title (one sentence, action-oriented)
  - "Why this matters" (one short paragraph)
  - "Evidence" (concrete examples from the user's transcripts —
    e.g., a session ID + which files were read 17×)
  - "Fix" (the concrete next step, e.g. "Try `specship_explore` next
    time" with a copyable command)
  - "Dismiss" (with optional snooze: 1 day / 1 week / forever)
- Tips appear in **severity order** (errors first), within severity in
  **recency order**.

### 5.8 Settings `/settings`

Modal or page, designer's choice.

- **Project section**: project root path (read-only, set at app open),
  spec roots, watched directories, ignore patterns.
- **Claude Code section**: path to `~/.claude/projects/` (auto-detected,
  overridable), enable ingest (default on), enable transcript real-time
  watch.
- **Pricing table**: editable per-model Anthropic prices (so the user can
  bump rates when Anthropic publishes new tiers).
- **Appearance**: dark/light/system (light is stretch), font size,
  reduced motion.
- **Editor**: command to open files (default: detect via `code`/`subl`/etc.).
- **About**: version, MCP server status, current backend, log path.

---

## 6. Interaction patterns

### 6.1 Navigation between graph and detail surfaces

Clicking any node in any graph view (dashboard mini-graph, full graph
view, workflow run DAG) **never leaves the current page**. It opens a
panel on the right with the node's detail. To "go to" the dedicated
detail page (e.g., a spec's full page), there's an explicit "Open" link
in the panel.

This preserves the user's current view (graph layout, filters, zoom) so
they can return to exploration without losing context.

### 6.2 Quick actions on alerts

Every drift/broken/expensive-prompt alert has a one-click action embedded
in the card. The user should NEVER have to navigate three pages to fix
an issue surfaced on the dashboard.

- Drift alert: "Fix" button → kicks off `spec-fix` workflow with the
  spec ID pre-filled.
- Broken link: "Re-verify" button → runs `specship_link_verify` directly.
- Orphan: "Re-attach" button → opens the relink workflow with candidates
  pre-searched.
- Expensive prompt: "Show transcript" → opens the session detail view
  scrolled to that prompt.

### 6.3 Live data + SSE

Workflow run pages subscribe to `/api/workflows/runs/:id/events` via SSE.
Events stream in real time without polling. The UI must not flicker on
event arrival — append-only with smooth scroll-to-bottom (unless the user
has scrolled up, in which case show a "↓ new events" pill at the bottom).

Transcript ingest is *not* real-time in the UI — the dashboard refreshes
on a 30-second interval and on navigation. A manual "Refresh now" affordance
exists in the header.

### 6.4 Command palette (Cmd/Ctrl+K)

Global, always available. Fuzzy search across:
- Node names (returns graph view focused on the node)
- Spec IDs / titles (returns spec detail)
- Workflow names ("run spec-implement" creates a run)
- Page names ("dashboard", "drift")
- Recent prompts (jumps to session detail)

### 6.5 Multi-select on lists

Drift queue, workflow runs, sessions all support multi-select via
checkbox column. Bulk actions appear in a sticky bar at the top of the
selection.

### 6.6 Copy-friendly output

Any tip or alert that includes a CLI command must have a one-click "Copy"
button. Any node ID / spec ID has an inline copy-on-hover affordance.

### 6.7 Window menu and shortcuts (Electron)

Native menu bar items:
- File → Open project, Re-index, Settings, Quit
- View → Toggle sidebar, Toggle dark/light, Zoom in/out
- Graph → Recenter, Reset filters, Hierarchical/Force/Spec-anchored mode
- Workflows → Run last, Cancel all running
- Help → Documentation, About, Log path

Keyboard shortcuts (target the senior-engineer persona):
- Cmd/Ctrl+K: command palette
- Cmd/Ctrl+1..7: jump to sidebar items 1–7
- Cmd/Ctrl+F: focus search in current page
- G then G: jump to graph view
- G then S: jump to specs
- G then D: jump to drift
- Esc: close panels/modals

---

## 7. Component inventory (for design system)

The designer should produce a **design-system page** with these components,
in both light/dark, in their states (default, hover, focus, disabled,
loading, error).

### Primitives (reuse Radix as base)
- Button (primary, secondary, ghost, destructive — three sizes)
- Input (text, number, search)
- Select / dropdown
- Combobox (used for spec/node search)
- Toggle / Switch
- Checkbox
- Radio group
- Tabs
- Tooltip
- Popover
- Dialog / Modal
- Toast (transient notification)

### Composite
- **Stat tile** — label, big number, delta, optional sparkline
- **Tip card** — severity bar, title, body, action button, dismiss
- **Node detail card** (right-panel content) — title, signature, tags,
  linked-specs list, callers list, callees list, action buttons
- **Spec card** — used in spec tree rows + spec graph nodes; shows ID,
  title, state pill, drift axis
- **Workflow card** — used in workflow list; shows name, description,
  required inputs, run button
- **Run row** — workflow name, status pill, duration, runId prefix,
  artifact count
- **Prompt row** — truncated prompt text, cost, token count, cache hit %,
  timestamp
- **Tool-call inline-collapsed** (chat) — tool name + status, expands to
  show input + output

### Graph-specific
- **Graph canvas frame** (toolbar + canvas + right panel)
- **Node** (5 visual variants: code, spec, route, drifted-spec, orphaned)
- **Edge** (2 variants: solid extracted, dashed synthesized)
- **Layout mode toggle** (hierarchical / force / spec-anchored)
- **Filter chips** (multi-select with counts)
- **Zoom controls** (in / out / fit / reset)

### State pills (small, consistent shape across the app)
- pending, running, paused, completed, failed, cancelled (workflow runs)
- drafted, implementing, implemented, verified, drifted, broken, orphaned
  (spec links)
- success, warn, error, info (generic alerts)

### Charts (use one library — recharts or visx — pick later)
- Stat with delta + sparkline
- Time-series line (cost over time)
- Stacked bar (cost by model per project)
- Donut (cost share)
- Heatmap grid
- Heatmap strip

---

## 8. Accessibility

Designer target: WCAG 2.1 AA in dark mode. Specifically:

- **Color contrast**: every text/background pair ≥ 4.5:1. Don't lean on
  hue alone for state — pair color with shape or icon (e.g. drift = amber
  + warning triangle, not just amber).
- **Keyboard navigation**: every interactive element reachable via Tab.
  Focus rings clearly visible.
- **Screen reader**: every icon button has an `aria-label`. State pills
  announce their meaning (e.g. "Status: verified"). Live SSE updates
  use `aria-live="polite"`.
- **Reduced motion**: honor `prefers-reduced-motion` — disable hover lift,
  page transitions, pulse animations.
- **Zoom**: layout must remain functional at 200% browser zoom.

---

## 9. Responsive behavior

The app targets Electron desktop windows; no mobile, no tablet.

- **Minimum window**: 1280×800.
- **Comfortable window**: 1440×900–1920×1200.
- **Wide window (>1920)**: extra horizontal space goes to the graph canvas
  and the right detail panel; sidebar stays fixed width.
- **Narrow window (<1100)**: sidebar collapses to icons only; dashboard
  switches from 4-column stats to 2-column.

---

## 10. Voice and tone

- **Microcopy** is direct and slightly opinionated. Not chirpy. Not formal.
- Errors say what failed and what to do next. Never "Something went wrong."
- Tips engine reads like a senior teammate who reviewed your transcripts.
  Examples:
  - "You read `auth.ts` 17 times last session. Same answer via
    `specship_explore` in 1 call."
  - "Bash(grep) returned 82k tokens. `specship_search` covers this in 600."
  - "Cache miss rate on your evening sessions is 91%. Could be your
    system prompt drifts each turn. Worth pinning a stable prefix."

---

## 11. Non-goals for the designer

To save time, here is what NOT to design:

- A landing/marketing page. The app opens straight to the dashboard.
- An onboarding flow. The CLI handles first-time setup
  (`specship init -i`); the desktop app opens against an initialized
  project or shows a "no project initialized" empty state with a one-button
  init.
- A teams/collaboration view. Single user.
- Payment / subscription UI. There's nothing to pay for.
- A code diff viewer. We open the user's editor on "Reveal in editor."
- Export-to-PDF report templates. (Stretch goal, design later if needed.)

---

## 12. Open questions for the designer to surface

- Light mode: design in parallel or as a follow-up?
- Should the graph view be the default route instead of the dashboard?
  (Argument for: graph is the most distinctive feature. Argument against:
  dashboard answers "what should I do right now".) — Leaning dashboard.
- Should chat be a dedicated route or a slide-out panel available
  globally? — Leaning dedicated route for now; can fold into a global
  slide-out later.
- How aggressive should tips engine notifications be? Always-visible
  badge in sidebar vs only-on-tips-page? — Leaning sidebar badge for
  actionable tips, page for full list.
- Should the dashboard mini-graph default to "last edited files" or
  "drift queue neighborhood" or "specs without verified links"? — Pick
  one default + a small dropdown to change.

---

## 13. References

- Existing dashboard mockup: `.superpowers/brainstorm/<session>/content/dashboard-layout.html`
- Archon's web package (visual reference, mostly for the design-system
  rhythm + xyflow usage): `/Users/superdeveloper/dev/claude-projects/Archon/packages/web/src/`
- SpecShip CLI / MCP source for understanding entity semantics:
  `/Users/superdeveloper/dev/claude-projects/specship/src/`
- SpecShip CHANGELOG (Unreleased) for the spec/workflow/MCP surfaces
  that need a visual home: `/Users/superdeveloper/dev/claude-projects/specship/CHANGELOG.md`
- Claude Code JSONL transcript format (real samples on the user's machine):
  `~/.claude/projects/<project>/<sessionId>.jsonl`

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Node** | A code symbol (function, class, route) OR a spec entity (document, requirement, acceptance) |
| **Edge** | A directional relationship between nodes (calls, imports, implements, documents, validates, ...) |
| **Spec** | A user-written requirement carrying a stable embedded ID |
| **Spec link** | A persistent record connecting a spec to the code that implements/tests/documents/validates it, with state |
| **Drift** | A spec link whose underlying code or spec has changed since the link was set |
| **Workflow** | A YAML-defined DAG of agent / shell / approval steps the user can run |
| **Run** | One execution of a workflow, with its own isolated git worktree |
| **Session** | One uninterrupted Claude Code conversation, captured as a JSONL transcript |
| **Prompt** | One user turn within a session, identified by `promptId` |
| **Subagent** | A Claude sub-task invoked via the Task tool; identified by `isSidechain=true` in transcripts |
| **Cache hit** | Tokens charged at the cached rate (~10% of normal input) because the prompt prefix is the same as a recent prefix |

---

## Appendix B — Data shape primer (for the designer)

You don't need to read the JSONL spec, but it helps to know what the
underlying data looks like.

**Per-session record** the dashboard reads:
```
session_id, project_path, started_at, ended_at, prompt_count,
total_input_tokens, total_output_tokens, total_cache_creation_tokens,
total_cache_read_tokens, total_cost_usd
```

**Per-prompt record:**
```
prompt_id, session_id, text, timestamp,
input/output/cache_creation/cache_read tokens, cost_usd, is_sidechain
```

**Per-tool-call record:**
```
prompt_id, assistant_uuid, tool_name, input_summary (e.g. file path),
result_length (drives expensive-tool detection), timestamp
```

**Per spec / spec-link record:** see the existing SpecShip types in
`src/types.ts` (the designer can ignore TypeScript and just trust the
naming).

---

End of spec.
