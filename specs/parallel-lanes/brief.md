---
slug: parallel-lanes
created: 2026-07-03
---

# Brainstorm: Parallel lanes — N Claude Code instances on one machine, one spec each

Parked idea (no spec yet). Product thesis: SpecShip's wedge is the solo dev,
and the 2026 solo dev is becoming an **orchestrator of N parallel agents**. The
unit of parallel work already exists in the product: **one spec = one
branch/worktree = one Claude Code instance = one "lane"**. SpecShip is uniquely
positioned to schedule this safely because it holds both the intent layer
(specs, links) and the code graph (impact radii) — it can compute *which specs
collide in code* and therefore which can run in parallel.

## Problem

Running 2+ Claude Code instances against the same local repo (separate specs,
separate branches/worktrees) breaks down today:

- **The index is one-tree.** `.specship/` holds nodes/edges for one working
  tree. A worktree either re-indexes from scratch (slow, duplicated DB,
  agent-asserted links stranded in a DB that dies with the worktree) or points
  at the main checkout's index and gets the issue-#155 mismatch warning — with
  explore/impact answers describing the wrong branch's code.
- **Spec state and code state are conflated in one DB.** Links, verification
  states, and the drift queue are global, but parallel branches mean N
  code-states. Lane A's refactor drifts a link lane B sees; after both merge,
  `nodeSigAtLink` snapshots match neither tree → spurious drift storm.
- **N instances = N watchers, N MCP servers, N `sync --quiet` hooks** racing
  one WAL SQLite file; N dashboards fighting for ports; N× the Linux inotify
  budget.
- **Gates don't scale past ~2 runs.** Workflow approvals are per-run CLI calls
  you must know to poll.

## Evidence (2026-07-03 dogfood)

The REQ-FUNNEL-007 `spec-implement` run (82f16a1e) hit every seam by hand:
worktree needed manual `npm ci` + `npm run build` so verify wouldn't
false-fail; the link step had to pass `projectPath` back to the main
checkout's index because the run worktree had no `.specship/`; every gate was
a one-off CLI approve found by polling.

## Proposed shape (three waves)

**Wave 1 — unblock 2–3 lanes (small, hits today's pain):**
- `specship lane new <SPEC_ID>` — one verb: branch + worktree + pointer
  `.specship/` (`{mainRepo, baseCommit}`) + prepared env (hardlinked
  `node_modules`, warm build) + prints the `claude` launch line. The
  spec-implement workflow's own worktrees use the same path.
- **Gate inbox** — `specship workflow gates` (+ dashboard inbox): all pending
  approvals across runs in one queue with plan/diff preview; the human becomes
  an approval multiplexer.

**Wave 2 — scale the substrate:**
- **One daemon per project, N clients** — a single index server (one watcher,
  one DB writer) all instances' MCP connections talk to over a local socket;
  hook stampede collapses into a debounced journal; one dashboard for all lanes.
- **Base + overlay indexing** — immutable base index keyed by commit + thin
  per-worktree overlay of changed files (mirrors git's shared object store).
  Lane sync indexes its diff, not the repo; retires the #155 warning.

**Wave 3 — the differentiator:**
- **Parallelization advisor** — take `authored` rows from the spec inventory
  (`specship_spec list: true`, REQ-FUNNEL-007), predict each spec's blast
  radius (implementations + impact + explore on spec terms), partition into
  non-overlapping lanes: "A, C, F are disjoint — parallelize; B and D collide
  on src/mcp/tools.ts — serialize."
- **Lane-aware link state + `specship land`** — assertions carry the lane
  (`implemented@feat/x`), promoted to shared truth at merge, where a
  reconciliation pass re-resolves snapshots against the merged tree and
  auto-heals moved-but-matching signatures; drift-push notices become
  lane-attributed.

## Non-goals

No cross-machine/team sync (stay local-first). No auto-scheduler dispatching
lanes without a human — the gates are the trust model. No per-instance config
identity — the spec is the identity; the lane inherits it.

## Metric

Merged-specs-per-day for one dev, with human touches per lane ≈ number of
gates and nothing else.

## Code grounding

- `src/mcp/tools.ts` — `detectWorktreeIndexMismatch` (#155): today's
  worktree→index mismatch warning; retired by base+overlay.
- `src/workflows/defaults/spec-implement.yaml` + worktree isolation under
  `~/.specship/worktrees/<hash>/<run>` — the existing lane-like mechanism,
  missing env prep and index routing.
- `src/resolution/spec-link-resolver.ts` — `nodeSigAtLink` snapshots + drift
  transitions (DRIFT-PUSH-DOC): where lane-aware states and merge
  reconciliation land.
- `src/bin/specship.ts` — `workflow approve/resume` CLI: the per-run gate
  surface the inbox generalizes.
- `src/index.ts` — `fileLock`/`indexMutex` + WAL: today's single-writer story
  the shared daemon replaces.
