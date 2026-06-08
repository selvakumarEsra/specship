import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

interface ChatMsg { role: 'user' | 'assistant'; text: string; }

@Component({
  selector: 'app-chat',
  imports: [],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chat {
  protected readonly messages = signal<ChatMsg[]>([
    { role: 'assistant', text: 'Hi — ask anything about your specs, code, or recent Claude Code sessions. (Backed-by-Claude wiring lands when we plug the SSE channel in.)' },
  ]);
  protected readonly draft = signal('');

  protected setDraft(v: string): void { this.draft.set(v); }

  protected send(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.messages.update((m) => [
      ...m,
      { role: 'user', text },
      { role: 'assistant', text: '(stub) Chat backend not yet wired. The HTTP API + workflow runners are ready — this is the next surface to plug in.' },
    ]);
    this.draft.set('');
  }

  protected onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.send();
    }
  }
}
