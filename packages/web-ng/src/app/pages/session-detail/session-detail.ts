/** Session detail — one Claude Code session unrolled into prompts + tool calls. */
import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { RefreshService } from '../../api/refresh';
import { Icon } from '../../shell/icon/icon';
import { Pill } from '../../ui/pill';
import { Bar } from '../../ui/bar';
import { CopyBtn } from '../../ui/copy-btn';
import { HBars, type HBarItem } from '../../charts/h-bars/h-bars';
import { renderMd } from '../../util/render-md';
import { promptQuality, qualityReviewText, type QualityResult } from '../../util/prompt-quality';
import type {
  ClaudePrompt,
  ClaudeToolCall,
  SessionDetailResponse,
  SessionSummaryResponse,
} from '../../api/types';

/** Live-update mode. Drives the indicator pill. */
type LiveMode = 'live' | 'polling' | 'idle';

/**
 * Polling fallback cadence. 5s mirrors the Sessions list's 10s but is
 * tighter because the user is focused on one session in the detail view.
 * Visibility-gated so a background tab doesn't burn fetches.
 */
const POLL_INTERVAL_MS = 5_000;

interface ToolChip {
  name: string;
  count: number;
  color: string;
}

interface PromptGroup {
  prompt: ClaudePrompt;
  tools: ClaudeToolCall[];
  totalTokens: number;
  toolBytes: number;
  /** Slash command extracted from the user prompt text (e.g. "/specship:spec"). */
  slashCommand: string | null;
  /** Wall-clock between the prompt's ts and its last tool call. 0 when no tools fired. */
  durationMs: number;
  /** Per-tool counts for the collapsed-row chip strip. */
  toolBreakdown: ToolChip[];
  /** Unique file paths touched by Read/Edit/Write/NotebookEdit/MultiEdit. */
  filesTouched: string[];
  /** Estimated tokens spent on SpecShip MCP calls (Σ result_length / 4). 0 when no specship calls. */
  specshipSpendTokens: number;
  /** Estimated tokens saved vs reading files directly. 0 when no resolved calls or no net saving. */
  specshipSavedTokens: number;
}

/** Regex Claude Code wraps every slash command with in the user prompt. */
const SLASH_COMMAND_TAG = /<command-name>([^<]+)<\/command-name>/;
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/**
 * Safely parse the `displaced_files` JSON field from a SpecShip tool call.
 * Expected shape: `[[path: string, size: number], …]`. Returns [] on any error.
 */
function parseDisplacedFiles(raw: string | null | undefined): Array<[string, number]> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && entry.length >= 2 &&
        typeof entry[0] === 'string' && typeof entry[1] === 'number',
    );
  } catch {
    return [];
  }
}

@Component({
  selector: 'app-session-detail',
  imports: [DecimalPipe, RouterLink, Icon, Pill, Bar, CopyBtn, HBars],
  templateUrl: './session-detail.html',
  styleUrl: './session-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly refresh = inject(RefreshService);

  /** Current live-update mode — drives the indicator pill in the header. */
  protected readonly liveMode = signal<LiveMode>('idle');

  /** Session id from the route. Signals route changes when the user
   *  clicks a different session via the back-and-forth nav. */
  private readonly idSig = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  protected readonly id = computed(() => this.idSig().get('id') ?? '');

  protected readonly localRefreshing = signal(false);
  protected readonly expandedIds = signal(new Set<string>());
  /**
   * Per-tool-call expansion state for the verbatim input_json reveal. Keyed
   * by tool_call row id (number). Independent of prompt expansion — a user
   * can have a prompt expanded but only one of its tool calls' inputs
   * open at a time.
   */
  protected readonly expandedToolInputs = signal(new Set<number>());

  protected readonly resource = apiResource<SessionDetailResponse>(
    this.api,
    () => {
      const id = this.id();
      return id ? `/api/claude/session/${encodeURIComponent(id)}` : null;
    },
  );

  /**
   * Session-summary aggregation (top tools, slash commands, skills, files
   * touched). Driven by the same id signal so navigating between sessions
   * reloads it cleanly. Refetched whenever the global refresh ticks.
   */
  protected readonly summary = apiResource<SessionSummaryResponse>(
    this.api,
    () => {
      const id = this.id();
      return id ? `/api/claude/session/${encodeURIComponent(id)}/summary` : null;
    },
  );

  protected readonly session = computed(() => this.resource.state().data?.session ?? null);
  protected readonly prompts = computed(() => this.resource.state().data?.prompts ?? []);
  protected readonly toolCalls = computed(() => this.resource.state().data?.toolCalls ?? []);
  protected readonly summaryData = computed(() => this.summary.state().data ?? null);

  /**
   * Group each prompt with the tool calls it issued. Tool calls hang off
   * `prompt_id`; we bucket by prompt and compute per-prompt totals so the
   * UI can show a one-line summary above each expandable detail block.
   */
  protected readonly groups = computed<PromptGroup[]>(() => {
    const promptsArr = this.prompts();
    const tools = this.toolCalls();
    const byPrompt = new Map<string, ClaudeToolCall[]>();
    for (const t of tools) {
      const arr = byPrompt.get(t.prompt_id) ?? [];
      arr.push(t);
      byPrompt.set(t.prompt_id, arr);
    }
    return promptsArr.map((p) => {
      const ts = byPrompt.get(p.id) ?? [];
      const totalTokens = (p.input_tokens || 0) + (p.output_tokens || 0)
        + (p.cache_creation_tokens || 0) + (p.cache_read_tokens || 0);
      const toolBytes = ts.reduce((acc, t) => acc + (t.result_length || 0), 0);

      // Slash command: Claude Code wraps it in <command-name>…</command-name>
      // in the user prompt. Pull the first one; rare to see multiple per
      // prompt (only happens with prompt-chaining).
      const slashMatch = p.text ? SLASH_COMMAND_TAG.exec(p.text) : null;
      const slashCommand = slashMatch ? slashMatch[1].trim() : null;

      // Duration: wall-clock from prompt entry to its last tool call. Doesn't
      // count assistant-only turns since we have no end-ts for those (the
      // ingestor records `ts` per entry, not a turn-end). 0 = "no tools / unknown".
      const lastToolTs = ts.length > 0 ? Math.max(...ts.map((t) => t.ts || 0)) : 0;
      const durationMs = lastToolTs > p.ts ? lastToolTs - p.ts : 0;

      // Tool breakdown: group by name, count, attach the same color the
      // tool name uses elsewhere so the chip strip reads consistently.
      const toolCountMap = new Map<string, number>();
      for (const t of ts) {
        toolCountMap.set(t.tool_name, (toolCountMap.get(t.tool_name) ?? 0) + 1);
      }
      const toolBreakdown: ToolChip[] = Array.from(toolCountMap.entries())
        .map(([name, count]) => ({ name, count, color: this.toolColor(name) }))
        .sort((a, b) => b.count - a.count);

      // Files touched: file path = input_summary for file-mutating tools.
      // De-dupe so the same path edited twice shows once. Order = first-seen.
      const filesSet = new Set<string>();
      for (const t of ts) {
        if (FILE_TOOLS.has(t.tool_name) && t.input_summary) filesSet.add(t.input_summary);
      }

      // SpecShip token impact — per-prompt estimate.
      //
      // spendChars = Σ result_length over SpecShip calls (is_specship === 1).
      // specshipSpendTokens = ceil(spendChars / 4).
      //
      // savedTokens: union the displaced file paths across *resolved* calls so
      // a file shared by two calls only counts once (mirrors backend dedup).
      // readEquivChars = Σ size of each distinct path once.
      // specshipSavedTokens = ceil(max(0, readEquivChars − spendChars) / 4).
      const specshipTools = ts.filter((t) => t.is_specship === 1);
      const spendChars = specshipTools.reduce((acc, t) => acc + (t.result_length || 0), 0);
      const specshipSpendTokens = specshipTools.length > 0 ? Math.ceil(spendChars / 4) : 0;

      // Dedup displaced files across all resolved calls in this prompt.
      const seenPaths = new Map<string, number>();
      for (const t of specshipTools) {
        if (t.resolution !== 'resolved') continue;
        for (const [path, size] of parseDisplacedFiles(t.displaced_files)) {
          if (!seenPaths.has(path)) seenPaths.set(path, size);
        }
      }
      const readEquivChars = Array.from(seenPaths.values()).reduce((acc, sz) => acc + sz, 0);
      const specshipSavedTokens = Math.ceil(Math.max(0, readEquivChars - spendChars) / 4);

      return {
        prompt: p,
        tools: ts,
        totalTokens,
        toolBytes,
        slashCommand,
        durationMs,
        toolBreakdown,
        filesTouched: Array.from(filesSet),
        specshipSpendTokens,
        specshipSavedTokens,
      };
    });
  });

  protected readonly totalToolCalls = computed(() => this.toolCalls().length);

  // ── PromptPage (dedicated per-prompt view) ─────────────────────────────────
  // Driven by a `?prompt=<id>` query param so it stays in-page (the SSE live
  // tail is keyed on the session id and must not tear down) and is deep-linkable.
  private readonly queryMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly selectedPromptId = computed(() => this.queryMap().get('prompt'));

  /** Index of the selected prompt within groups(), or -1. */
  protected readonly selectedIndex = computed(() => {
    const id = this.selectedPromptId();
    if (!id) return -1;
    return this.groups().findIndex((g) => g.prompt.id === id);
  });
  protected readonly selectedGroup = computed<PromptGroup | null>(() => {
    const i = this.selectedIndex();
    return i >= 0 ? this.groups()[i] : null;
  });

  /** Deterministic prompt-quality review for the selected prompt. */
  protected readonly quality = computed<QualityResult | null>(() => {
    const g = this.selectedGroup();
    return g ? promptQuality(g.prompt, g.tools) : null;
  });
  protected readonly qualityShareText = computed(() => {
    const q = this.quality();
    return q ? qualityReviewText(q) : '';
  });

  protected readonly hasPrevPrompt = computed(() => this.selectedIndex() > 0);
  protected readonly hasNextPrompt = computed(() => {
    const i = this.selectedIndex();
    return i >= 0 && i < this.groups().length - 1;
  });

  /** Per-prompt cache read rate (for the collapsed-row quality dot + page). */
  protected promptCacheRate(p: ClaudePrompt): number {
    const total = (p.input_tokens || 0) + (p.cache_creation_tokens || 0) + (p.cache_read_tokens || 0);
    return total > 0 ? (p.cache_read_tokens || 0) / total : 0;
  }

  /** Quality colour for a prompt's collapsed-row dot (replaces the cache proxy). */
  protected promptQualityColor(g: PromptGroup): string {
    return promptQuality(g.prompt, g.tools).color;
  }

  protected openPrompt(promptId: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { prompt: promptId },
      queryParamsHandling: 'merge',
    });
  }
  protected closePrompt(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { prompt: null },
      queryParamsHandling: 'merge',
    });
  }
  protected stepPrompt(delta: number): void {
    const i = this.selectedIndex();
    const next = this.groups()[i + delta];
    if (next) this.openPrompt(next.prompt.id);
  }

  /** Per-token-kind value for the selected prompt's breakdown bar. */
  protected promptTok(p: ClaudePrompt, kind: 'input' | 'output' | 'cacheWrite' | 'cacheRead'): number {
    return kind === 'input' ? (p.input_tokens || 0)
      : kind === 'output' ? (p.output_tokens || 0)
      : kind === 'cacheWrite' ? (p.cache_creation_tokens || 0)
      : (p.cache_read_tokens || 0);
  }
  protected promptTokPct(p: ClaudePrompt, kind: 'input' | 'output' | 'cacheWrite' | 'cacheRead'): number {
    const total = (p.input_tokens || 0) + (p.output_tokens || 0)
      + (p.cache_creation_tokens || 0) + (p.cache_read_tokens || 0) || 1;
    return (this.promptTok(p, kind) / total) * 100;
  }

  /** Total tokens across all token types — used for rail percentage bars. */
  private readonly totalTokens = computed<number>(() => {
    const s = this.session();
    if (!s) return 1;
    return (s.total_input_tokens || 0) + (s.total_output_tokens || 0)
      + (s.total_cache_creation_tokens || 0) + (s.total_cache_read_tokens || 0) || 1;
  });

  /** Max prompt cost — for the cost-per-prompt mini bars. */
  protected readonly maxPromptCost = computed<number>(() => {
    const gs = this.groups();
    return Math.max(0.0001, ...gs.map((g) => g.prompt.cost_usd || 0));
  });

  /** Tool bar color function for HBars in the rail. */
  protected readonly toolBarColor = (it: HBarItem): string => {
    const n = it.name as string;
    if (n === 'Read') return 'var(--node-spec)';
    if (n === 'Edit' || n === 'Write' || n === 'MultiEdit') return 'var(--accent)';
    if (n === 'Bash') return 'var(--warn)';
    if (n === 'Grep' || n === 'Glob') return 'var(--node-test)';
    if (n === 'Task') return 'var(--node-route)';
    if (n.startsWith('mcp__')) return 'var(--success)';
    return 'var(--node-code)';
  };

  protected readonly cacheReadRate = computed<number>(() => {
    const s = this.session();
    if (!s) return 0;
    const total = (s.total_input_tokens || 0) + (s.total_cache_creation_tokens || 0) + (s.total_cache_read_tokens || 0);
    return total > 0 ? (s.total_cache_read_tokens || 0) / total : 0;
  });

  constructor() {
    // Clear the local refresh flag once the underlying fetch completes.
    effect(() => {
      const loading = this.resource.state().loading;
      if (!loading && this.localRefreshing()) this.localRefreshing.set(false);
    });

    // Live tail: SSE primary, polling fallback. Wired in an effect so
    // navigating between sessions tears down + recreates the stream
    // cleanly. Reading `this.id()` makes the effect re-run on route change.
    //
    // Visibility-gated polling (matches Sessions list pattern): while the
    // tab is hidden we pause both the SSE listener and the polling
    // interval, then force-refetch the instant the tab regains focus so
    // the user doesn't wait for the next tick to see fresh prompts.
    let sseClose: (() => void) | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null; }
    };
    const startPolling = () => {
      if (pollInterval !== null) return;
      pollInterval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.resource.refetch();
        }
      }, POLL_INTERVAL_MS);
    };
    const stopSse = () => {
      if (sseClose) { sseClose(); sseClose = null; }
    };
    const startSse = (sessionId: string) => {
      if (!sessionId) return;
      stopSse();
      sseClose = this.api.openEventStream(
        `/api/claude/session/${encodeURIComponent(sessionId)}/events`,
        (type) => {
          // Any push from the server is reason enough to refetch the
          // detail endpoint — the response includes the assistant text
          // we want to show, and re-pulling the whole session keeps the
          // groups[] computation simple (no merge logic, no out-of-order
          // worries). The detail GET is cheap; this is fine.
          if (type === 'prompt_added' || type === 'tool_call_added') {
            this.resource.refetch();
          } else if (type === 'snapshot') {
            // Stream is live — flip the indicator to green.
            this.liveMode.set('live');
            stopPolling();
          } else if (type === 'stream_error') {
            // Server explicitly errored — fall back to polling.
            this.liveMode.set('polling');
            startPolling();
          }
        },
        () => {
          // Network error, EventSource closed by the browser, server
          // unreachable. Flip to polling silently — user sees the amber
          // indicator, fresh data still lands within POLL_INTERVAL_MS.
          this.liveMode.set('polling');
          startPolling();
        },
        ['prompt_added', 'tool_call_added', 'snapshot', 'stream_error'],
      );
    };

    const visibilityHandler = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        // Returning to the tab — refetch immediately + reconnect SSE
        // if we were in polling mode (the browser may have killed the
        // EventSource while the tab was hidden).
        this.resource.refetch();
        const id = this.id();
        if (id && this.liveMode() === 'polling') startSse(id);
      } else {
        // Going hidden — pause polling so we don't burn cycles. SSE
        // stays connected; the server will see the eventual disconnect.
        stopPolling();
      }
    };

    effect(() => {
      const id = this.id();
      stopSse();
      stopPolling();
      if (!id) {
        this.liveMode.set('idle');
        return;
      }
      startSse(id);
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityHandler);
    }
    this.destroyRef.onDestroy(() => {
      stopSse();
      stopPolling();
      this.liveMode.set('idle');
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    });
  }

  protected async forceRefresh(): Promise<void> {
    this.localRefreshing.set(true);
    await this.refresh.triggerGlobalRefresh();
  }

  protected isExpanded(promptId: string): boolean {
    return this.expandedIds().has(promptId);
  }

  protected toggleExpand(promptId: string): void {
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }

  protected expandAll(): void {
    this.expandedIds.set(new Set(this.prompts().map((p) => p.id)));
  }

  protected collapseAll(): void {
    this.expandedIds.set(new Set());
  }

  protected isToolInputExpanded(toolId: number): boolean {
    return this.expandedToolInputs().has(toolId);
  }

  protected toggleToolInput(toolId: number): void {
    this.expandedToolInputs.update((set) => {
      const next = new Set(set);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  /**
   * Render the assistant's response text through the shared markdown
   * subset renderer. Returns sanitized HTML safe to drop into [innerHTML].
   * Empty string in → empty string out — the caller hides the section
   * when the source field is null/empty.
   */
  protected renderAssistant(text: string | null | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMd(text ?? ''));
  }

  /**
   * Pretty-print a tool's input_json. Falls back to the raw string if it
   * doesn't parse (e.g. a future schema change). Truncates lines longer
   * than ~200 chars in the rendered output via CSS, not here — the raw
   * value is preserved so the user can copy it.
   */
  protected formatToolInput(json: string | null | undefined): string {
    if (!json) return '';
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  }

  protected fmtBytes(n: number): string {
    if (!n) return '0';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected fmtTokens(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }

  /** Arrow-function version for passing as [fmt] input to chart components. */
  protected readonly fmtTokensFn = (n: number): string => this.fmtTokens(n);

  protected fmtClock(ms: number | null | undefined): string {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dayMs = 86_400_000;
      const diff = today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (diff === 0) return time;
      if (diff === dayMs) return 'Yest ' + time;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    } catch { return String(ms); }
  }

  protected fmtDurationSec(start: number, end: number): string {
    if (!start || !end) return '';
    const sec = Math.round((end - start) / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60); const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60); const mm = m % 60;
    return `${h}h ${mm}m`;
  }

  /**
   * Sub-second-aware duration formatter for per-prompt timing. Most prompts
   * complete in <60s so the seconds-only form from fmtDurationSec hides
   * relative timing — 0.4s vs 2.1s vs 8.5s all collapse meaninglessly.
   */
  protected fmtDurationMs(ms: number): string {
    if (!ms || ms <= 0) return '';
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
    const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60); const mm = m % 60;
    return `${h}h ${mm}m`;
  }

  /** Display short name for a path: last two segments, or full if short. */
  protected basename(p: string): string {
    if (!p) return '';
    if (p.length <= 40) return p;
    const parts = p.split('/');
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
  }

  /** Color-code tool names so the eye can scan a long call list quickly. */
  protected toolColor(name: string): string {
    if (name === 'Read') return 'var(--node-spec)';
    if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return 'var(--accent)';
    if (name === 'Bash') return 'var(--warn)';
    if (name === 'Grep' || name === 'Glob') return 'var(--node-test)';
    if (name === 'Task') return 'var(--node-route)';
    if (name.startsWith('mcp__')) return 'var(--success)';
    return 'var(--text-secondary)';
  }

  protected cacheColor(v: number): string {
    return v >= 0.7 ? 'var(--success)' : v >= 0.5 ? 'var(--warn)' : 'var(--error)';
  }

  /** Percentage of total tokens for a token type — used in the token-mix bar. */
  protected tokPct(kind: 'input' | 'output' | 'cacheWrite' | 'cacheRead'): number {
    const s = this.session();
    if (!s) return 0;
    const total = this.totalTokens();
    const v = kind === 'input' ? (s.total_input_tokens || 0)
      : kind === 'output' ? (s.total_output_tokens || 0)
      : kind === 'cacheWrite' ? (s.total_cache_creation_tokens || 0)
      : (s.total_cache_read_tokens || 0);
    return (v / total) * 100;
  }
}
