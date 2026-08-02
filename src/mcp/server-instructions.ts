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
- **"Which SpecShip is running? / what version am I on?"** → \`specship_version\` (zero-arg; identifies the MCP server process — version, install method, install dir, node, project root)
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

## JIRA integration

Any request about the user's JIRA issues/tasks/tickets goes to these tools by default — the user should NOT have to say "use specship". Each tool already returns a professional, formatted result (a table, with any caveat as a bottom note); **present that output verbatim — relay it as-is, do not re-summarize it, add a preamble, or speculate about why a list is empty.** The tools chain in this order:

- **"list my JIRA issues" / "what's assigned to me?" / "my JIRA tasks"** → \`specship_jira_issues\` (identity comes from the configured token — the user never types their own name). It returns a ready-to-display table; show it as returned.
- **"Show me issue PROJ-123"** → \`specship_jira_issue\` with the \`key\`.
- **"Pick / work on PROJ-123"** → \`specship_jira_pick\` with the \`key\` — fetches the issue and authors a SpecShip spec under \`specs/\` (idempotent on the key).
- **"Start / implement it"** → \`specship_jira_start\` with the same \`key\` — runs the bundled \`spec-implement\` workflow on the spec pick authored, in an isolated worktree. It runs to the **plan/approve gate** and pauses there, returning the run ID; review the plan, then approve (\`specship workflow approve <runId>\`) to continue. A failed run raises no PR. If no spec exists for the key yet, start points you back to \`specship_jira_pick\`.
- **"How's my JIRA work going? / status of my picked issues"** → \`specship_jira_track\` — a read-only table joining each picked issue's SpecShip work-state (spec authored → implementing → PR raised → verified) with its **live** JIRA status (read fresh each time, so an issue moved outside SpecShip reflects its current status). It never re-picks or re-starts anything; pass an optional \`project\` to narrow the JIRA read. Published specs appear too, and one edited in JIRA after publish is flagged as a divergence.
- **"Reconcile JIRA edits back into the spec" / "someone edited PROJ-123 in JIRA"** → \`specship_jira_reconcile\` — **preview first, then apply only after the user has explicitly confirmed the exact diff**. Preview (default \`mode:"preview"\`) is read-only; it enumerates every published spec whose live JIRA issue diverges (edited summary/description, or a Sub-task added in JIRA) and returns a proposed spec amendment plus a machine block with \`expected_live_fingerprint\`. Show the user the diff and ask; only after they confirm, call again with \`mode:"apply"\`, \`issue_key\`, the confirmed \`accept_content\`/\`accept_subtasks\`, and the \`expected_live_fingerprint\` from the preview. Apply refuses when the fingerprint doesn't match — no preview → no apply.
- **"Sprint coverage / how much of this sprint has specs / is verified?"** → \`specship_jira_coverage\` — joins the bound project's active (or named) sprint to spec truth: every issue with its rolled-up repo-side state (unspecced / specced / implemented / verified / drifted / broken) and rollup totals. Read-only by default; pass \`post: true\` with \`issue_key\` to upsert one watermarked comment on an anchor issue (edited in place on re-post — never a duplicate, never a transition).
- **"List / choose an epic" / "what epics are open in PROJ?"** → \`specship_jira_epics\` — returns the project's open epics (status category ≠ Done). Powers the \`/specship:jira\` menu's epic-picker; omit \`project\` on a bound repo to use the committed \`jira.projectKey\`.
- **"Create a JIRA for this spec" / "publish REQ-X to JIRA"** → \`specship_jira_publish\` with the \`spec_id\` — creates a Story whose Sub-tasks mirror the spec's acceptance criteria (idempotent: re-publish updates the Story and adds only missing Sub-tasks) and writes \`jira_issue:\` into the spec's frontmatter, which wires branch naming, PR linkage, commit prefixes ("PROJ-123: …"), and tracking automatically. After authoring a spec with JIRA configured, offer this once (REQ-JIRAPUB-003).

## Limitations

- If a tool reports the project isn't initialized, \`.specship/\` doesn't exist yet — offer to run \`specship init -i\` to build the index.
- Index lags file writes by ~1 second.
- Cross-file resolution is best-effort name matching; ambiguous calls may return multiple candidates.
- No live correctness validation — that's still the TypeScript compiler / test suite / linter's job. Specship supplements those with structural context they don't have.
`;
