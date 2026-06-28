---
description: Import a Claude Design (or Figma) file, snapshot it for zero-loss reference, draft a SpecShip spec, and hand off to /ss-spec implement.
argument-hint: <Claude-Design-URL> [SLUG]
allowed-tools: Read, Write, Edit, Bash, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_spec, mcp__specship__specship_files
---

# SpecShip Design → Spec → Implement: `$ARGUMENTS`

> **Already settled on a design?** This command imports it by URL. If you instead want to *run
> the taste loop first* — iterate variants with the human via the `designer` MCP and only then
> spec the chosen one — use **`/ss-design-loop`**, which drives the loop and hands the resulting
> bundle to this same workflow via its `HANDOFF_DIR` input.

Run the bundled `claude-design-implement` workflow against the Claude Design URL in `$ARGUMENTS`. The workflow:

1. **Snapshots** the design source byte-for-byte into `specs/<slug>/snapshot.html` (zero-loss fidelity layer).
2. **Records the import** in `specs/<slug>/source.md` (audit trail — URL, project ID, date, original prompt verbatim).
3. **Extracts design tokens** into `specs/<slug>/tokens.css`, mapped onto your project's existing token system where possible.
4. **Drafts a spec** at `specs/<slug>.md` covering behavioural contract, accessibility, responsive, interaction states, and data shape — **without** pixel values or hex colors (those stay in the snapshot + tokens).
5. **Pauses at an approval gate** for you to walk the `[needs review]` markers and gap-fill questions.
6. **Writes the spec** and `specship sync`s it into the graph.
7. **Hands off** with the next command: `/ss-spec implement <first REQ ID>`.

## How to invoke

Parse `$ARGUMENTS`. The first token must be a Claude Design URL of the form:

```
https://claude.ai/design/p/<project-id>/?file=<File+Name>.html
```

Optional second token is the slug (kebab-case directory name). If omitted, derive from the `file=` query param (e.g. `Data+Flow.html` → `data-flow`).

Then run:

```bash
specship workflow run claude-design-implement \
  --input CONNECTOR_URL="<URL>" \
  --input FILE_LABEL="<File Name>" \
  --input SLUG="<slug>"
```

(Add `--input OWNER="<team>"` and `--input PRIORITY="high|medium|low"` if you want them populated in the spec frontmatter; otherwise they're marked `[needs review]` and surfaced in the gap-fill step.)

## Why the four-file pattern

The workflow produces four files in `specs/<slug>/` rather than a single spec. This is deliberate:

| File | Role | Drift-tracked? |
|---|---|---|
| `snapshot.html` | Byte-for-byte design capture | No (frozen reference) |
| `source.md` | Import audit record | No (metadata) |
| `tokens.css` | Design tokens — CSS variables | No (reference data) |
| `specs/<slug>.md` | Contract: REQs, acceptance criteria | **Yes — drift gate on this** |

Specs that name pixel values flag drift on every theme tweak; specs that name token symbols (`MUST use --error`) survive token-value changes silently. The split keeps the drift queue meaningful.

## After the workflow finishes

You get a hand-off message listing the REQs. Run:

```
/ss-spec implement <REQ-XXX-001>
```

The implementation phase reads:
- `specs/<slug>.md` for what to build
- `specs/<slug>/snapshot.html` for how it should look
- `specs/<slug>/tokens.css` for which design tokens to wire up

This is what preserves visual fidelity — the snapshot is on disk and the implementer reads it directly. The spec layer enforces contract; the snapshot layer guarantees fidelity.

## When the designer iterates

Re-run `/ss-design-implement` with the same URL. The workflow re-snapshots, re-drafts, re-prompts for approval — keeping existing REQ IDs stable so any in-flight implementation work survives the iteration. `git diff` on the snapshot tells you exactly what changed visually; `git diff` on `specs/<slug>.md` tells you what changed contractually.

## Anti-patterns

- **Don't put hex codes in the spec.** Reference tokens by name. The values live in `tokens.css`.
- **Don't delete the snapshot after implementation.** It's the durable reference if the Claude Design URL ever goes 404.
- **Don't paraphrase the snapshot.** Save byte-for-byte. Summarising loses detail that the implementation step would otherwise have used.
- **Don't skip the approval gate.** The workflow's value is the gap-fill questions surfaced there — answering them is what closes the "no details lost" gap on the things a static design can't show (failure modes, real-time updates, keyboard order).

If `$ARGUMENTS` is empty or doesn't look like a Claude Design URL, ask the user for the URL before running the workflow.
