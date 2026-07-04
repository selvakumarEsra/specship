// Shared metadata for the SpecShip blog. The index + each article's
// "Keep reading" grid both render from this list, so titles/categories
// stay in sync. Article bodies live in src/pages/blog/<slug>.astro.

export interface BlogPost {
  slug: string;
  cat: string;        // filter key
  catLabel: string;   // display label
  catColor: string;   // CSS color (token or hex)
  title: string;
  dek: string;
  date: string;       // human date
  read: string;       // "9 min"
  tags: string[];
  feat?: boolean;     // featured (spans 2 cols on the index)
  thumbBg: string;    // rgba tint behind the thumb art
  thumb: string;      // inner SVG markup for the card thumbnail
}

const grid = '<div class="thumb-grid"></div>';

// Art-deco status-line motif: a row of gold parallelogram segments (filled →
// dim) flanked by diamond ornaments — the same shapes the segment renders.
const slBars = (() => {
  let s = '';
  for (let i = 0; i < 10; i++) {
    const x = i * 18;
    const fill = i < 6 ? '#E5A50A' : 'rgba(229,165,10,0.22)';
    s += `<path d="M${x} 0 L${x + 11} 0 L${x + 5} 24 L${x - 6} 24 Z" fill="${fill}"/>`;
  }
  return s;
})();
const statuslineThumb = `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(229,165,10,0.08)"/><path d="M70 100 L80 88 L90 100 L80 112 Z" fill="#E5A50A"/><path d="M286 100 L296 88 L306 100 L296 112 Z" fill="#E5A50A"/><g transform="translate(104,88)">${slBars}</g></svg>`;

// Door-arch motif: a rounded archway (the "door") with the tools behind it,
// tinted to the door's accent. Shared shape, different contents per door.
const doorArch = (stroke: string) =>
  `<path d="M120 172 V96 A60 60 0 0 1 240 96 V172" fill="none" stroke="${stroke}" stroke-width="2"/>`;

export const posts: BlogPost[] = [
  {
    slug: 'lean-dashboard',
    cat: 'dashboard', catLabel: 'Dashboard', catColor: '#5B93F2',
    title: 'A dashboard that installs anywhere: retiring Angular for server-rendered HTML',
    dek: 'The desktop dashboard shipped ~640 npm packages — bleeding-edge Angular, a 73 MB code editor, native build tooling — and choked behind locked-down enterprise registries. We replaced it with a server-rendered UI that ships inside the server itself: well under 250 mainstream packages, no native builds, the same look.',
    date: 'Jul 4, 2026', read: '7 min', feat: true,
    tags: ['#dashboard', '#ssr', '#enterprise', '#dependencies'],
    thumbBg: 'rgba(91,147,242,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(91,147,242,0.08)"/><rect x="92" y="44" width="58" height="126" rx="6" fill="rgba(248,81,73,0.38)"/><text x="121" y="34" fill="rgba(214,130,130,0.95)" font-family="Geist Mono, monospace" font-size="15" text-anchor="middle">~640</text><rect x="210" y="118" width="58" height="52" rx="6" fill="rgba(70,194,107,0.55)"/><text x="239" y="108" fill="rgba(120,210,150,0.95)" font-family="Geist Mono, monospace" font-size="15" text-anchor="middle">&lt;250</text><path d="M158 100 L204 128" stroke="rgba(150,165,200,0.4)" stroke-width="2" fill="none" stroke-dasharray="5 5"/></svg>`,
  },
  {
    slug: 'reads-door',
    cat: 'doors', catLabel: 'Doors', catColor: '#29D2BE',
    title: 'The reads door: one entrance for every “understand the code” question',
    dek: 'Explore an area, trace a flow across dynamic-dispatch hops grep can’t follow, or get a change’s blast radius — through a single door. You name the symbols; the graph hands back their source, already Read. Six tools, one entrance, and the agent never has to pick.',
    date: 'Jul 1, 2026', read: '9 min', feat: true,
    tags: ['#doors', '#retrieval', '#explore', '#impact'],
    thumbBg: 'rgba(41,210,190,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(41,210,190,0.09)"/>${doorArch('rgba(41,210,190,0.55)')}<g stroke="rgba(150,165,200,0.35)" stroke-width="1.4" fill="none"><path d="M150 150 L180 110 L210 140"/></g><circle cx="150" cy="150" r="7" fill="#5B93F2"/><circle cx="180" cy="110" r="8" fill="#29D2BE"/><circle cx="210" cy="140" r="7" fill="#46C26B"/></svg>`,
  },
  {
    slug: 'intent-door',
    cat: 'doors', catLabel: 'Doors', catColor: '#A586F5',
    title: 'The intent door: from a one-line idea to shipped, linked code',
    dek: 'Browse the spec funnel, author or fast-path a requirement, implement it in an isolated worktree, review it against a rubric, triage a bug to the spec it belongs to, or capture a domain fact — all behind one door. Intent becomes a first-class artifact, and the spec is the contract.',
    date: 'Jul 1, 2026', read: '10 min', feat: true,
    tags: ['#doors', '#specs', '#workflows', '#requirements'],
    thumbBg: 'rgba(165,134,245,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(165,134,245,0.09)"/>${doorArch('rgba(165,134,245,0.55)')}<rect x="158" y="104" width="44" height="54" rx="6" fill="rgba(165,134,245,0.85)"/><path d="M166 118 h28 M166 128 h28 M166 138 h18" stroke="#12161E" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
  {
    slug: 'gate-door',
    cat: 'doors', catLabel: 'Doors', catColor: '#F2555A',
    title: 'The gate door: the checkpoint your agent has to pass',
    dek: 'Run the enforcement gate, work the drift queue, repair a broken spec↔code link, and read graph-derived code health — one door that keeps intent and code honest. Drift is a signal, not a failure, and the gate only bites when you ask it to.',
    date: 'Jul 1, 2026', read: '9 min',
    tags: ['#doors', '#drift', '#maintainability', '#ci'],
    thumbBg: 'rgba(242,85,90,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(242,85,90,0.08)"/>${doorArch('rgba(242,85,90,0.5)')}<path d="M180 100 L206 110 V134 C206 152 194 160 180 166 C166 160 154 152 154 134 V110 Z" fill="none" stroke="rgba(150,165,200,0.4)" stroke-width="1.6"/><path d="M168 132 L177 142 L194 120" fill="none" stroke="#46C26B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    slug: 'prompt-quality',
    cat: 'claude-code', catLabel: 'Claude Code', catColor: '#5B93F2',
    title: 'A quality score for the way you prompt your agent',
    dek: 'Two prompts asking for the same change can cost 10× apart. SpecShip now grades every prompt in a session — does it name a concrete target, is it scoped, is it cache-friendly, did it go structural or brute-force — and hands you the one-line fix. Rule-based, no LLM, and it never invents a number it can’t measure.',
    date: 'Jun 30, 2026', read: '6 min', feat: true,
    tags: ['#claude-code', '#observability', '#prompting', '#honesty'],
    thumbBg: 'rgba(91,147,242,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(91,147,242,0.09)"/><g><circle cx="96" cy="78" r="10" fill="#46C26B"/><circle cx="156" cy="78" r="10" fill="#46C26B"/><circle cx="216" cy="78" r="10" fill="#46C26B"/><circle cx="276" cy="78" r="10" fill="none" stroke="#E5A50A" stroke-width="2.2"/></g><rect x="72" y="128" width="216" height="12" rx="6" fill="rgba(150,165,200,0.2)"/><rect x="72" y="128" width="168" height="12" rx="6" fill="#5B93F2"/></svg>`,
  },
  {
    slug: 'adoption-wedge',
    cat: 'product', catLabel: 'Product', catColor: '#46C26B',
    title: 'We made SpecShip smaller on purpose',
    dek: 'A first install used to hand you 17 commands and a spec workflow you never asked for. Now it gives you just the wedge — the agent exploring the index instead of re-reading files — and the spec-driven depth is one opt-in flag away.',
    date: 'Jun 28, 2026', read: '7 min', feat: true,
    tags: ['#adoption', '#onboarding', '#retrieval', '#dx'],
    thumbBg: 'rgba(70,194,107,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(70,194,107,0.09)"/><g><rect x="40" y="138" width="92" height="34" rx="9" fill="rgba(70,194,107,0.85)"/><rect x="134" y="98" width="92" height="34" rx="9" fill="rgba(91,147,242,0.7)"/><rect x="228" y="58" width="96" height="34" rx="9" fill="none" stroke="rgba(165,134,245,0.7)" stroke-width="1.6" stroke-dasharray="6 6"/></g><path d="M132 150 L134 118 M226 110 L228 78" stroke="rgba(150,165,200,0.32)" stroke-width="1.5" fill="none" stroke-dasharray="4 5"/></svg>`,
  },
  {
    slug: 'status-line',
    cat: 'statusline', catLabel: 'Status Line', catColor: '#E5A50A',
    title: 'A status line that refuses to lie about tokens saved',
    dek: 'Your status line is prime real estate — so what earns a spot? SpecShip’s segment shows index sync state, drift, and how many times it was actually called. Not “tokens saved”: that number has no honest source at runtime, so we don’t fake it.',
    date: 'Jun 28, 2026', read: '7 min', feat: true,
    tags: ['#status-line', '#claude-code', '#observability', '#honesty'],
    thumbBg: 'rgba(229,165,10,0.10)',
    thumb: statuslineThumb,
  },
  {
    slug: 'domain-knowledge',
    cat: 'domain', catLabel: 'Domain Knowledge', catColor: '#8B7BFF',
    title: 'The domain knowledge base that builds itself — your next hire’s shortcut',
    dek: 'On a large codebase, the “why” lives in people’s heads — the ubiquitous language, the rules, the decisions. SpecShip captures it as you work, links it to the specs and code it governs, and keeps it honest with drift. New team members read the domain, not the tribe.',
    date: 'Jun 26, 2026', read: '9 min', feat: true,
    tags: ['#domain-knowledge', '#onboarding', '#enterprise', '#ubiquitous-language'],
    thumbBg: 'rgba(139,123,255,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(139,123,255,0.09)"/><g stroke="rgba(150,165,200,0.3)" stroke-width="1.5" fill="none"><path d="M180 50 L180 100"/><path d="M180 100 L110 150"/><path d="M180 100 L250 150"/></g><rect x="138" y="36" width="84" height="28" rx="8" fill="rgba(139,123,255,0.9)"/><circle cx="180" cy="100" r="11" fill="#5B93F2"/><circle cx="110" cy="150" r="9" fill="#46C26B"/><circle cx="250" cy="150" r="9" fill="#A586F5"/><circle cx="58" cy="60" r="6" fill="#29D2BE"/><circle cx="300" cy="64" r="6" fill="#E5A50A"/></svg>`,
  },
  {
    slug: 'why-graphs',
    cat: 'graph', catLabel: 'Knowledge Graph', catColor: 'var(--node-spec)',
    title: 'Why we model codebases as graphs, not file trees',
    dek: 'A file tree tells you where code lives. It says nothing about what calls what, which test covers which function, or which requirement a symbol satisfies — exactly where agents waste their time.',
    date: 'Jun 21, 2026', read: '9 min', feat: true,
    tags: ['#knowledge-graph', '#tree-sitter', '#architecture', '#sqlite'],
    thumbBg: 'rgba(91,147,242,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(91,147,242,0.09)"/><g stroke="rgba(150,165,200,0.3)" stroke-width="1.5" fill="none"><path d="M60 140 L150 90 L240 60 L310 90"/><path d="M150 90 L160 150 L250 150"/><path d="M240 60 L250 150"/></g><circle cx="60" cy="140" r="7" fill="#29D2BE"/><circle cx="150" cy="90" r="11" fill="#A586F5"/><circle cx="240" cy="60" r="13" fill="#5B93F2"/><circle cx="240" cy="60" r="5.5" fill="#12161E"/><circle cx="310" cy="90" r="8" fill="#46C26B"/><circle cx="160" cy="150" r="9" fill="#46C26B"/><circle cx="250" cy="150" r="10" fill="#5B93F2"/></svg>`,
  },
  {
    slug: 'git-worktrees',
    cat: 'workflows', catLabel: 'Workflows', catColor: 'var(--accent)',
    title: 'Why every agent run gets its own git worktree',
    dek: 'Branches and stashes share one working tree; clones and containers are heavyweight. A git worktree is the sweet spot — a real isolated checkout that shares the repo, so a failed agent run never touches yours.',
    date: 'Jun 23, 2026', read: '8 min',
    tags: ['#git-worktree', '#isolation', '#workflows', '#safety'],
    thumbBg: 'rgba(91,147,242,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(91,147,242,0.08)"/><line x1="40" y1="72" x2="320" y2="72" stroke="rgba(150,165,200,0.3)" stroke-width="1.5"/><path d="M150 72 C172 72 180 124 202 124 L300 124" stroke="rgba(150,165,200,0.3)" stroke-width="1.5" fill="none"/><rect x="246" y="100" width="86" height="50" rx="9" fill="none" stroke="rgba(91,147,242,0.55)" stroke-width="1.4" stroke-dasharray="5 5"/><circle cx="80" cy="72" r="7" fill="#A586F5"/><circle cx="150" cy="72" r="9" fill="#5B93F2"/><circle cx="220" cy="72" r="7" fill="#46C26B"/><circle cx="290" cy="72" r="7" fill="#29D2BE"/><circle cx="289" cy="124" r="9" fill="#E5A50A"/></svg>`,
  },
  {
    slug: 'harness-engineering',
    cat: 'harness', catLabel: 'Harness Engineering', catColor: '#F2555A',
    title: 'The harness: maintainability, fitness, and a gate your agent must pass',
    dek: 'Letting an agent write code is easy. Stopping it from quietly rotting your architecture is the hard part. SpecShip turns the graph into checks — coupling, god-files, cycles, layering rules — composed into one opt-in CI gate.',
    date: 'Jun 25, 2026', read: '10 min', feat: true,
    tags: ['#harness', '#architecture-fitness', '#maintainability', '#ci'],
    thumbBg: 'rgba(242,85,90,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(242,85,90,0.08)"/><path d="M180 36 L250 60 V112 C250 150 218 168 180 180 C142 168 110 150 110 112 V60 Z" fill="none" stroke="rgba(150,165,200,0.32)" stroke-width="1.6"/><path d="M150 104 L172 126 L214 80" fill="none" stroke="#46C26B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    slug: 'spec-drift',
    cat: 'drift', catLabel: 'Spec Drift', catColor: 'var(--warn)',
    title: 'The day a renamed field broke a "verified" requirement',
    dek: 'Specs are nodes with edges to the code that satisfies them. Rename that code and the edge breaks — which is exactly the signal you want, landing in a review queue instead of silently shipping.',
    date: 'Jun 18, 2026', read: '6 min',
    tags: ['#spec-drift', '#requirements', '#review', '#rfc2119'],
    thumbBg: 'rgba(229,165,10,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(229,165,10,0.09)"/><path d="M90 70 L180 100 L270 60" stroke="rgba(150,165,200,0.35)" stroke-width="1.5" fill="none"/><path d="M180 100 L180 160" stroke="rgba(229,165,10,0.9)" stroke-width="1.5" stroke-dasharray="5 5" fill="none"/><circle cx="90" cy="70" r="11" fill="#5B93F2"/><circle cx="270" cy="60" r="9" fill="#A586F5"/><circle cx="180" cy="100" r="11" fill="#A586F5"/><circle cx="180" cy="160" r="13" fill="#E5A50A"/></svg>`,
  },
  {
    slug: 'approval-gates',
    cat: 'workflows', catLabel: 'Workflows', catColor: 'var(--accent)',
    title: 'Approval gates: letting the agent ship, safely',
    dek: 'A workflow that plans, implements, and tests in an isolated worktree — but pauses at a human gate before anything merges. Real control flow, not a one-shot prompt.',
    date: 'Jun 16, 2026', read: '7 min',
    tags: ['#workflows', '#worktrees', '#approval', '#dag'],
    thumbBg: 'rgba(91,147,242,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(91,147,242,0.08)"/><line x1="50" y1="100" x2="310" y2="100" stroke="rgba(150,165,200,0.3)" stroke-width="1.5"/><circle cx="70" cy="100" r="9" fill="#A586F5"/><circle cx="140" cy="100" r="9" fill="#5B93F2"/><circle cx="210" cy="100" r="13" fill="#E5A50A"/><circle cx="210" cy="100" r="5" fill="#12161E"/><circle cx="290" cy="100" r="9" fill="#46C26B"/></svg>`,
  },
  {
    slug: 'mcp-tokens',
    cat: 'tokens', catLabel: 'Tokens', catColor: 'var(--node-route)',
    title: '137× less context: anatomy of one MCP query',
    dek: 'A "find the callers of this function" task, run two ways: grep-and-read versus one structured graph query. The token bill between them is not close.',
    date: 'Jun 14, 2026', read: '7 min',
    tags: ['#mcp', '#tokens', '#retrieval', '#context'],
    thumbBg: 'rgba(41,210,190,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(41,210,190,0.09)"/><rect x="70" y="120" width="26" height="52" rx="4" fill="#F2555A" opacity="0.8"/><rect x="150" y="46" width="26" height="126" rx="4" fill="#5B93F2" opacity="0.5"/><rect x="250" y="150" width="26" height="22" rx="4" fill="#46C26B"/></svg>`,
  },
  {
    slug: 'cache-economics',
    cat: 'cost', catLabel: 'Cost', catColor: 'var(--success)',
    title: 'The economics of cache hits in long agent sessions',
    dek: 'Most of a long session’s token bill is cache reads, not fresh input — until your system prompt drifts and the hit rate falls off a cliff. Here’s how to see it.',
    date: 'Jun 12, 2026', read: '8 min',
    tags: ['#cost', '#cache', '#analytics', '#claude-code'],
    thumbBg: 'rgba(70,194,107,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(70,194,107,0.09)"/><path d="M40 150 C110 150 120 70 180 70 C240 70 250 110 320 60" stroke="#46C26B" stroke-width="2" fill="none"/><path d="M40 150 C110 150 120 70 180 70 C240 70 250 110 320 60 L320 180 L40 180 Z" fill="rgba(70,194,107,0.14)"/></svg>`,
  },
  {
    slug: 'memory-hierarchy',
    cat: 'memory', catLabel: 'Memory', catColor: 'var(--node-code)',
    title: 'Reading the whole CLAUDE.md hierarchy at a glance',
    dek: 'Managed, user, project, and subdirectory memory all stack — with @imports resolving across them. When the agent surprises you, the answer is usually a line you forgot was in scope.',
    date: 'Jun 10, 2026', read: '6 min',
    tags: ['#memory', '#claude-md', '#context', '#claude-code'],
    thumbBg: 'rgba(165,134,245,0.10)',
    thumb: `<svg viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice"><rect width="360" height="200" fill="rgba(165,134,245,0.09)"/><rect x="110" y="48" width="140" height="22" rx="5" fill="#A586F5" opacity="0.85"/><rect x="95" y="84" width="170" height="22" rx="5" fill="#5B93F2" opacity="0.6"/><rect x="80" y="120" width="200" height="22" rx="5" fill="#29D2BE" opacity="0.45"/><rect x="65" y="156" width="230" height="22" rx="5" fill="#46C26B" opacity="0.3"/></svg>`,
  },
];

export const categories = [
  { key: 'all', label: 'All posts', color: '' },
  { key: 'doors', label: 'Doors', color: '#29D2BE' },
  { key: 'statusline', label: 'Status Line', color: '#E5A50A' },
  { key: 'graph', label: 'Knowledge Graph', color: 'var(--node-spec)' },
  { key: 'harness', label: 'Harness Engineering', color: '#F2555A' },
  { key: 'domain', label: 'Domain Knowledge', color: '#8B7BFF' },
  { key: 'drift', label: 'Spec Drift', color: 'var(--warn)' },
  { key: 'workflows', label: 'Workflows', color: 'var(--accent)' },
  { key: 'tokens', label: 'Tokens', color: 'var(--node-route)' },
  { key: 'cost', label: 'Cost', color: 'var(--success)' },
  { key: 'memory', label: 'Memory', color: 'var(--node-code)' },
];

export function relatedTo(slug: string, n = 3): BlogPost[] {
  return posts.filter((p) => p.slug !== slug).slice(0, n);
}
