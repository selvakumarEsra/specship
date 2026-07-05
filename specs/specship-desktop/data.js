/* ============================================================
   SpecShip Desktop — Mock data
   Believable, internally consistent. Attached to window.DATA.
   ============================================================ */
(function () {
  const fmt$ = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);

  // ---------- Project / status ----------
  const status = {
    projectPath: "~/dev/specship",
    backend: "better-sqlite3",
    nodes: 4218,
    edges: 9743,
    drift: 7,
    broken: 2,
    orphaned: 3,
    lastIndex: "2m ago",
    indexedFiles: 612,
  };

  // ---------- Projects (for compare) ----------
  const projects = [
    { id: "specship",      name: "specship",      path: "~/dev/specship",        cost: 184.42, sessions: 38, cacheHit: 0.71, drift: 7,  avg: 4.85, nodes: 4218, edges: 9743, tools: ["Read","Bash","Edit"] },
    { id: "archon-web",     name: "archon/web",     path: "~/dev/archon/web",       cost: 312.08, sessions: 52, cacheHit: 0.58, drift: 14, avg: 6.00, nodes: 8106, edges: 19420, tools: ["Read","Grep","Bash"] },
    { id: "specship-api",   name: "specship-api",   path: "~/dev/specship-api",     cost: 96.30,  sessions: 21, cacheHit: 0.83, drift: 2,  avg: 4.59, nodes: 2740, edges: 5988, tools: ["Read","Edit","Write"] },
    { id: "ledger-core",    name: "ledger-core",    path: "~/work/ledger-core",     cost: 241.77, sessions: 44, cacheHit: 0.49, drift: 22, avg: 5.49, nodes: 6533, edges: 14802, tools: ["Bash","Read","Grep"] },
    { id: "marketing-site", name: "marketing-site", path: "~/dev/marketing-site",   cost: 41.12,  sessions: 12, cacheHit: 0.77, drift: 1,  avg: 3.43, nodes: 1284, edges: 2610, tools: ["Edit","Read","Write"] },
  ];

  // ---------- Cost over time (30d) ----------
  const costSeries = (() => {
    const out = [];
    let base = 4.2;
    for (let i = 29; i >= 0; i--) {
      base += (Math.sin(i / 3) * 1.6) + (Math.random() - 0.45) * 2.2;
      base = Math.max(0.6, base);
      const spike = (i === 4 || i === 11) ? base * 1.9 : base;
      out.push({ day: i, cost: +spike.toFixed(2), prompts: Math.round(8 + spike * 2.1) });
    }
    return out;
  })();

  // ---------- By-model breakdown ----------
  const byModel = [
    { model: "claude-opus-4",   short: "Opus 4",   cost: 121.4, color: "#A586F5" },
    { model: "claude-sonnet-4", short: "Sonnet 4", cost: 52.8,  color: "#5B93F2" },
    { model: "claude-haiku-4",  short: "Haiku 4",  cost: 10.2,  color: "#29D2BE" },
  ];

  // ---------- Sessions ----------
  const sessions = [
    { id: "a3f9c1d2", project: "specship", started: "Today 14:22", ended: "15:41", prompts: 34, cost: 11.84, cache: 0.78, model: "Opus 4" },
    { id: "7b2e0a44", project: "specship", started: "Today 09:10", ended: "10:02", prompts: 18, cost: 5.21,  cache: 0.62, model: "Sonnet 4" },
    { id: "c91d7e58", project: "archon/web", started: "Yest 22:31", ended: "23:58", prompts: 47, cost: 18.30, cache: 0.41, model: "Opus 4" },
    { id: "f04a8b13", project: "specship", started: "Yest 16:05", ended: "16:44", prompts: 12, cost: 3.02,  cache: 0.84, model: "Sonnet 4" },
    { id: "2d6c9f70", project: "ledger-core", started: "Yest 11:20", ended: "13:10", prompts: 39, cost: 14.77, cache: 0.49, model: "Opus 4" },
    { id: "8e1b3a26", project: "specship-api", started: "Jun 4 19:40", ended: "20:15", prompts: 15, cost: 4.10, cache: 0.83, model: "Sonnet 4" },
    { id: "b5f2c8d9", project: "specship", started: "Jun 4 08:55", ended: "09:38", prompts: 21, cost: 6.44, cache: 0.71, model: "Opus 4" },
    { id: "1a7d4e90", project: "archon/web", started: "Jun 3 21:12", ended: "22:48", prompts: 52, cost: 21.06, cache: 0.38, model: "Opus 4" },
  ];

  // ---------- Prompts (recent, with cost) ----------
  const prompts = [
    { id: "p-8841", session: "a3f9c1d2", text: "Refactor the link-verify pass to batch SQLite writes in a single transaction", cost: 1.42, tokens: 48200, cache: 0.81, model: "Opus 4", sidechain: false, when: "14:39" },
    { id: "p-8840", session: "a3f9c1d2", text: "Why is specship_explore returning duplicate callee edges for overloaded methods?", cost: 0.94, tokens: 31100, cache: 0.74, model: "Opus 4", sidechain: false, when: "14:21" },
    { id: "p-8838", session: "a3f9c1d2", text: "Add a spec-anchored layout mode to the graph view", cost: 2.18, tokens: 71400, cache: 0.62, model: "Opus 4", sidechain: false, when: "13:58" },
    { id: "p-8836", session: "7b2e0a44", text: "Read auth.ts and tell me where the session token is validated", cost: 0.71, tokens: 22800, cache: 0.44, model: "Sonnet 4", sidechain: false, when: "09:51" },
    { id: "p-8835", session: "7b2e0a44", text: "Run the drift detector against the specs/ folder and summarize", cost: 0.38, tokens: 12600, cache: 0.66, model: "Sonnet 4", sidechain: true, when: "09:44" },
    { id: "p-8833", session: "7b2e0a44", text: "grep for every call site of parseTranscript across the repo", cost: 1.07, tokens: 35900, cache: 0.21, model: "Sonnet 4", sidechain: false, when: "09:30" },
    { id: "p-8830", session: "f04a8b13", text: "Implement REQ-INGEST-004: incremental jsonl tailing", cost: 1.88, tokens: 60300, cache: 0.79, model: "Sonnet 4", sidechain: false, when: "Yest 16:30" },
    { id: "p-8829", session: "f04a8b13", text: "Write tests for the pricing table override path", cost: 0.62, tokens: 20500, cache: 0.71, model: "Sonnet 4", sidechain: false, when: "Yest 16:12" },
    { id: "p-8827", session: "b5f2c8d9", text: "Explain how spec links transition from implementing → verified", cost: 0.49, tokens: 16200, cache: 0.69, model: "Opus 4", sidechain: false, when: "Jun 4 09:20" },
    { id: "p-8825", session: "b5f2c8d9", text: "Read the whole src/graph/ directory and map the module boundaries", cost: 3.04, tokens: 98700, cache: 0.33, model: "Opus 4", sidechain: false, when: "Jun 4 09:02" },
  ];

  // ---------- Cache analytics ----------
  const cache = {
    readRate: 0.71,
    creationTokens: 1_840_000,
    creation1h: 1_210_000,
    creation5m: 630_000,
    readTokens: 6_420_000,
    dollarsSaved: 38.40,
    wowDelta: +0.06,
  };

  // ---------- Tool / file heatmap ----------
  const files = [
    { path: "src/graph/explore.ts", calls: 47 },
    { path: "src/ingest/transcript.ts", calls: 38 },
    { path: "src/specs/link-verify.ts", calls: 31 },
    { path: "src/db/sqlite.ts", calls: 29 },
    { path: "src/mcp/server.ts", calls: 22 },
    { path: "src/auth.ts", calls: 17 },
    { path: "src/graph/layout.ts", calls: 14 },
    { path: "src/workflows/runner.ts", calls: 12 },
    { path: "src/cli/index.ts", calls: 11 },
    { path: "src/specs/parse.ts", calls: 9 },
    { path: "src/db/migrate.ts", calls: 8 },
    { path: "src/pricing.ts", calls: 6 },
    { path: "src/graph/render.tsx", calls: 6 },
    { path: "src/util/fuzzy.ts", calls: 5 },
    { path: "src/ingest/watch.ts", calls: 4 },
    { path: "src/specs/types.ts", calls: 3 },
    { path: "test/explore.test.ts", calls: 3 },
    { path: "src/cli/status.ts", calls: 2 },
    { path: "src/util/log.ts", calls: 2 },
    { path: "README.md", calls: 1 },
  ];

  const tools = [
    { name: "Read", calls: 184, tokens: 1_420_000 },
    { name: "Bash", calls: 96,  tokens: 2_180_000 },
    { name: "Edit", calls: 74,  tokens: 310_000 },
    { name: "Grep", calls: 61,  tokens: 1_640_000 },
    { name: "Write", calls: 28, tokens: 140_000 },
    { name: "specship_explore", calls: 22, tokens: 96_000 },
    { name: "specship_search", calls: 17, tokens: 41_000 },
    { name: "Task", calls: 9,   tokens: 720_000 },
  ];

  const subagents = [
    { name: "drift-detector", calls: 14, tokens: 410_000 },
    { name: "spec-implementer", calls: 9, tokens: 1_120_000 },
    { name: "test-writer", calls: 6, tokens: 280_000 },
    { name: "link-verifier", calls: 5, tokens: 96_000 },
  ];

  // ---------- Tips ----------
  const tips = [
    {
      id: "t1", severity: "error", icon: "Wrench",
      title: "You read auth.ts 17× last session — one specship_explore covers it",
      why: "Re-reading the same file burns input tokens every turn and the model still rebuilds the same mental map. A single structural query returns callers, callees and linked specs at once.",
      evidence: { session: "7b2e0a44", detail: "Read(src/auth.ts) ×17 · 22.8k tokens each" },
      fix: "specship_explore --symbol validateSession --depth 2",
      saving: "~$2.10 / session",
    },
    {
      id: "t2", severity: "error", icon: "Wrench",
      title: "Bash(grep) returned 82k tokens — specship_search does it in 600",
      why: "Raw grep dumps every matching line into context. The graph already indexes call sites, so a search returns just the qualified symbols and their files.",
      evidence: { session: "7b2e0a44", detail: "Bash(grep -rn parseTranscript) → 82,400 tokens" },
      fix: "specship_search 'parseTranscript' --kind call-site",
      saving: "~$1.40 / call",
    },
    {
      id: "t3", severity: "warn", icon: "Database",
      title: "Cache miss rate on evening sessions is 91%",
      why: "Your prefix changes every turn, so the cached block is invalidated. Pinning a stable system-prompt prefix would let the 1h cache absorb most of your input.",
      evidence: { session: "1a7d4e90", detail: "9 of 10 prompts: cache_read = 0 tokens" },
      fix: "Pin a stable prefix in .claude/settings.json",
      saving: "~$6.80 / week",
    },
    {
      id: "t4", severity: "warn", icon: "AlertTriangle",
      title: "REQ-INGEST-004 drifted — code changed, spec link stale",
      why: "incremental-tailing was refactored in the last session but its spec link still points at the old offset logic. Verifying now keeps the drift queue clean.",
      evidence: { session: "f04a8b13", detail: "src/ingest/transcript.ts:tailFrom moved 41 lines" },
      fix: "specship spec-fix REQ-INGEST-004",
      saving: "drift −1",
    },
    {
      id: "t5", severity: "info", icon: "Bot",
      title: "spec-implementer subagent used 1.1M tokens across 9 calls",
      why: "Most of that was re-reading the plan artifact. Passing the plan path instead of inlining it would cut subagent input roughly in half.",
      evidence: { session: "a3f9c1d2", detail: "Task(spec-implementer) avg 124k input tokens" },
      fix: "Use --plan-ref instead of inlining plan.md",
      saving: "~$3.20 / run",
    },
    {
      id: "t6", severity: "info", icon: "Database",
      title: "Opus is doing work Sonnet could handle",
      why: "11 of your last 34 Opus prompts were straightforward file reads and edits. Routing those to Sonnet keeps quality and trims cost.",
      evidence: { session: "a3f9c1d2", detail: "11 read/edit-only prompts on Opus 4" },
      fix: "Set model: sonnet for read/edit turns",
      saving: "~$4.50 / session",
    },
  ];

  // ---------- Specs ----------
  const specDocs = [
    {
      path: "specs/auth.md", title: "Authentication",
      reqs: [
        { id: "REQ-AUTH-001", title: "Validate session token on every request", kind: "requirement", priority: "P0", state: "verified", drift: null, owner: "selva.e", verifiedAt: "2h ago",
          body: "The server MUST validate the session token on every authenticated request. Tokens are signed JWTs; validation checks signature, expiry, and the revocation list before any handler runs.",
          rationale: "An unvalidated token is an open door. Centralising the check in `validateSession` keeps every route honest and gives the indexer a single anchor to link against.",
          acceptance: [
            { id: "A1", state: "verified", text: "Every authenticated route calls `validateSession` before its handler." },
            { id: "A2", state: "verified", text: "Tokens with an invalid signature are rejected with `401`." },
            { id: "A3", state: "verified", text: "Revoked tokens stop working within `5s` of revocation." },
          ],
          links: [{ state: "verified", axis: null, target: "src/auth.ts:validateSession", prov: "tree-sitter" }] },
        { id: "REQ-AUTH-005", title: "Reject expired tokens with 401", kind: "requirement", priority: "P0", state: "drifted", drift: "code", owner: "selva.e", verifiedAt: "drift 1d ago",
          body: "Expired tokens MUST return `401` with a machine-readable `code: token_expired`. The clock-skew tolerance SHOULD be 30 seconds so briefly-stale clients are not punished.",
          acceptance: [
            { id: "A1", state: "verified", text: "An expired token returns HTTP `401`." },
            { id: "A2", state: "drifted", text: "The response body carries `code: token_expired` — current code returns a bare string." },
            { id: "A3", state: "pending", text: "Tokens within 30s of expiry under clock skew are still accepted." },
          ],
          links: [{ state: "drifted", axis: "code", target: "src/auth.ts:checkExpiry", prov: "tree-sitter" }] },
        { id: "REQ-AUTH-009", title: "Rotate signing keys without downtime", kind: "requirement", priority: "P1", state: "implementing", drift: null, owner: "marin.k", verifiedAt: "in progress",
          body: "Key rotation MUST accept both the old and new key for a grace window. No in-flight request SHOULD fail during rotation, and the window MAY be tuned per environment.",
          acceptance: [
            { id: "A1", state: "implementing", text: "Both old and new keys verify tokens during the grace window." },
            { id: "A2", state: "pending", text: "Zero requests fail across a live rotation in the soak test." },
            { id: "A3", state: "pending", text: "Grace window is configurable via `AUTH_KEY_GRACE`." },
          ],
          links: [{ state: "implementing", axis: null, target: "src/auth.ts:keyset", prov: "synthesized" }] },
      ],
    },
    {
      path: "specs/ingest.md", title: "Transcript ingest",
      reqs: [
        { id: "REQ-INGEST-004", title: "Incremental JSONL tailing", kind: "requirement", priority: "P0", state: "drifted", drift: "code", owner: "selva.e", verifiedAt: "drift 3h ago",
          body: "The ingester MUST tail `*.jsonl` transcripts incrementally, resuming from the last byte offset. It MUST NOT re-parse the whole file on each poll.",
          rationale: "Sessions reach hundreds of MB. Re-parsing on every poll is what spiked indexer cost on Jun 4 — incremental tailing keeps steady-state CPU flat.",
          acceptance: [
            { id: "A1", state: "drifted", text: "Polling resumes from the stored byte offset — current code re-reads from `0`." },
            { id: "A2", state: "verified", text: "A poll with no new bytes does zero parse work." },
            { id: "A3", state: "pending", text: "File truncation or rotation is detected and re-seeded safely." },
          ],
          links: [{ state: "drifted", axis: "code", target: "src/ingest/transcript.ts:tailFrom", prov: "tree-sitter" }] },
        { id: "REQ-INGEST-007", title: "Attribute subagent cost via isSidechain", kind: "requirement", priority: "P1", state: "verified", drift: null, owner: "marin.k", verifiedAt: "1d ago",
          body: "Per-prompt cost MUST split by `isSidechain` so subagent spend is attributable in the heatmap.",
          acceptance: [
            { id: "A1", state: "verified", text: "Each prompt's cost is tagged `main` or `sidechain`." },
            { id: "A2", state: "verified", text: "The heatmap can filter spend to subagent turns only." },
          ],
          links: [{ state: "verified", axis: null, target: "src/ingest/transcript.ts:splitSidechain", prov: "tree-sitter" }] },
      ],
    },
    {
      path: "specs/graph.md", title: "Graph explorer",
      reqs: [
        { id: "REQ-GRAPH-002", title: "Hierarchical + force layout modes", kind: "requirement", priority: "P1", state: "implemented", drift: null, owner: "selva.e", verifiedAt: "awaiting verify",
          body: "The graph view MUST support hierarchical (Dagre) and force-directed layouts, toggled from the toolbar. The chosen mode SHOULD persist across sessions.",
          acceptance: [
            { id: "A1", state: "verified", text: "Dagre hierarchical layout renders without overlapping edges." },
            { id: "A2", state: "verified", text: "Force-directed layout settles within 2s for graphs under 1k nodes." },
            { id: "A3", state: "implementing", text: "The toolbar toggle persists the chosen mode to local settings." },
          ],
          links: [{ state: "implemented", axis: null, target: "src/graph/layout.ts:applyLayout", prov: "tree-sitter" }] },
        { id: "REQ-GRAPH-006", title: "Lazy-render beyond 5k nodes", kind: "requirement", priority: "P2", state: "broken", drift: null, owner: "marin.k", verifiedAt: "broke 6h ago",
          body: "Above 5,000 nodes the renderer MUST cull to the viewport plus 1-hop neighbours. Panning SHOULD stay above 50fps at 20k nodes.",
          rationale: "Drawing every node past ~5k drops the canvas to single-digit frames. Viewport culling is the difference between a usable graph and a frozen tab.",
          acceptance: [
            { id: "A1", state: "broken", text: "Only nodes inside the viewport + 1-hop are mounted — `cull` currently throws on empty viewports." },
            { id: "A2", state: "broken", text: "Off-screen nodes are unmounted, not just hidden." },
            { id: "A3", state: "pending", text: "Pan holds ≥50fps on the 20k-node fixture." },
          ],
          links: [{ state: "broken", axis: null, target: "src/graph/render.tsx:cull", prov: "synthesized" }] },
        { id: "REQ-GRAPH-009", title: "Fuzzy symbol search", kind: "requirement", priority: "P2", state: "orphaned", drift: null, owner: "—", verifiedAt: "no code yet",
          body: "Typing in the search box MUST fuzzy-match symbol names live, with no Enter required. Results SHOULD rank exact prefix matches first.",
          acceptance: [
            { id: "A1", state: "pending", text: "Matches update on each keystroke with no submit." },
            { id: "A2", state: "pending", text: "Prefix matches rank above mid-string matches." },
          ],
          links: [] },
      ],
    },
    {
      path: "specs/pricing.md", title: "Pricing",
      reqs: [
        { id: "REQ-PRICE-001", title: "Editable per-model price table", kind: "requirement", priority: "P1", state: "verified", drift: null, owner: "selva.e", verifiedAt: "5d ago",
          body: "Users MUST be able to override Anthropic per-model prices in settings; cost rollups MUST use the override when present and fall back to the bundled defaults otherwise.",
          acceptance: [
            { id: "A1", state: "verified", text: "A per-model override entered in settings is persisted." },
            { id: "A2", state: "verified", text: "Cost rollups recompute against the override immediately." },
          ],
          links: [{ state: "verified", axis: null, target: "src/pricing.ts:resolveRate", prov: "tree-sitter" }] },
      ],
    },
  ];

  // Flatten drift links
  const driftLinks = [];
  specDocs.forEach((d) => d.reqs.forEach((r) => r.links.forEach((l) => {
    if (["drifted", "broken", "orphaned"].includes(l.state) || r.state === "orphaned") {
      driftLinks.push({ state: r.state === "orphaned" ? "orphaned" : l.state, specId: r.id, specTitle: r.title, target: l.target || "—", axis: l.axis, prov: l.prov || "—", age: "" });
    }
  })));
  // orphan with no link
  driftLinks.push({ state: "orphaned", specId: "REQ-GRAPH-009", specTitle: "Fuzzy symbol search", target: "—", axis: null, prov: "—", age: "4d" });
  const driftAges = ["2h", "1d", "3d", "5h", "6d", "2d", "4d"];
  driftLinks.forEach((l, i) => l.age = l.age || driftAges[i % driftAges.length]);

  // ---------- Graph (code + spec + route + test nodes) ----------
  // Hand-placed positions for a believable hierarchical-ish layout.
  const graphNodes = [
    { id: "n_server", label: "MCPServer", kind: "code", sub: "class", lang: "ts", file: "src/mcp/server.ts:18", x: 40,  y: 30 },
    { id: "n_route_explore", label: "/explore", kind: "route", sub: "route", lang: "ts", file: "src/mcp/server.ts:64", x: 40, y: 150 },
    { id: "n_explore", label: "exploreGraph", kind: "code", sub: "function", lang: "ts", file: "src/graph/explore.ts:22", x: 250, y: 150 },
    { id: "n_layout", label: "applyLayout", kind: "code", sub: "function", lang: "ts", file: "src/graph/layout.ts:40", x: 470, y: 90 },
    { id: "n_cull", label: "cull", kind: "code", sub: "function", lang: "ts", file: "src/graph/render.tsx:88", x: 470, y: 200 },
    { id: "n_db", label: "SqliteStore", kind: "code", sub: "class", lang: "ts", file: "src/db/sqlite.ts:12", x: 250, y: 300 },
    { id: "n_query", label: "neighbors", kind: "code", sub: "method", lang: "ts", file: "src/db/sqlite.ts:140", x: 470, y: 320 },
    { id: "n_ingest", label: "tailFrom", kind: "code", sub: "function", lang: "ts", file: "src/ingest/transcript.ts:51", x: 60, y: 300 },
    { id: "n_split", label: "splitSidechain", kind: "code", sub: "function", lang: "ts", file: "src/ingest/transcript.ts:120", x: 60, y: 410 },
    { id: "n_auth", label: "validateSession", kind: "code", sub: "function", lang: "ts", file: "src/auth.ts:34", x: 260, y: 430 },
    { id: "n_expiry", label: "checkExpiry", kind: "code", sub: "function", lang: "ts", file: "src/auth.ts:78", x: 470, y: 440 },
    { id: "n_price", label: "resolveRate", kind: "code", sub: "function", lang: "ts", file: "src/pricing.ts:20", x: 680, y: 360 },
    // tests
    { id: "n_test_explore", label: "explore.test", kind: "test", sub: "test", lang: "ts", file: "test/explore.test.ts:1", x: 690, y: 150 },
    { id: "n_test_auth", label: "auth.test", kind: "test", sub: "test", lang: "ts", file: "test/auth.test.ts:1", x: 680, y: 470 },
    // specs
    { id: "spec:REQ-GRAPH-002", label: "REQ-GRAPH-002", kind: "spec", sub: "requirement", state: "implemented", file: "specs/graph.md", x: 690, y: 40 },
    { id: "spec:REQ-AUTH-005", label: "REQ-AUTH-005", kind: "spec", sub: "requirement", state: "drifted", file: "specs/auth.md", x: 690, y: 540 },
    { id: "spec:REQ-INGEST-004", label: "REQ-INGEST-004", kind: "spec", sub: "requirement", state: "drifted", file: "specs/ingest.md", x: 60, y: 510 },
    { id: "spec:REQ-PRICE-001", label: "REQ-PRICE-001", kind: "spec", sub: "requirement", state: "verified", file: "specs/pricing.md", x: 880, y: 360 },
  ];
  const graphEdges = [
    { from: "n_server", to: "n_route_explore", kind: "extracted" },
    { from: "n_route_explore", to: "n_explore", kind: "extracted" },
    { from: "n_explore", to: "n_layout", kind: "extracted" },
    { from: "n_explore", to: "n_cull", kind: "synth" },
    { from: "n_explore", to: "n_db", kind: "extracted" },
    { from: "n_db", to: "n_query", kind: "extracted" },
    { from: "n_layout", to: "n_query", kind: "synth" },
    { from: "n_server", to: "n_ingest", kind: "extracted" },
    { from: "n_ingest", to: "n_split", kind: "extracted" },
    { from: "n_auth", to: "n_expiry", kind: "extracted" },
    { from: "n_db", to: "n_auth", kind: "synth" },
    { from: "n_query", to: "n_price", kind: "extracted" },
    { from: "n_test_explore", to: "n_explore", kind: "extracted" },
    { from: "n_test_auth", to: "n_auth", kind: "extracted" },
    { from: "spec:REQ-GRAPH-002", to: "n_layout", kind: "extracted" },
    { from: "spec:REQ-AUTH-005", to: "n_expiry", kind: "extracted" },
    { from: "spec:REQ-INGEST-004", to: "n_ingest", kind: "extracted" },
    { from: "spec:REQ-PRICE-001", to: "n_price", kind: "extracted" },
  ];

  // ---------- Workflows ----------
  const workflows = [
    { id: "spec-implement", name: "spec-implement", scope: "bundled", desc: "Plan and implement a requirement in an isolated worktree, then open a diff for review.", tags: ["spec","code"], requires: ["git","claude"], inputs: [{ name: "SPEC_ID", required: true }] },
    { id: "spec-verify", name: "spec-verify", scope: "bundled", desc: "Re-verify every link for a spec and report drift.", tags: ["spec","verify"], requires: ["claude"], inputs: [{ name: "SPEC_ID", required: true }] },
    { id: "spec-fix", name: "spec-fix", scope: "bundled", desc: "Repair a drifted link by updating code or the link record after review.", tags: ["spec","drift"], requires: ["git","claude"], inputs: [{ name: "SPEC_ID", required: true }] },
    { id: "reindex-deep", name: "reindex-deep", scope: "global", desc: "Full tree-sitter re-parse and edge re-synthesis across the project.", tags: ["index"], requires: ["tree-sitter"], inputs: [] },
    { id: "cost-report", name: "cost-report", scope: "project", desc: "Generate a weekly cost report grouped by project and model.", tags: ["analytics"], requires: ["claude"], inputs: [{ name: "RANGE", required: false }] },
  ];

  const runNodes = [
    { id: "r_plan", label: "plan", type: "agent", state: "completed", x: 40, y: 70 },
    { id: "r_impl", label: "implement", type: "agent", state: "completed", x: 220, y: 70 },
    { id: "r_test", label: "run tests", type: "shell", state: "completed", x: 400, y: 70 },
    { id: "r_gate", label: "review diff", type: "approval", state: "paused", x: 580, y: 70 },
    { id: "r_verify", label: "verify links", type: "agent", state: "pending", x: 760, y: 30 },
    { id: "r_merge", label: "merge worktree", type: "shell", state: "pending", x: 760, y: 120 },
  ];
  const runEdges = [
    { from: "r_plan", to: "r_impl" }, { from: "r_impl", to: "r_test" },
    { from: "r_test", to: "r_gate" }, { from: "r_gate", to: "r_verify" }, { from: "r_gate", to: "r_merge" },
  ];
  const runEvents = [
    { t: "15:31:02", kind: "step_started", node: "plan", text: "Planning REQ-AUTH-005 implementation" },
    { t: "15:31:14", kind: "tool_called", node: "plan", text: "specship_explore(validateSession)" },
    { t: "15:31:48", kind: "artifact_created", node: "plan", text: "plan.md (1.2kb)" },
    { t: "15:31:49", kind: "step_completed", node: "plan", text: "plan complete · $0.41" },
    { t: "15:31:50", kind: "step_started", node: "implement", text: "Editing src/auth.ts" },
    { t: "15:32:31", kind: "tool_called", node: "implement", text: "Edit(src/auth.ts:78)" },
    { t: "15:33:02", kind: "artifact_created", node: "implement", text: "diff.md (3.4kb)" },
    { t: "15:33:03", kind: "step_completed", node: "implement", text: "implement complete · $1.88" },
    { t: "15:33:04", kind: "step_started", node: "run tests", text: "vitest run test/auth.test.ts" },
    { t: "15:33:40", kind: "artifact_created", node: "run tests", text: "test_results.md — 12 passed" },
    { t: "15:33:41", kind: "step_completed", node: "run tests", text: "tests passed" },
    { t: "15:33:42", kind: "approval_requested", node: "review diff", text: "Awaiting approval to merge worktree" },
  ];

  const runs = [
    { id: "9f3a2b1c", workflow: "spec-implement", status: "paused", duration: "2m 39s", cost: 2.29, worktree: ".cg/wt/9f3a2b", artifacts: 3, when: "now" },
    { id: "7c1e8d04", workflow: "spec-verify", status: "completed", duration: "48s", cost: 0.62, worktree: ".cg/wt/7c1e8d", artifacts: 1, when: "12m ago" },
    { id: "2b9f6a37", workflow: "reindex-deep", status: "running", duration: "1m 12s", cost: 0.00, worktree: "—", artifacts: 0, when: "now" },
    { id: "5d0c4e82", workflow: "spec-fix", status: "failed", duration: "1m 04s", cost: 0.88, worktree: ".cg/wt/5d0c4e", artifacts: 2, when: "1h ago" },
    { id: "a8e2f190", workflow: "cost-report", status: "completed", duration: "31s", cost: 0.34, worktree: "—", artifacts: 1, when: "3h ago" },
    { id: "1f7b3c66", workflow: "spec-implement", status: "cancelled", duration: "22s", cost: 0.12, worktree: ".cg/wt/1f7b3c", artifacts: 0, when: "yest" },
  ];

  // ---------- Chat seed ----------
  const chatSeed = [
    { role: "user", text: "/cg-spec REQ-AUTH-005" },
    { role: "assistant", text: "**REQ-AUTH-005 — Reject expired tokens with 401** · `P0` · state `drifted`\n\nThe linked symbol `src/auth.ts:checkExpiry` moved 41 lines since the link was set. The code still returns 401 but the `code: token_expired` field was renamed to `reason`. That's the drift.",
      tools: [{ name: "specship_spec", status: "ok", input: "REQ-AUTH-005", output: "1 link · drifted (code axis)" }],
      cost: 0.21, tokens: 7100 },
    { role: "user", text: "Can you fix the drift?" },
    { role: "assistant", text: "I can kick off the `spec-fix` workflow for REQ-AUTH-005. It will open an isolated worktree, restore the `code: token_expired` field, re-run `test/auth.test.ts`, and pause for your approval before merging. Want me to start it?",
      tools: [{ name: "specship_link_verify", status: "ok", input: "REQ-AUTH-005", output: "drift confirmed: field rename" }],
      cost: 0.18, tokens: 6200 },
  ];

  // ---------- Memory (CLAUDE.md hierarchy) ----------
  const memoryLevels = {
    enterprise: { label: "Managed", color: "#E5A50A", soft: "rgba(229,165,10,0.14)", desc: "Organization policy \u00b7 cannot be overridden" },
    user:       { label: "User",    color: "#29D2BE", soft: "rgba(41,210,190,0.14)", desc: "Personal \u00b7 applies to every project" },
    project:    { label: "Project", color: "#5B93F2", soft: "rgba(91,147,242,0.14)", desc: "Team-shared \u00b7 checked into the repo" },
    subdir:     { label: "Directory", color: "#A586F5", soft: "rgba(165,134,245,0.14)", desc: "Scoped to a subtree \u00b7 loaded when cwd is inside" },
    import:     { label: "Import",  color: "#7B8696", soft: "rgba(123,134,150,0.12)", desc: "Pulled in via @path reference" },
  };
  const memoryFiles = [
    {
      id: "m-ent", level: "enterprise", name: "CLAUDE.md", scope: "managed", readOnly: true,
      path: "/Library/Application Support/ClaudeCode/CLAUDE.md", tokens: 210, lines: 9, modified: "managed",
      body: "# Engineering policy (managed)\n\n- All code must pass `pnpm lint` and `pnpm typecheck` before commit.\n- Never commit secrets, API keys, or `.env` files.\n- Prefer dependency-free solutions; new deps require review.\n- Validate all external input at trust boundaries.\n- Production logs must not contain user content.",
    },
    {
      id: "m-user", level: "user", name: "CLAUDE.md", scope: "~/.claude", readOnly: false,
      path: "~/.claude/CLAUDE.md", tokens: 280, lines: 12, modified: "3d ago",
      body: "# Personal preferences\n\n- Before reading a file, try `codegraph_explore` for structure first.\n- Use conventional commits (`feat:`, `fix:`, `chore:`).\n- Prefer `rg` over `grep`, `fd` over `find`.\n- Keep responses terse \u2014 show diffs, not whole files.\n- Editor open command: `cursor`.\n- Default model for read/edit turns: Sonnet.",
    },
    {
      id: "m-proj", level: "project", name: "CLAUDE.md", scope: "project root", readOnly: false,
      path: "~/dev/specship/CLAUDE.md", tokens: 760, lines: 28, modified: "2h ago",
      body: "# SpecShip \u2014 project memory\n\n## Architecture\n- Electron + React renderer in `packages/web`.\n- MCP server in `src/mcp`, graph engine in `src/graph`.\n- SQLite via better-sqlite3; migrations in `src/db/migrate.ts`.\n\n## Commands\n- `pnpm dev` \u2014 renderer + MCP in watch mode.\n- `pnpm test` \u2014 vitest; `pnpm test:e2e` \u2014 playwright.\n- `pnpm reindex` \u2014 rebuild the knowledge graph.\n\n## Conventions\n- Spec IDs are stable: `REQ-<AREA>-<NNN>`.\n- Never edit generated files under `src/graph/_gen`.\n\n@docs/conventions.md\n@specs/STYLE.md",
      imports: ["m-imp-conv", "m-imp-style"],
    },
    {
      id: "m-sub", level: "subdir", name: "CLAUDE.md", scope: "src/graph", readOnly: false,
      path: "~/dev/specship/src/graph/CLAUDE.md", tokens: 190, lines: 7, modified: "1d ago",
      body: "# Graph engine notes\n\n- Layout runs in a worker \u2014 keep `applyLayout` pure.\n- Node positions are cached by content hash.\n- Above 5k nodes, cull to viewport + 1-hop (REQ-GRAPH-006).\n- Synthesized edges are dashed; never persist them.",
    },
    {
      id: "m-imp-conv", level: "import", name: "conventions.md", scope: "@import", readOnly: false,
      path: "docs/conventions.md", tokens: 120, lines: 6, modified: "5d ago", importedBy: "m-proj",
      body: "# Conventions\n\n- One component per file; co-locate styles.\n- Name event handlers `onX`; booleans `isX`/`hasX`.\n- No default exports in shared modules.",
    },
    {
      id: "m-imp-style", level: "import", name: "STYLE.md", scope: "@import", readOnly: false,
      path: "specs/STYLE.md", tokens: 100, lines: 5, modified: "5d ago", importedBy: "m-proj",
      body: "# Spec style\n\n- Requirements use MUST / SHOULD / MAY.\n- Each requirement gets one acceptance block.\n- Keep titles under 8 words.",
    },
  ];
  const memory = (function () {
    // memory TYPE is orthogonal to level: what KIND of memory this is
    const types = {
      instruction: { label: "Instructions", color: "#5B93F2", soft: "rgba(91,147,242,0.14)", icon: "memory", desc: "Directives & rules from CLAUDE.md" },
      note:        { label: "Notes",        color: "#46C26B", soft: "rgba(70,194,107,0.14)", icon: "tips",   desc: "Facts the agent saved via the memory tool" },
      import:      { label: "Imports",      color: "#29D2BE", soft: "rgba(41,210,190,0.14)", icon: "external", desc: "Files pulled in via @path" },
    };
    // agent-written notes — the memory tool persists learned facts under ~/.claude/memory
    const memoryNotes = [
      { id: "n-build", level: "note", name: "build-system.md", scope: "memory tool", path: "~/.claude/memory/build-system.md", tokens: 64, lines: 4, modified: "today 14:31", session: "a3f9c1d2", tags: ["build", "tooling"],
        body: "# Build system\n\n- Package manager is **pnpm**, never npm.\n- `pnpm dev` runs renderer + MCP in watch mode.\n- Run `pnpm reindex` after any schema change." },
      { id: "n-auth", level: "note", name: "auth-jwt.md", scope: "memory tool", path: "~/.claude/memory/auth-jwt.md", tokens: 58, lines: 4, modified: "today 15:38", session: "a3f9c1d2", tags: ["auth", "REQ-AUTH-005"],
        body: "# Auth model\n\n- Session tokens are signed **JWTs**.\n- `checkExpiry` tolerates 30s clock skew (REQ-AUTH-005).\n- Expired tokens return 401 with `code: token_expired`." },
      { id: "n-graph", level: "note", name: "graph-perf.md", scope: "memory tool", path: "~/.claude/memory/graph-perf.md", tokens: 52, lines: 4, modified: "yest 16:44", session: "f04a8b13", tags: ["graph", "perf"],
        body: "# Graph performance\n\n- Above 5k nodes, layout culls to viewport + 1-hop.\n- `applyLayout` must stay pure (runs in a worker).\n- Node positions cached by content hash." },
      { id: "n-cost", level: "note", name: "cost-prefs.md", scope: "memory tool", path: "~/.claude/memory/cost-prefs.md", tokens: 44, lines: 3, modified: "Jun 4 09:20", session: "b5f2c8d9", tags: ["cost", "model"],
        body: "# Cost preferences\n\n- Route read/edit-only turns to Sonnet.\n- Pin a stable system-prompt prefix to keep the 1h cache warm." },
    ];
    memoryFiles.forEach((f) => { f.type = f.level === "import" ? "import" : "instruction"; });
    memoryNotes.forEach((n) => { n.type = "note"; n.readOnly = false; });
    const all = memoryFiles.concat(memoryNotes);
    memoryLevels.note = { label: "Notes", color: "#46C26B", soft: "rgba(70,194,107,0.14)", desc: "Agent-written \u00b7 memory tool" };
    return {
      levels: memoryLevels,
      types,
      files: all,
      totalTokens: all.reduce((a, b) => a + b.tokens, 0),
      instructionCount: all.filter((f) => f.type === "instruction").length,
      noteCount: all.filter((f) => f.type === "note").length,
      importCount: all.filter((f) => f.type === "import").length,
      // precedence order for the merged instruction view (managed policy is authoritative)
      order: ["enterprise", "project", "subdir", "import", "user"],
    };
  })();

  window.DATA = {
    fmt$, fmtK, status, projects, costSeries, byModel, sessions, prompts, cache,
    files, tools, subagents, tips, specDocs, driftLinks, graphNodes, graphEdges,
    workflows, runNodes, runEdges, runEvents, runs, chatSeed, memory,
  };
})();
