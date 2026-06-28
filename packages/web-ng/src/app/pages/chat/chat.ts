import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, inject, viewChild } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Icon } from '../../shell/icon/icon';
import { Pill } from '../../ui/pill';
import { Segmented } from '../../ui/segmented';
import { ApiService } from '../../api/api';

interface ToolCall { name: string; input: string; output: string; status: 'ok' | 'error'; open?: boolean; }
interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolCall[];
  cost?: number;
  tokens?: number;
  model?: string;
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
  imports: [Icon, Pill, Segmented],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly api = inject(ApiService);

  protected readonly listEl = viewChild<ElementRef<HTMLDivElement>>('listEl');

  protected readonly messages = signal<ChatMsg[]>([
    {
      role: 'assistant', model: 'Opus 4',
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

  protected send(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    this.messages.update((m) => [...m, { role: 'user', text }]);
    this.thinking.set(true);
    this.scrollToBottom();

    setTimeout(() => {
      this.thinking.set(false);
      // Intent door (/ss-spec) routes to the spec tool; everything else reads.
      const toolName = text.startsWith('/ss-spec') ? 'specship_spec' : 'specship_explore';
      const symbol = text.split(' ')[1] || 'validateSession';
      this.messages.update((m) => [...m, {
        role: 'assistant',
        model: 'Opus 4',
        text: text.startsWith('/ss-spec')
          ? 'Looking that up in the graph — the spec resolves to one link. See the **state** pill and linked code below for whether it\'s drifted.'
          : 'Got it. I\'ll use the specship tools to answer that with structural context rather than re-reading files. Here\'s what I found in the current project\'s graph.',
        tools: [{ name: toolName, input: symbol, output: '3 nodes · 2 edges returned', status: 'ok' }],
        cost: +(Math.random() * 0.3 + 0.15).toFixed(2),
        tokens: Math.round(Math.random() * 8000 + 6000),
      }]);
      this.scrollToBottom();
    }, 1100);
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

  protected fmtK(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
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
