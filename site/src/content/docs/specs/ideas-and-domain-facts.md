---
title: Ideas, briefs & domain facts
description: The two non-requirement file types under specs/ — idea briefs that feed the spec funnel, and human-confirmed domain facts that give the agent your business vocabulary.
---

Besides requirement specs, SpecShip indexes two other kinds of Markdown file under `specs/`. Neither has `<!-- id: -->` markers — both are keyed by their frontmatter — and neither is held to a spec's lint rules.

| File | Kind | ID | Purpose |
|---|---|---|---|
| `specs/<slug>/brief.md` | brief | `brief:<slug>` | An idea or brainstorm that hasn't become a spec yet. |
| `specs/domain/*.md` | domain | the frontmatter `id` (e.g. `DOM-BILLING-003`) | A human-confirmed business term, rule, decision, or constraint. |

## Ideas and briefs

### Capture an idea without breaking flow

Mid-task, something occurs to you. In Claude Code:

```
/specship:spec idea perf: cache the rendered snapshots
```

That writes `specs/cache-the-rendered-snapshots/brief.md`, syncs, prints one confirmation line (`Parked as brief:cache-the-rendered-snapshots.`), and goes back to what you were doing. No questions, no review. A leading `word:` becomes a **label** (`perf` above). If the conversation already makes the relevant code obvious, the brief records it under a `## Grounding` section; otherwise that's skipped. An existing brief is never overwritten — the slug gets `-2`, `-3`, … instead.

### The brief format

```markdown
---
slug: cache-the-rendered-snapshots
created: 2026-10-16
label: perf
---
# cache the rendered snapshots

cache the rendered snapshots

## Grounding
- src/render/snapshot.ts:renderSnapshot
```

| Key | Meaning |
|---|---|
| `slug` | **Required.** The brief's identity — it is indexed as `brief:<slug>`. A `brief.md` without a slug is skipped. |
| `created` | Capture date; the ideas view shows age from this. |
| `label` | Optional tag shown in the ideas view. |
| `spec` | Optional pointer to the spec this brief became (a document or requirement ID). |

The title is the first heading; the whole body is full-text searchable.

### Brief states

A brief's state is computed from both directions of the link between brief and spec — the brief's own `spec:` key, and a spec document whose `brief:` frontmatter points back at the brief file (relative to the spec file, e.g. `brief: cache-the-rendered-snapshots/brief.md`):

| State | Meaning |
|---|---|
| `idea` | Neither direction resolves — still parked. |
| `specified` | One or both directions resolve to the same spec document. (A `spec:` that names a requirement resolves up to its document.) |
| `conflict` | The two directions point at different documents — surfaced for you to fix rather than silently picking one. |

### Review and promote

- `/specship:spec ideas` — just the parked ideas, each with ID, title, age, and labels.
- `/specship:spec list` — every brief and requirement, each with one rolled-up status.
- `/specship:spec` (no argument), or `specship spec` on the CLI — the lifecycle funnel: ideas → specified → implemented.
- `/specship:spec new brief:<slug>` — promote an idea. The authoring interview starts pre-filled from the brief and asks only what it leaves open; the written spec carries `brief:` in its frontmatter, so the brief flips to `specified` on the next sync and drops out of the ideas view.

The dashboard's Specs page shows the same funnel, with an Ideas branch for captured briefs.

## Domain facts

A domain fact captures something the code can't tell the agent: what a business term means, a rule the product must obey, a decision and why it was made, or a hard constraint. Facts are **human-confirmed** — SpecShip may detect a gap and draft a fact, but nothing lands in `specs/domain/` without you confirming it.

### The fact format

```markdown
---
id: DOM-BILLING-003
title: Grace period
type: term
depends_on: REQ-BILLING-012, REQ-BILLING-014
---

# Grace period

The 7 days after a failed renewal charge during which the subscription stays
active. Dunning emails go out on days 1, 3, and 6; on day 8 the account is
downgraded to the free plan.
```

| Key | Meaning |
|---|---|
| `id` | **Required.** Convention: `DOM-<AREA>-NNN`. A file without one is skipped. |
| `title` | Falls back to the first heading, then the ID. |
| `type` | `term`, `rule`, `decision`, or `constraint`. An unrecognized type is indexed anyway, with a warning. |
| `parent_id` | One spec this fact belongs under. |
| `depends_on` | One or more spec IDs — a single ID, a comma-separated list, or `[A, B]`. |

### How facts reach the agent

Facts link to **specs**, not to code. Their code association is inherited: a fact that depends on `REQ-BILLING-012` is associated with whatever code `REQ-BILLING-012` links to (followed transitively through parents and dependencies), and it sees that code's drift state. A `depends_on` ID that doesn't exist yet is reported as a gap, never an error.

You don't call anything special to use them. When the agent reads a spec with `specship_spec`, linked facts come back inline under **Domain facts**; naming a documented term in a `specship_explore` question surfaces the fact's body the same way.

### Capturing facts

- **`/specship:spec domain`** — runs `specship domain-gaps` to find code entities and specs no fact covers yet, asks targeted questions per fact type, and writes the fact only on your explicit confirmation.
- **`/specship:learn`** — capture business knowledge you just explained (or a code-style convention) on demand, mid-session. It becomes a proposal in the improvement queue; applying it writes the fact under `specs/domain/`.
- **Automatic learning** — SpecShip's background learning pass notices when a term your sessions keep discussing has no domain documentation and drafts a fact file as a proposal. Reviewing and applying the proposal is what lands it; it never writes to `specs/domain/` on its own. The pass can be turned off in `specship.config.json`.

```bash
specship domain-gaps            # what's undocumented
specship domain-gaps --json     # for scripts
```

→ See also: [Writing specs](/specs/writing-specs/) · [Spec commands](/specs/spec-commands/)
