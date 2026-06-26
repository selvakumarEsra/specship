---
description: Capture a human-confirmed domain fact (a term, rule, decision, or constraint) for an undocumented entity or spec. Grounds in the real gap-seed, interviews per-type, and writes only on explicit confirmation.
argument-hint: [entity-or-spec name | --type rule]
allowed-tools: mcp__specship__specship_explore, mcp__specship__specship_spec, Bash, Write
---

# SpecShip Domain Capture

Capture a **domain fact** — a piece of the project's ubiquitous language or a
stated business rule — and persist it under `specs/domain/` as a `domain` spec.
Domain facts attach at the **spec tier** (linked to a requirement spec) and
inherit code links + drift through that spec.

**Governing principle — propose, never auto-apply.** A fact reaches disk ONLY on
explicit human confirmation. If the human does not confirm, you write **nothing**.

## 1. Find what is undocumented (ground in the real gap-seed)

Run the gap-seed pass and read its output. This lists the **real** code entities
and specs that no domain fact yet covers — never invent a generic prompt.

```bash
specship domain-gaps --json
```

The JSON has `entities` (undocumented `class`/`struct`/`interface`/`route`/`component`
nodes, each with `qualifiedName`, `kind`, `filePath`), `specs` (undocumented
non-domain specs, each with `id`, `title`, `kind`), and a `coverage` rollup of
`{documented, gaps}`.

- If `$ARGUMENTS` names a specific entity or spec, target that one.
- Otherwise pick the most central few gaps to offer the human.
- If `coverage.gaps` is `0`, tell the human the domain layer is fully covered and stop.

## 2. Understand the candidate before asking

For the entity or spec you are about to ask about, ground yourself in the code so
your questions are specific, not generic:

- `mcp__specship__specship_explore` naming the gap entity (and neighbours) to read its real source.
- `mcp__specship__specship_spec` on the spec you intend to link the fact to, to see its requirements and current code links.

## 3. Interview — per-type, targeted, citing the gap

Ask about **the named gap**, not "describe your domain". Frame the questions by
the fact `type` you are capturing:

- **term** — "What does `<EntityName>` mean in this product's language? What's the one-sentence definition a new teammate needs?"
- **rule** — "What invariant must always hold for `<EntityName>` / the `<SpecTitle>` flow? State it as MUST/NEVER."
- **decision** — "What was decided about `<EntityName>` and why was the alternative rejected?"
- **constraint** — "What external limit (regulatory, performance, contractual) bounds `<EntityName>`?"

Confirm with the human:
- the **type** (`term` | `rule` | `decision` | `constraint`),
- the **statement** (the fact body),
- the **spec to link** (a requirement `id` from the gap-seed / `specship_spec`),
- a `DOM-<AREA>-NNN` **id** (AREA = a short uppercase domain tag, NNN zero-padded; pick the next free number for that AREA).

## 4. Confirm, then write (and ONLY then)

Show the human the exact fact you are about to write and ask for explicit
confirmation (e.g. "Write this fact? (yes/no)"). **If they do not clearly
confirm, stop and write nothing — the command is a no-op.**

On confirmation, `Write` the file to `specs/domain/<area>.md` (one fact per file
is simplest; append to an existing area file only if the human asks):

```markdown
---
id: DOM-PAY-001
title: Settlement currency
type: rule
depends_on: REQ-PAY-004
---
# Settlement currency

All payments settle in the merchant's account currency, never the buyer's.
```

Frontmatter rules:
- `id` — `DOM-<AREA>-NNN`, distinct from `REQ-` ids.
- `type` — exactly one of `term`, `rule`, `decision`, `constraint`.
- Link with `depends_on: <REQ-ID>` (comma-separate multiple) and/or `parent_id: <REQ-ID>`. A fact with no link is allowed — it indexes as an unlinked gap, never an error.

## 5. Index it

```bash
specship sync
```

The fact now projects as a `spec:DOM-…` node, is returned by `specship_explore`
and `specship_spec`, and inherits the linked requirement's code links + drift.

## Manual authoring is equivalent

This command is a convenience, not a gate. A human can hand-create the same
`specs/domain/<area>.md` file with the frontmatter above and run `specship sync`
to get the **identical** indexed fact — no command required.
