import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, signal, inject, viewChild } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Icon } from '../../shell/icon/icon';
import { Pill } from '../../ui/pill';
import { Segmented } from '../../ui/segmented';
import { LogoMark } from '../../shell/logo-mark/logo-mark';
import { ApiService } from '../../api/api';

interface ToolCall { name: string; input: string; output: string; status: 'ok' | 'error'; open?: boolean; }
interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolCall[];
}

// The three command doors (DASH-DOORS-DOC). Each routes a whole family of
// flows; one slash command per door instead of the retired per-command set.
const SLASH_COMMANDS = [
  { cmd: '/ss-spec',    arg: 'REQ-ID | new <desc>',  desc: 'Intent door — view, author, implement, or review a spec' },
  { cmd: '/ss-explore', arg: 'symbols | from→to',    desc: 'Reads door — explore an area, trace a flow, or get impact' },
  { cmd: '/ss-check',   arg: '(gate) | drifted | health', desc: 'Gate & health door — run the gate, review drift, or see health' },
];

const MCP_TOOLS = ['specship_explore', 'specship_search', 'specship_spec', 'specship_link_verify'];

type ToolAccess = 'ask' | 'safe' | 'all';

@Component({
  selector: 'app-chat',
  imports: [Icon, Pill, Segmented, LogoMark],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat implements OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly api = inject(ApiService);

  protected readonly listEl = viewChild<ElementRef<HTMLDivElement>>('listEl');

  /** Teardown for the in-flight faux-stream, if any (called on done/error/destroy). */
  private closeStream?: () => void;

  protected readonly messages = signal<ChatMsg[]>([
    {
      role: 'assistant',
      text: 'Hi — ask anything about your specs, code, or recent Claude Code sessions.\n\nTry **/ss-spec REQ-AUTH-005** to inspect a requirement, or **/ss-explore validateSession** to walk its callers.',
    },
  ]);
  protected readonly draft = signal('');
  protected readonly thinking = signal(false);
  protected readonly contextCollapsed = signal(false);

  /** Which MCP tools the user has toggled on. */
  protected readonly enabledTools = signal<Set<string>>(new Set(MCP_TOOLS));
  protected readonly toolAccess = signal<ToolAccess>('safe');

  protected readonly slashCommands = SLASH_COMMANDS;
  protected readonly mcpTools = MCP_TOOLS;

  protected readonly toolAccessOptions = [
    { value: 'ask',  label: 'Ask' },
    { value: 'safe', label: 'Auto-safe' },
    { value: 'all',  label: 'All' },
  ];

  /** Show slash menu when text starts with '/' and has no space yet. */
  protected readonly showSlash = computed(() => {
    const d = this.draft();
    return d.startsWith('/') && !d.includes(' ');
  });

  protected readonly filteredSlash = computed(() => {
    const d = this.draft();
    return SLASH_COMMANDS.filter((s) => s.cmd.startsWith(d));
  });

  protected setDraft(v: string): void { this.draft.set(v); }

  protected onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.send();
    }
  }

  /**
   * Send the drafted question and faux-stream the deterministic reply.
   *
   * Opens the server SSE stream (REQ-DASH-CHAT-003) and grows a placeholder
   * assistant message as events arrive: `tool` appends the real tool-call card,
   * `result_summary` fills its truthful output, `chunk` appends answer text, and
   * `done` closes the stream. No model name, cost, or token count is ever set
   * (REQ-DASH-CHAT-004) — those would imply an LLM that never ran.
   */
  protected send(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.thinking.set(true);
    this.scrollToBottom();

    // Placeholder assistant message we grow in place as chunks stream in.
    const idx = this.messages().length;
    this.messages.update((m) => [...m, { role: 'assistant', text: '', tools: [] }]);

    this.closeStream?.();
    const path = '/api/chat/stream?question=' + encodeURIComponent(text);
    this.closeStream = this.api.openEventStream(
      path,
      (type, data) => this.onStreamEvent(idx, type, data),
      () => this.endStream(),
      ['thinking', 'tool', 'result_summary', 'chunk', 'done'],
    );
  }

  /** Apply one streamed event to the assistant message at `idx`. */
  private onStreamEvent(idx: number, type: string, data: unknown): void {
    switch (type) {
      case 'tool': {
        const d = (data ?? {}) as { name?: string; input?: string };
        this.patchMsg(idx, (m) => ({
          ...m,
          tools: [...(m.tools ?? []), { name: d.name ?? '', input: d.input ?? '', output: '', status: 'ok' }],
        }));
        break;
      }
      case 'result_summary': {
        const d = (data ?? {}) as { found?: boolean; sourceCount?: number };
        const n = d.sourceCount ?? 0;
        const summary = d.found ? `${n} source${n === 1 ? '' : 's'} returned` : 'no matches in the index';
        this.patchMsg(idx, (m) => {
          const tools = m.tools ?? [];
          if (tools.length === 0) return m;
          return { ...m, tools: tools.map((t, i) => (i === tools.length - 1 ? { ...t, output: summary } : t)) };
        });
        break;
      }
      case 'chunk': {
        const d = (data ?? {}) as { text?: string };
        const piece = d.text ?? '';
        this.patchMsg(idx, (m) => ({ ...m, text: m.text + piece }));
        this.scrollToBottom();
        break;
      }
      case 'done':
        this.endStream();
        break;
    }
  }

  /** Immutably replace the message at `idx` (signals never mutate in place). */
  private patchMsg(idx: number, fn: (m: ChatMsg) => ChatMsg): void {
    this.messages.update((msgs) => msgs.map((m, i) => (i === idx ? fn(m) : m)));
  }

  /** Stop the thinking indicator and tear down the stream (idempotent). */
  private endStream(): void {
    this.thinking.set(false);
    this.closeStream?.();
    this.closeStream = undefined;
    this.scrollToBottom();
  }

  ngOnDestroy(): void {
    this.closeStream?.();
    this.closeStream = undefined;
  }

  protected pickSlash(cmd: string): void {
    this.draft.set(cmd + ' ');
  }

  protected toggleTool(t: string): void {
    this.enabledTools.update((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });
  }

  protected setToolAccess(v: string): void { this.toolAccess.set(v as ToolAccess); }

  protected toggleContext(): void { this.contextCollapsed.update((v) => !v); }

  protected toggleToolCall(m: ChatMsg, tc: ToolCall): void {
    tc.open = !tc.open;
    this.messages.update((msgs) => [...msgs]); // trigger CD
  }

  protected renderMd(s: string): SafeHtml {
    const html = s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
      .replace(/`(.+?)`/g, '<code class="mono" style="font-size:12px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--node-spec)">$1</code>')
      .replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.listEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
