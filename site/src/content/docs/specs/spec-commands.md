---
title: Spec commands
description: The /specship:spec intent door and the /specship:check gate door — every sub-command for capturing, authoring, implementing, testing, and repairing specs from inside Claude Code.
---

Two slash commands cover the whole spec lifecycle in Claude Code. Both are installed by default with `specship install` (pass `--no-sdd` for a retrieval-only install).

- **`/specship:spec`** — the *intent* door: capture, author, implement, review, and test.
- **`/specship:check`** — the *gate* door: run the enforcement gate and repair links.

## `/specship:spec` — the intent door

| Invocation | What it does |
|---|---|
| `/specship:spec` | The lifecycle funnel: ideas → specs → implemented. |
| `/specship:spec <SPEC_ID>` | That spec's body, parent and siblings, and linked code with state — in one call. |
| `/specship:spec idea <one-liner>` | Park an idea as a brief and return to your work. No questions asked. |
| `/specship:spec ideas` | Review parked ideas — ID, title, age, labels. |
| `/specship:spec list` | Flat inventory: every brief and requirement with one rolled-up status (`authored`, `in-progress`, `implemented`, `verified`, `needs-attention`) and per-status totals. |
| `/specship:spec new <description>` | The full authoring loop — ground, explore approaches, write on confirmation. `new brief:<slug>` promotes a parked idea. |
| `/specship:spec fast <description>` | The fast path — two questions, then a complete draft. |
| `/specship:spec design <URL or intent>` | Author from a Claude Design or Figma design, or run a design taste loop first. |
| `/specship:spec implement <SPEC_ID>` | Run the `spec-implement` workflow in an isolated worktree. |
| `/specship:spec review <SPEC_ID>` | Read-only rubric review — no edits. |
| `/specship:spec triage <prompt>` | Route a bug, error log, or small enhancement to the spec it belongs to. |
| `/specship:spec behaviour <SPEC_ID>` | Author and run end-to-end tests from the acceptance criteria. |
| `/specship:spec domain` | Capture a human-confirmed domain fact. |

Free text that isn't one of these gets **one** clarifying question offering `new`, `fast`, or `triage`, with a recommendation inferred from what you typed (a stack trace suggests `triage`; a capability suggests `new`).

### Authoring: `new` and `fast`

**`new`** is the gated loop for when the design isn't settled:

1. **Scope and ground** — confirm it's one feature area and look up where similar code lives.
2. **Diverge** — 2–3 approaches with trade-offs and a recommendation; open questions (UX, edge cases, non-goals) asked one at a time.
3. **Write** — only after you confirm: frontmatter, ID markers on every heading, an RFC-2119 keyword per requirement, `## Acceptance` with `.A<N>` bullets covering happy and failure paths, plus `implementations:` and `verifies:` blocks. If tests don't exist yet, the hand-off says so explicitly.
4. **Sync and review** — then hand off to `implement`.

**`fast`** asks exactly two questions — the primary failure mode and the primary non-goal — then drafts the whole spec with sensible defaults. The failure mode becomes a negative-path criterion; the non-goal becomes the document's non-goals line.

Every authoring path (`new`, `fast`, `design`) ends with the same automatic **post-write review**: `specship lint` on the new file, every lint error fixed or the hand-off blocked, a missing `verifies:` block called out rather than left silent, and judgement-level findings (untestable criteria, leaked implementation detail) offered as one proceed/adjust prompt.

If the JIRA integration is configured, authoring then offers once to publish the spec as a Story with a Sub-task per criterion. On a repo with a committed JIRA binding, the spec must be anchored under an epic first. See [JIRA integration](/guides/jira/).

### Implementing: `implement`

Launches the bundled workflow — plan → approve → implement → verify → link — in an isolated git worktree. The spec is the plan, so if the session is in plan mode, the command exits it before launching. See [Bundled workflows](/workflows/bundled/).

### Fixing what's broken: `triage`

Triage is the single intake for anything broken. It finds the requirement your bug belongs to (by text, or by following an error log's `file:line` to the owning code), then:

- If that spec's links are **drifted or broken**, the real problem is a stale link — it points you to `/specship:check fix <SPEC_ID>`.
- Otherwise it previews an append — a new `.A<N>` criterion for a regression an existing requirement should have caught, or a new requirement for a new concern — and writes only after you confirm.
- If nothing matches well enough, it says so and offers `/specship:spec new`. It never auto-creates a spec.

### Testing: `behaviour`

Pulls the requirement's acceptance criteria and its behaviour surface (UI tier and backend tier), previews a test per criterion, writes on confirmation, links each test as evidence for its `.A<N>` criterion, runs the suite, and records the verdicts. Criteria phrased as invariants get property-based tests (Hypothesis or fast-check); route-backed requirements get a Schemathesis command for review, never run automatically. Details in [Quality gates](/specs/quality-gates/#behaviour-tests-that-probe-more-than-one-example).

### Capture: `idea` and `domain`

See [Ideas, briefs & domain facts](/specs/ideas-and-domain-facts/).

## `/specship:check` — the gate door

| Invocation | What it does |
|---|---|
| `/specship:check` | Run the enforcement gate (`specship check`) and summarize any gated failures. |
| `/specship:check drifted` | The drift queue — links that are drifted, broken, or orphaned. |
| `/specship:check fix <SPEC_ID>` | Repair a drifted or broken link with the `spec-fix` workflow: diagnose → approve → apply → re-verify. |
| `/specship:check relink <SPEC_ID>` | Re-point an orphaned link at the symbol's new location or name, then re-assert. |
| `/specship:check health` | Code health (`specship maintainability`): oversized symbols, god files, dependency cycles. |
| `/specship:check claudemd` | Review CLAUDE.md governance findings. Fixes are drafted and written only on your confirmation. |

Free text that isn't a known verb is handed to `/specship:spec triage`, which decides whether it's drift or a spec change.

## The same operations outside Claude Code

| Task | CLI |
|---|---|
| Funnel / spec detail | `specship spec [id]` |
| Lint spec files | `specship lint [paths...]` |
| Coverage rollup | `specship coverage [spec]` |
| Verify from a test report | `specship verify --report <file>` |
| Enforcement gate | `specship check [--since <ref>]` |
| Suppression scan | `specship suppressions [--since <ref>]` |
| Drift queue | `specship drifted [--fail-on <states>]` |
| Domain gaps | `specship domain-gaps` |
| Run a workflow | `specship workflow run spec-implement --input SPEC_ID=<ID>` |

The full flag list is in the [CLI reference](/reference/cli/).
