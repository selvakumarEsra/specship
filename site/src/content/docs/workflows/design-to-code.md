---
title: Design-to-code
description: Turn a Claude Design (or Figma) design into a drafted SpecShip spec and an implementation — with the design captured byte-for-byte as a zero-loss reference.
---

SpecShip can take a design straight through to code: snapshot it for fidelity, draft a spec for the contract, and hand off to implementation. The whole path starts from one command, **`/specship:spec design`**, and runs on the bundled `claude-design-implement` workflow.

> **Designer is an opt-in, experimental integration.** Enable it with `specship install --with-designer`; a plain install doesn't expose the `designer_*` tools. The tools drive [claude.ai/design](https://claude.ai/design) through a debug Chrome session, so they can break when the site changes. They only launch Chrome when you actually invoke a designer tool — `specship install` and MCP startup never touch it. One-time setup: run `designer setup` to create the debug-Chrome profile and log in.

## `/specship:spec design` — three entry shapes

`/specship:spec design <URL | intent>` routes on what you give it:

### A `claude.ai/design` URL — you've already settled on a design

Point it at a Claude Design file URL (`https://claude.ai/design/p/<id>/?file=<File>.html`). It derives a slug from the file name and runs:

```bash
specship workflow run claude-design-implement \
  --input CONNECTOR_URL="<URL>" \
  --input FILE_LABEL="<File Name>" \
  --input SLUG="<slug>"
```

Add `--input OWNER=…` / `--input PRIORITY=high|medium|low` to fill the spec's frontmatter; otherwise they surface as `[needs review]` at the review gate.

### A `figma.com` URL

Goes through Figma's remote MCP server. If it isn't installed, you're told to add it (`claude mcp add --transport http figma https://mcp.figma.com/mcp`) and the flow stops — the URL is never blind-fetched. With it present, the design is imported and fed into the same workflow via its `HANDOFF_DIR` input.

### No URL — taste the design first

With a bare intent (or nothing), it runs the human-tasted **design loop** before it specs anything. There are two human gates:

- **Gate 1 (aesthetic).** The agent drives `claude.ai/design` through the `designer_*` tools while you taste the variants on the live surface, iterating until you say "that's it." Claude Design has the taste; the agent is translation + plumbing, seeding the prompt with what the repo actually does (entities, operations, states, failure modes) pulled via `specship_explore`. If the designer session isn't up or you're not signed in, it tells you to run `designer setup` and stops.
- **Gate 2 (contract).** `designer_handoff` fetches the chosen bundle to disk, then `claude-design-implement` runs against it — no re-fetch:

```bash
specship workflow run claude-design-implement \
  --input HANDOFF_DIR="<path to handoff-<ts>/>" \
  --input CHOSEN_FILE="<variant>.html" \
  --input FILE_LABEL="<File Label>" \
  --input SLUG="<slug>"
```

Whichever way you came in, the workflow pauses so you can walk the spec's `[needs review]` markers, and every authoring path finishes with SpecShip's standard post-write review (`specship lint` on the new spec plus a quality pass) before handing off to `/specship:spec implement`.

## What the workflow does

`claude-design-implement` runs in its own worktree and has five nodes:

1. **snapshot** — captures the design source **byte-for-byte** into `specs/<slug>/snapshot.html` (from the handoff bundle on disk, or from the live URL via the designer tools — a plain fetch of a Claude Design URL returns only a loader shell). Writes `specs/<slug>/source.md` as the import record (URL or bundle, date, the original prompt / decision record) and extracts design tokens into `specs/<slug>/tokens.css`, mapped onto your project's existing token system.
2. **draft_spec** — drafts `specs/<slug>.md` covering the behavioural contract, accessibility, responsive behaviour and interaction states — **no pixel values or hex colors** (those stay in the snapshot + tokens).
3. **gap_review** — `approval`. Answer the gap-fill questions in your approval comment; reject with feedback to have the draft revised.
4. **write_spec** — writes the spec and runs `specship sync`. Re-importing an iteration appends new requirements and keeps existing REQ IDs stable.
5. **handoff** — prints the spec path, its REQ IDs, the reference files, and the exact next command: `/specship:spec implement <first REQ ID>`.

The implementation step reads `specs/<slug>/snapshot.html` for visual fidelity — the spec covers the contract only.

## Why the four-file split

The workflow writes four files rather than one spec:

| File | Role | Drift-tracked? |
|---|---|---|
| `specs/<slug>/snapshot.html` | Byte-for-byte design capture | No (frozen reference) |
| `specs/<slug>/source.md` | Import audit record | No (metadata) |
| `specs/<slug>/tokens.css` | Design tokens as CSS variables | No (reference data) |
| `specs/<slug>.md` | The contract: REQs + acceptance criteria | **Yes — the drift gate** |

Specs that name pixel values flag drift on every theme tweak; specs that name token symbols (`MUST use --error`) survive token-value changes silently. The split keeps the [drift queue](/specs/links-and-drift/) meaningful. When the designer iterates, re-running keeps existing REQ IDs stable, so in-flight implementation work survives — and `git diff` separates a *visual* change (the snapshot) from a *contract* change (the spec).

## The design tools

Exposed as `mcp__specship__designer_*` once Designer is enabled, vendored from `@pro-vi/designer` (MIT):

| Tool | Purpose |
|---|---|
| `designer_session` | Open / resume / status a Claude Design session. |
| `designer_prompt` | Send a design prompt and iterate on variants. |
| `designer_ask` | Ask Claude Design a question about the current design. |
| `designer_list` | List the files / variants in the session. |
| `designer_snapshot` | Snapshot a design's source byte-for-byte to disk. |
| `designer_handoff` | Fetch the project export bundle (all variants + a `decision-record.md`) to disk. |

`specship install --with-designer` auto-allows these tools, so the taste loop doesn't prompt on every iteration.
