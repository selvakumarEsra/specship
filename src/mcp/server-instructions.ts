/**
 * Server-level instructions emitted in the MCP `initialize` response.
 *
 * Claude Code surfaces this text in the agent's system prompt
 * automatically, giving the agent a high-level playbook for the
 * specship toolset before it sees individual tool descriptions.
 *
 * Goals when editing this:
 *   - Tool selection by intent (which tool for which question)
 *   - Common chains (refactor planning = X then Y)
 *   - Anti-patterns (don't grep when specship_search is faster)
 *
 * Keep it tight. The agent reads this every session — long instructions
 * burn tokens. Reference only tools that exist on `main`; gate any
 * conditional tools behind feature checks if/when they ship.
 */
export const SERVER_INSTRUCTIONS = `# Specship — code intelligence over an indexed knowledge graph

Specship is a SQLite knowledge graph of every symbol, edge, and file
in the workspace. Reads are sub-millisecond; the index lags writes by
about a second through the file watcher. Consult it BEFORE writing or
editing code, not during.

## Answer directly — don't delegate exploration

For "how does X work", architecture, trace, or where-is-X questions,
answer DIRECTLY — usually with ONE \`specship_explore\` call.
\`specship_explore\` takes either a natural-language question or a bag of
symbol/file names and returns the verbatim source of the relevant symbols
grouped by file, so it is Read-equivalent and most often the ONLY
specship call you need. Specship IS the pre-built search index — so
delegating the lookup to a separate file-reading sub-task/agent, or
running your own grep + read loop, repeats work specship already did and
costs more for the same answer. Reach for raw Read/Grep only to confirm a
specific detail specship didn't cover. A direct specship answer is
typically one to a few calls; a grep/read exploration is dozens.

## Tool selection by intent

- **Almost any question — "how does X work", architecture, a bug, "what/where is X", or surveying an area** → \`specship_explore\` (PRIMARY — call FIRST; ONE capped call returns the verbatim source of the relevant symbols grouped by file; most often the ONLY call you need). Naming a documented domain term/entity also surfaces its human-confirmed fact body inline under "Domain facts".
- **"How does X reach/become Y? / the flow / the path from X to Y"** → \`specship_explore\`, naming the symbols that span the flow (e.g. \`mutateElement renderScene\`) — it surfaces the call path among them, including dynamic-dispatch hops (callbacks, React re-render, JSX children) grep can't follow
- **"What is the symbol named X?" (just its location)** → \`specship_search\`
- **"What calls this?" / "What does this call?" / "What would changing this break?"** → \`specship_callers\` / \`specship_callees\` / \`specship_impact\`
- **One specific symbol's full source (esp. a body \`specship_explore\` trimmed), or an OVERLOADED name** → \`specship_node\` (with \`includeCode\`): for an ambiguous name it returns EVERY matching definition's body in one call, so you never Read a file to find the right overload
- **"What's in directory X?"** → \`specship_files\`
- **"Is the index ready / what's its size?"** → \`specship_status\`
- **User mentions a spec ID or requirement (e.g. "REQ-AUTH-005", "the rate-limit requirement")** → \`specship_spec\` FIRST. Returns spec body + parent/siblings + linked code with state (verified / drifted / orphaned) — more than Read-ing the spec file alone. If domain facts (ubiquitous-language terms, business rules) are linked to the spec, they come back inline under "Domain facts" — no separate tool. Then jump into linked code via \`specship_node\`.
- **User describes a change without naming a spec (a bug, an error, a one-line enhancement) and you need to find which existing spec it belongs to** → \`specship_spec\` with a free-text \`query\`. Returns scored, ranked candidate specs (id, title, kind, snippet) over the spec index — use it to route the change to the right requirement before authoring a new doc. (No \`query\`/\`spec_id\` → the lifecycle funnel; add \`list: true\` for a flat inventory of every requirement's single rolled-up status + per-status totals, or \`ideas: true\` for the ideas review view — the idea-state briefs with age since capture + labels, closing with the promotion hand-off.)
- **Authoring end-to-end tests for a requirement** → \`specship_spec\` with \`spec_id\` + \`behaviour_surface: true\`. Returns the requirement's linked code plus the surrounding routes / components / handlers grouped into a UI tier (Playwright targets) and a backend/batch tier (API/job targets) — the flow map to write tests from.
- **After editing code in response to a spec** → call \`specship_link_assert\` before reporting done. Idempotent. Supersedes the \`// @implements REQ-X\` comment backstop (which the extractor catches on its own).
- **After running verification (tests) against a spec link** → \`specship_link_verify\` with \`result: "pass" | "fail"\` so the link moves from \`implemented\` to \`verified\` (or \`broken\`).
- **"What's drifted / broken / orphaned?" / non-coder review queue** → \`specship_drifted\` (optional \`state\` filter).

## Common chains

- **Flow / "how does X reach Y"**: ONE \`specship_explore\` with the symbol names spanning the flow — it surfaces the call path among them (riding dynamic-dispatch hops) AND returns their source. No need to reconstruct the path with \`specship_search\` + \`specship_callers\`.
- **Onboarding / understanding any area**: ONE \`specship_explore\` is usually the whole answer. Only follow up — \`specship_node\` for a specific symbol — if something is still unclear.
- **Refactor planning**: \`specship_search\` → \`specship_callers\` → \`specship_impact\`. The blast-radius answer comes from impact, not from walking callers manually.
- **Debugging a regression**: \`specship_callers\` of the suspected symbol; widen with \`specship_impact\` if an unexpected call appears.

## Anti-patterns

- **Trust specship's results — don't re-verify them with grep.** They come from a full AST parse; re-checking with grep is slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name — \`specship_search\` is faster and returns kind + location + signature.
- **Don't chain \`specship_search\` + \`specship_node\`** to understand an area — ONE \`specship_explore\` returns the relevant symbols' source together in a single round-trip.
- **Don't loop \`specship_node\` over many symbols** — one \`specship_explore\` call returns them all grouped by file, while each separate call re-reads the whole context and costs far more. Use \`specship_node\` for a single symbol.
- **After editing, check the staleness banner.** When a tool response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files are pending re-index — Read those specific files for accurate content. Every file NOT in that banner is fresh, so still trust specship. \`specship_status\` also lists pending files under "Pending sync".

## Limitations

- If a tool reports the project isn't initialized, \`.specship/\` doesn't exist yet — offer to run \`specship init -i\` to build the index.
- Index lags file writes by ~1 second.
- Cross-file resolution is best-effort name matching; ambiguous calls may return multiple candidates.
- No live correctness validation — that's still the TypeScript compiler / test suite / linter's job. Specship supplements those with structural context they don't have.
`;
