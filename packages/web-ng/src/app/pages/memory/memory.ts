import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Icon } from '../../shell/icon/icon';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import type {
  MemoryResponse,
  MemoryLevelKey,
  MemoryTypeKey,
  MemoryFile as MemFileApi,
} from '../../api/types';
import { renderMd } from '../../util/render-md';
import { CopyBtn } from '../../ui/copy-btn';

type MemoryType = MemoryTypeKey;
type MemoryLevel = MemoryLevelKey;
type TypeFilter = 'all' | MemoryType;
type MemFile = MemFileApi;

interface LevelInfo { key: MemoryLevel; label: string; color: string; soft: string; desc: string; }
interface TypeInfo { key: MemoryType; label: string; color: string; soft: string; icon: string; desc: string; }

const LEVELS: Record<MemoryLevel, LevelInfo> = {
  enterprise: { key: 'enterprise', label: 'Managed', color: '#E5A50A', soft: 'rgba(229,165,10,0.14)', desc: 'Organization policy · cannot be overridden' },
  user: { key: 'user', label: 'User', color: '#29D2BE', soft: 'rgba(41,210,190,0.14)', desc: 'Personal · applies to every project' },
  project: { key: 'project', label: 'Project', color: '#5B93F2', soft: 'rgba(91,147,242,0.14)', desc: 'Team-shared · checked into the repo' },
  subdir: { key: 'subdir', label: 'Directory', color: '#A586F5', soft: 'rgba(165,134,245,0.14)', desc: 'Scoped to a subtree · loaded when cwd is inside' },
  import: { key: 'import', label: 'Import', color: '#7B8696', soft: 'rgba(123,134,150,0.12)', desc: 'Pulled in via @path reference' },
  note: { key: 'note', label: 'Notes', color: '#46C26B', soft: 'rgba(70,194,107,0.14)', desc: 'Agent-written · memory tool' },
};

const TYPES: Record<MemoryType, TypeInfo> = {
  instruction: { key: 'instruction', label: 'Instructions', color: '#5B93F2', soft: 'rgba(91,147,242,0.14)', icon: 'memory', desc: 'Directives & rules from CLAUDE.md' },
  note: { key: 'note', label: 'Notes', color: '#46C26B', soft: 'rgba(70,194,107,0.14)', icon: 'tips', desc: 'Facts the agent saved via the memory tool' },
  import: { key: 'import', label: 'Imports', color: '#29D2BE', soft: 'rgba(41,210,190,0.14)', icon: 'external', desc: 'Files pulled in via @path' },
};

const PRECEDENCE: MemoryLevel[] = ['enterprise', 'project', 'subdir', 'import', 'user'];

const SEED_FILES: MemFile[] = [
  { id: 'm-ent', level: 'enterprise', type: 'instruction', name: 'CLAUDE.md', scope: 'managed', readOnly: true,
    path: '/Library/Application Support/ClaudeCode/CLAUDE.md', tokens: 210, lines: 9, modified: 'managed',
    body: '# Engineering policy (managed)\n\n- All code must pass `pnpm lint` and `pnpm typecheck` before commit.\n- Never commit secrets, API keys, or `.env` files.\n- Prefer dependency-free solutions; new deps require review.\n- Validate all external input at trust boundaries.\n- Production logs must not contain user content.' },
  { id: 'm-user', level: 'user', type: 'instruction', name: 'CLAUDE.md', scope: '~/.claude',
    path: '~/.claude/CLAUDE.md', tokens: 280, lines: 12, modified: '3d ago',
    body: '# Personal preferences\n\n- Before reading a file, try `specship_explore` for structure first.\n- Use conventional commits (`feat:`, `fix:`, `chore:`).\n- Prefer `rg` over `grep`, `fd` over `find`.\n- Keep responses terse — show diffs, not whole files.\n- Editor open command: `cursor`.\n- Default model for read/edit turns: Sonnet.' },
  { id: 'm-proj', level: 'project', type: 'instruction', name: 'CLAUDE.md', scope: 'project root',
    path: '~/dev/specship/CLAUDE.md', tokens: 760, lines: 28, modified: '2h ago', imports: ['m-imp-conv', 'm-imp-style'],
    body: '# SpecShip — project memory\n\n## Architecture\n- Electron + Angular renderer in `packages/web-ng`.\n- MCP server in `src/mcp`, graph engine in `src/graph`.\n- SQLite via better-sqlite3; migrations in `src/db/migrations.ts`.\n\n## Commands\n- `npm run dev` — renderer + MCP in watch mode.\n- `npm test` — vitest; `npm run eval` — evaluation runner.\n- `npm run cli` — local SpecShip binary.\n\n## Conventions\n- Spec IDs are stable: `REQ-<AREA>-<NNN>`.\n- Never edit generated files under `src/graph/_gen`.\n\n@docs/conventions.md\n@specs/STYLE.md' },
  { id: 'm-sub', level: 'subdir', type: 'instruction', name: 'CLAUDE.md', scope: 'src/graph',
    path: '~/dev/specship/src/graph/CLAUDE.md', tokens: 190, lines: 7, modified: '1d ago',
    body: '# Graph engine notes\n\n- Layout runs in a worker — keep `applyLayout` pure.\n- Node positions are cached by content hash.\n- Above 5k nodes, cull to viewport + 1-hop (REQ-GRAPH-006).\n- Synthesized edges are dashed; never persist them.' },
  { id: 'm-imp-conv', level: 'import', type: 'import', name: 'conventions.md', scope: '@import',
    path: 'docs/conventions.md', tokens: 120, lines: 6, modified: '5d ago',
    body: '# Conventions\n\n- One component per file; co-locate styles.\n- Name event handlers `onX`; booleans `isX`/`hasX`.\n- No default exports in shared modules.' },
  { id: 'm-imp-style', level: 'import', type: 'import', name: 'STYLE.md', scope: '@import',
    path: 'specs/STYLE.md', tokens: 100, lines: 5, modified: '5d ago',
    body: '# Spec style\n\n- Requirements use MUST / SHOULD / MAY.\n- Each requirement gets one acceptance block.\n- Keep titles under 8 words.' },
  { id: 'n-build', level: 'note', type: 'note', name: 'build-system.md', scope: 'memory tool',
    path: '~/.claude/memory/build-system.md', tokens: 64, lines: 4, modified: 'today 14:31', session: 'a3f9c1d2', tags: ['build', 'tooling'],
    body: '# Build system\n\n- Package manager is **npm**, never pnpm in this fork.\n- `npm run dev` runs renderer + MCP in watch mode.\n- Run `npm run build` after any schema change.' },
  { id: 'n-auth', level: 'note', type: 'note', name: 'auth-jwt.md', scope: 'memory tool',
    path: '~/.claude/memory/auth-jwt.md', tokens: 58, lines: 4, modified: 'today 15:38', session: 'a3f9c1d2', tags: ['auth', 'REQ-AUTH-005'],
    body: '# Auth model\n\n- Session tokens are signed **JWTs**.\n- `checkExpiry` tolerates 30s clock skew (REQ-AUTH-005).\n- Expired tokens return 401 with `code: token_expired`.' },
  { id: 'n-graph', level: 'note', type: 'note', name: 'graph-perf.md', scope: 'memory tool',
    path: '~/.claude/memory/graph-perf.md', tokens: 52, lines: 4, modified: 'yest 16:44', session: 'f04a8b13', tags: ['graph', 'perf'],
    body: '# Graph performance\n\n- Above 5k nodes, layout culls to viewport + 1-hop.\n- `applyLayout` must stay pure (runs in a worker).\n- Node positions cached by content hash.' },
  { id: 'n-cost', level: 'note', type: 'note', name: 'cost-prefs.md', scope: 'memory tool',
    path: '~/.claude/memory/cost-prefs.md', tokens: 44, lines: 3, modified: 'Jun 4 09:20', session: 'b5f2c8d9', tags: ['cost', 'model'],
    body: '# Cost preferences\n\n- Route read/edit-only turns to Sonnet.\n- Pin a stable system-prompt prefix to keep the 1h cache warm.' },
];

interface RailGroup { key: MemoryLevel; items: MemFile[]; }

@Component({
  selector: 'app-memory',
  imports: [Icon, CopyBtn],
  templateUrl: './memory.html',
  styleUrl: './memory.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Memory {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);

  protected readonly view = signal<'sources' | 'effective'>('sources');
  protected readonly typeFilter = signal<TypeFilter>('all');
  protected readonly selectedId = signal<string>('m-proj');

  protected readonly L = LEVELS;
  protected readonly T = TYPES;

  private readonly resource = apiResource<MemoryResponse>(this.api, () => `/api/memory${this.projects.projectQuery()}`);

  /** Live memory list: API response if it has files; SEED otherwise. */
  protected readonly files = computed<MemFile[]>(() => {
    const data = this.resource.state().data;
    if (data?.files?.length) return data.files;
    return SEED_FILES;
  });

  protected readonly source = computed<'api' | 'seed'>(() =>
    this.resource.state().data?.files?.length ? 'api' : 'seed',
  );
  protected readonly loading = computed(() => this.resource.state().loading);
  protected readonly errorMessage = computed<string | null>(() => {
    const err = this.resource.state().error;
    return err ? err.message : null;
  });
  protected readonly noProject = computed(() => this.resource.state().noProject);

  protected readonly totalTokens = computed(() => this.files().reduce((a, b) => a + b.tokens, 0));
  protected readonly instructionCount = computed(() => this.files().filter((f) => f.type === 'instruction').length);
  protected readonly noteCount = computed(() => this.files().filter((f) => f.type === 'note').length);
  protected readonly importCount = computed(() => this.files().filter((f) => f.type === 'import').length);

  // Re-select a valid id whenever the file list changes (e.g. API arrives).
  private readonly autoSelect = effect(() => {
    const list = this.files();
    if (!list.length) return;
    if (!list.find((f) => f.id === this.selectedId())) {
      const preferred = list.find((f) => f.level === 'project') ?? list[0];
      if (preferred) this.selectedId.set(preferred.id);
    }
  });

  protected readonly current = computed<MemFile | undefined>(() => this.files().find((f) => f.id === this.selectedId()));
  protected readonly currentLevel = computed(() => {
    const c = this.current();
    return c ? LEVELS[c.level] : null;
  });
  protected readonly currentBody = computed<SafeHtml>(() => {
    const c = this.current();
    return this.sanitizer.bypassSecurityTrustHtml(c ? renderMd(c.body) : '');
  });
  protected readonly currentImports = computed<MemFile[]>(() => {
    const c = this.current();
    if (!c?.imports) return [];
    const all = this.files();
    return c.imports.map((id) => all.find((f) => f.id === id)).filter((f): f is MemFile => !!f);
  });

  protected readonly typeDesc = computed<string>(() => {
    const tf = this.typeFilter();
    return tf === 'all' ? '' : TYPES[tf].desc;
  });

  /** "memory files" when filter is all, otherwise the active type's plural label in lowercase. */
  protected readonly filterEmptyNoun = computed<string>(() => {
    const tf = this.typeFilter();
    return tf === 'all' ? 'memory files' : TYPES[tf].label.toLowerCase();
  });

  protected readonly typeChips = computed<Array<{ key: TypeFilter; label: string; color: string; soft: string; count?: number }>>(() => [
    { key: 'all', label: 'All', color: 'var(--text-secondary)', soft: 'var(--bg-active)' },
    { key: 'instruction', label: TYPES.instruction.label, color: TYPES.instruction.color, soft: TYPES.instruction.soft, count: this.instructionCount() },
    { key: 'note', label: TYPES.note.label, color: TYPES.note.color, soft: TYPES.note.soft, count: this.noteCount() },
    { key: 'import', label: TYPES.import.label, color: TYPES.import.color, soft: TYPES.import.soft, count: this.importCount() },
  ]);

  protected readonly railGroups = computed<RailGroup[]>(() => {
    const tf = this.typeFilter();
    const all = this.files();
    const matchesType = (f: MemFile) => tf === 'all' || f.type === tf;
    const groups: RailGroup[] = ([
      { key: 'enterprise' as MemoryLevel, items: all.filter((f) => f.level === 'enterprise') },
      { key: 'user' as MemoryLevel, items: all.filter((f) => f.level === 'user') },
      { key: 'project' as MemoryLevel, items: all.filter((f) => f.level === 'project' || f.level === 'subdir') },
      { key: 'note' as MemoryLevel, items: all.filter((f) => f.level === 'note') },
    ] satisfies RailGroup[]).filter((g) => g.items.length > 0);
    return groups.filter((g) =>
      g.items.some((f) => matchesType(f) || (f.imports ?? []).some((id) => {
        const im = all.find((x) => x.id === id);
        return im ? matchesType(im) : false;
      })),
    );
  });

  /** Total visible rows across all rail groups under the current filter. */
  protected readonly visibleCount = computed<number>(() => {
    const groups = this.railGroups();
    return groups.reduce((a, g) => a + this.rowItems(g).length, 0);
  });

  protected readonly effectiveInstructions = computed<MemFile[]>(() => {
    const tf = this.typeFilter();
    const all = this.files();
    const ordered: MemFile[] = [];
    for (const lvl of PRECEDENCE) {
      for (const f of all) if (f.level === lvl) ordered.push(f);
    }
    return ordered.filter((f) => tf === 'all' || f.type === tf);
  });

  protected readonly effectiveNotes = computed<MemFile[]>(() => {
    const tf = this.typeFilter();
    return this.files().filter((f) => f.type === 'note' && (tf === 'all' || tf === 'note'));
  });

  protected rowItems(group: RailGroup): MemFile[] {
    const tf = this.typeFilter();
    const all = this.files();
    const matchesType = (f: MemFile) => tf === 'all' || f.type === tf;
    const out: MemFile[] = [];
    for (const f of group.items) {
      if (matchesType(f)) out.push(f);
      if (f.imports) {
        for (const id of f.imports) {
          const im = all.find((x) => x.id === id);
          if (im && matchesType(im)) out.push(im);
        }
      }
    }
    return out;
  }

  protected isIndented(f: MemFile): boolean {
    return f.level === 'import';
  }

  protected iconFor(f: MemFile): string {
    if (f.level === 'import') return 'external';
    if (f.level === 'note') return 'tips';
    return 'memory';
  }

  /** Human-friendly primary label for a row — basename when meaningful, scope otherwise. */
  protected nameFor(f: MemFile): string {
    if (f.level === 'import' || f.level === 'note') return f.name;
    // For CLAUDE.md instruction files the scope ("project root", "src/graph") is more
    // useful than the filename, which is always "CLAUDE.md" and would collapse to a
    // wall of identical rows.
    return f.scope;
  }

  /** Short, human-readable path: ~/, with the home tilde already applied server-side. */
  protected shortPath(f: MemFile): string { return f.path; }

  protected fmtK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  }

  protected renderBody(body: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMd(body));
  }

  protected onSelect(id: string): void { this.selectedId.set(id); }
  protected onViewChange(v: 'sources' | 'effective'): void { this.view.set(v); }
  protected onTypeFilter(t: TypeFilter): void { this.typeFilter.set(t); }
  protected onSelectByObj(f: MemFile): void { this.selectedId.set(f.id); }
  protected reload(): void { this.resource.refetch(); }
  protected clearFilter(): void { this.typeFilter.set('all'); }
}

// `renderMd` moved to `app/util/render-md.ts` so the Specs page can share
// the same Markdown subset renderer. Imported at the top of this file.
