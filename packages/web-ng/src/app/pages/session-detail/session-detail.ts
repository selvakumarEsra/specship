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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { RefreshService } from '../../api/refresh';
import { Icon } from '../../shell/icon/icon';
import { renderMd } from '../../util/render-md';
import type {
  ClaudePrompt,
  ClaudeToolCall,
  SessionDetailResponse,
} from '../../api/types';

/** Live-update mode. Drives the indicator pill. */
type LiveMode = 'live' | 'polling' | 'idle';

/**
 * Polling fallback cadence. 5s mirrors the Sessions list's 10s but is
 * tighter because the user is focused on one session in the detail view.
 * Visibility-gated so a background tab doesn't burn fetches.
 */
const POLL_INTERVAL_MS = 5_000;

interface PromptGroup {
  prompt: ClaudePrompt;
  tools: ClaudeToolCall[];
  totalTokens: number;
  toolBytes: number;
}

@Component({
  selector: 'app-session-detail',
  imports: [DecimalPipe, RouterLink, Icon],
  templateUrl: './session-detail.html',
  styleUrl: './session-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
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

  protected readonly session = computed(() => this.resource.state().data?.session ?? null);
  protected readonly prompts = computed(() => this.resource.state().data?.prompts ?? []);
  protected readonly toolCalls = computed(() => this.resource.state().data?.toolCalls ?? []);

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
      return { prompt: p, tools: ts, totalTokens, toolBytes };
    });
  });

  protected readonly totalToolCalls = computed(() => this.toolCalls().length);

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
}
