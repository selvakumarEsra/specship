# MCP server module

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     MCP-specific guidance for src/mcp/. -->

## What this module is

The MCP server Claude Code talks to: tool definitions + handlers
(`tools.ts`), session/transport/daemon plumbing, model-tier context
(`model-context.ts`), and the `initialize` instructions.

## Non-negotiable invariants

- `server-instructions.ts` is the **single source of truth** for agent-facing
  tool guidance (issue #529). Edit tool guidance there and nowhere else — the
  installer no longer writes an instructions block into user CLAUDE.md files.
- **Keep BOTH explore budgets monotonic with repo size.** Two functions in
  `tools.ts` scale explore with indexed file count; a regression silently
  forces agents back to Read:
  - `getExploreBudget(fileCount)` → call budget: `<500→1, <5000→2,
    <15000→3, <25000→4, ≥25000→5` (max 5).
  - `getExploreOutputBudget(fileCount)` → per-call chars/files/per-file.
    **A larger tier must never get a smaller `maxCharsPerFile` than a
    smaller tier.** (The regression that motivated this: the `<5000` tier's
    2500 was below the `<500` tier's 3800, so on a god-file repo one explore
    returned <1% of the file and forced a Read.)
- Explore output must **never tell the agent to "use Read"** — steer to
  another `specship_explore` and "treat returned source as already Read."
- Tool *schemas* never vary by model tier (clients cache them; prompt caches
  key on them). Tool *lists* may vary, honoring MCP `listChanged`, and
  `execute()` must still answer a trimmed-away tool.

## Reference points (per-repo expected resolution)

| Repo | files | explore calls | chars/call | per-file |
|---|---|---|---|---|
| express (small) | 147 | 1 | 18K | 3800 |
| excalidraw/django (medium) | 643–3043 | 2 | 28K | 6500 |
| vscode (large) | 10446 | 3 | 35K | 7000 |
| ~20k / ~40k | — | 4 / 5 | 38K | 7000 |

## Conventions worth following

- **Adapt the tool to the agent — don't try to change the agent.** Before
  building a retrieval change, test: does it make a tool the agent *already
  calls* do more with the input it *already gives*? Steering via
  server-instructions/tool descriptions is low-salience and doesn't reliably
  move tool choice (validated: three wording variants regressed vs baseline);
  new tools get under-picked. What lands: richer output for `specship_explore`
  (the PRIMARY tool) and sufficiency in `specship_node` (full bodies, every
  overload in one call). Precise output needs precise input — fuzzy-input
  tools (`specship_context`, `specship_trace`) were removed for this reason.
- Model-tier behavior (compaction, haiku menu trim, numbered hops) lives in
  `model-context.ts` + `tools.ts` under MODCTX-DOC / LOWMODEL-DOC; every
  tier lever is gated on the eval harness's model arm.

## How to verify work is done

- `npx vitest run __tests__/explore-output-budget.test.ts __tests__/lowmodel.test.ts __tests__/model-context.test.ts __tests__/mcp-initialize.test.ts`
- Retrieval changes: the agent A/B bar in `scripts/agent-eval/CLAUDE.md`.
