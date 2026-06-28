---
title: Design-to-code
description: Turn a Claude Design (or Figma) handoff into a drafted SpecShip spec and an implementation — with the design captured byte-for-byte as a zero-loss reference.
---

SpecShip can take a design straight through to code: snapshot it for fidelity, draft a spec for the contract, and hand off to implementation. Claude Design is built in — the standalone `designer` MCP is merged into SpecShip, so `specship serve --mcp` exposes the `designer_*` tools alongside the code-graph and spec tools.

> **macOS only.** The design tools drive [claude.ai/design](https://claude.ai/design) over a debug Chrome via `agent-browser`. They only launch Chrome when you actually invoke a designer tool — `specship install` and MCP startup never touch it. One-time setup: run `designer setup` to create the debug-Chrome profile and log in.

## Two entry points

### `/ss-design-implement <url>` — you've already settled on a design

Imports a design **by URL** and runs the bundled `claude-design-implement` workflow. Point it at a Claude Design file URL (`https://claude.ai/design/p/<id>/?file=<File>.html`) — or any handoff URL the agent can fetch, including Figma handoffs. The workflow:

1. **Snapshots** the design source byte-for-byte into `specs/<slug>/snapshot.html` — a zero-loss fidelity layer.
2. **Records the import** in `specs/<slug>/source.md` (URL, project ID, date, original prompt).
3. **Extracts design tokens** into `specs/<slug>/tokens.css`, mapped onto your project's existing token system.
4. **Drafts a spec** at `specs/<slug>.md` covering the behavioural contract, accessibility, responsive, and interaction states — **no pixel values or hex colors** (those stay in the snapshot + tokens).
5. **Pauses at an approval gate** so you can walk the `[needs review]` markers and answer the gap-fill questions.
6. **Writes the spec**, syncs it into the graph, and hands off to `/ss-spec implement <first REQ ID>`.

### `/ss-design-loop` — taste the design first

The deeper companion: it runs the human-tasted design loop *before* it specs anything. There are two human gates:

- **Gate 1 (aesthetic).** You drive `claude.ai/design` through the `designer_*` tools while the human tastes the variants on the live surface, iterating until they say "that's it." Claude Design has the taste; the agent is translation + plumbing, and seeds the prompt with what the repo actually does (entities, operations, states, failure modes) pulled via `specship_explore`.
- **Gate 2 (contract).** `designer_handoff` fetches the chosen bundle to disk, then the same `claude-design-implement` workflow runs against it (via its `HANDOFF_DIR` input — no re-fetch) and pauses so the human walks the spec's `[needs review]` markers.

Then it hands off to `/ss-spec implement`.

## Why the four-file split

The workflow writes four files under `specs/<slug>/` rather than one spec:

| File | Role | Drift-tracked? |
|---|---|---|
| `snapshot.html` | Byte-for-byte design capture | No (frozen reference) |
| `source.md` | Import audit record | No (metadata) |
| `tokens.css` | Design tokens as CSS variables | No (reference data) |
| `specs/<slug>.md` | The contract: REQs + acceptance criteria | **Yes — the drift gate** |

Specs that name pixel values flag drift on every theme tweak; specs that name token symbols (`MUST use --error`) survive token-value changes silently. The split keeps the [drift queue](/specs/links-and-drift/) meaningful. When the designer iterates, re-running keeps existing REQ IDs stable, so in-flight implementation work survives — and `git diff` separates a *visual* change (the snapshot) from a *contract* change (the spec).

## The design tools

Exposed as `mcp__specship__designer_*`, vendored from `@pro-vi/designer` (MIT):

| Tool | Purpose |
|---|---|
| `designer_session` | Open / resume / status a Claude Design session. |
| `designer_prompt` | Send a design prompt and iterate on variants. |
| `designer_ask` | Ask Claude Design a question about the current design. |
| `designer_list` | List the files / variants in the session. |
| `designer_snapshot` | Snapshot a design's source byte-for-byte to disk. |
| `designer_handoff` | Fetch the project export bundle (all variants + a `decision-record.md`) to disk. |

The read-only loop tools are auto-allowed by `specship install`, so the taste loop doesn't prompt on every iteration.
