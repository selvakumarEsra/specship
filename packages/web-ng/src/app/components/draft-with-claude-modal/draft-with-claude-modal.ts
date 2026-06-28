import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { Icon } from '../../shell/icon/icon';

/**
 * "Draft new spec with Claude" modal — the Specs page's entry point to the
 * Claude Code spec-author skill.
 *
 * Two paths, picked at submit time:
 *   - **Open in Claude Code** — attempts to navigate to `claude://prompt?...`
 *     which a Claude Code install registers as a protocol handler. If the
 *     handler isn't registered the navigation silently no-ops, so we also
 *     copy to clipboard as a fallback before redirecting.
 *   - **Copy prompt to clipboard** — same prompt body, just no navigation.
 *
 * The modal never sends data to the dashboard backend. The intent is to
 * shuttle the user into Claude Code where the actual authoring happens.
 */
@Component({
  selector: 'app-draft-with-claude-modal',
  imports: [Icon],
  templateUrl: './draft-with-claude-modal.html',
  styleUrl: './draft-with-claude-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DraftWithClaudeModal {
  @Input() open = false;
  @Output() close = new EventEmitter<void>();

  protected readonly description = signal('');
  protected readonly toast = signal<string | null>(null);

  protected readonly slashCommand = computed(() => {
    // Intent door (DASH-DOORS-DOC): authoring a spec is `/ss-spec new`.
    const d = this.description().trim();
    if (!d) return '/ss-spec new';
    return `/ss-spec new "${d.replace(/"/g, '\\"')}"`;
  });

  protected readonly canSubmit = computed(() => this.description().trim().length > 0);

  protected onDescriptionInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.description.set(target.value);
  }

  protected onBackdropClick(): void {
    this.dismiss();
  }

  protected onCloseClick(): void {
    this.dismiss();
  }

  /** Open Claude Code via protocol handler. Falls back to clipboard copy. */
  protected async onOpenInClaude(): Promise<void> {
    if (!this.canSubmit()) return;
    const text = this.slashCommand();
    await this.writeToClipboard(text);
    try {
      window.location.href = `claude://prompt?text=${encodeURIComponent(text)}`;
      this.flashToast('Opening Claude Code… (also copied to clipboard)');
    } catch {
      this.flashToast('Claude Code handler unavailable — prompt copied to clipboard.');
    }
  }

  /** Just copy — no navigation. */
  protected async onCopyToClipboard(): Promise<void> {
    if (!this.canSubmit()) return;
    const text = this.slashCommand();
    const ok = await this.writeToClipboard(text);
    this.flashToast(ok ? 'Copied! Switch to Claude Code and paste.' : 'Could not access clipboard — copy the prompt manually.');
  }

  private async writeToClipboard(text: string): Promise<boolean> {
    if (!navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private flashToast(message: string): void {
    this.toast.set(message);
    setTimeout(() => this.toast.set(null), 2500);
  }

  private dismiss(): void {
    this.description.set('');
    this.toast.set(null);
    this.close.emit();
  }
}
