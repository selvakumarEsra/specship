import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Icon } from '../../shell/icon/icon';
import { renderMd } from '../../util/render-md';
import { loadMonaco } from './monaco-loader';
import { registerSpecLanguage, runSpecDiagnostics } from './spec-language';

/** Diagnostic counts surfaced to the parent component via valueChange. */
export interface SpecEditorValidationState {
  errors: number;
  warnings: number;
}

/**
 * Standalone Monaco-backed spec editor.
 *
 * Lazy-loads `monaco-editor` on first mount via {@link loadMonaco}. Hosts a
 * split pane: the Monaco editor on the left, a live-preview rendered via the
 * shared `renderMd()` util on the right. Emits `valueChange` on every edit
 * (debounced is left to the parent — Monaco's `onDidChangeContent` fires
 * per keystroke; the parent should debounce server writes).
 *
 * Why not an Angular Monaco wrapper:
 *   - Wrappers (ngx-monaco-editor-v2, etc.) add their own lifecycle layer
 *     and tend to lag Monaco upstream releases. The amount of glue we
 *     need is small enough to write directly.
 *   - Direct use lets us control the lazy-load contract precisely, which
 *     matters because Monaco is the heaviest dep in the dashboard.
 */
@Component({
  selector: 'app-spec-editor',
  imports: [Icon],
  templateUrl: './spec-editor.html',
  styleUrl: './spec-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecEditor implements AfterViewInit, OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  @Input() value = '';
  @Input() path = '';

  @Output() valueChange = new EventEmitter<string>();
  @Output() validationChange = new EventEmitter<SpecEditorValidationState>();
  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  protected readonly loading = signal(true);
  protected readonly currentValue = signal('');
  protected readonly errorCount = signal(0);
  protected readonly warningCount = signal(0);
  protected readonly dirty = signal(false);

  protected readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(renderMd(this.currentValue() || '')),
  );

  protected readonly tokenCount = computed(() =>
    Math.max(1, Math.round((this.currentValue() || '').length / 4)),
  );

  protected readonly statusLabel = computed(() => {
    const e = this.errorCount();
    const w = this.warningCount();
    if (e > 0) return `${e} error${e === 1 ? '' : 's'}`;
    if (w > 0) return `${w} warning${w === 1 ? '' : 's'}`;
    return 'clean';
  });

  protected readonly statusKind = computed(() =>
    this.errorCount() > 0 ? 'error' : this.warningCount() > 0 ? 'warn' : 'ok',
  );

  private monaco: typeof import('monaco-editor') | null = null;
  private editor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;
  private model: import('monaco-editor').editor.ITextModel | null = null;
  private diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;

  async ngAfterViewInit(): Promise<void> {
    this.currentValue.set(this.value);
    try {
      const monaco = await loadMonaco();
      this.monaco = monaco;
      registerSpecLanguage(monaco);

      this.model = monaco.editor.createModel(this.value, 'markdown');
      this.editor = monaco.editor.create(this.hostRef.nativeElement, {
        model: this.model,
        theme: this.preferDark() ? 'vs-dark' : 'vs',
        automaticLayout: true,
        wordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'none',
        fontSize: 13,
        lineNumbers: 'on',
        folding: false,
        tabSize: 2,
        insertSpaces: true,
        contextmenu: false,
      });

      this.editor.onDidChangeModelContent(() => this.handleEdit());
      this.runDiagnosticsNow();
      this.loading.set(false);
    } catch (e) {
      // Loading Monaco failed — surface as a one-line error in the host.
      // Avoid throwing so the rest of the page stays responsive.
      console.error('[spec-editor] failed to load Monaco', e);
      this.loading.set(false);
    }

    this.destroyRef.onDestroy(() => this.dispose());
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  /** Save button handler — emits to the parent, which calls PUT /api/spec/:id. */
  protected onSave(): void {
    this.save.emit();
  }

  protected onCancel(): void {
    this.cancel.emit();
  }

  private handleEdit(): void {
    if (!this.model) return;
    const next = this.model.getValue();
    this.currentValue.set(next);
    this.dirty.set(next !== this.value);
    this.valueChange.emit(next);

    // Debounce diagnostics so per-keystroke runs don't pile up.
    if (this.diagnosticsTimer !== null) clearTimeout(this.diagnosticsTimer);
    this.diagnosticsTimer = setTimeout(() => this.runDiagnosticsNow(), 500);
  }

  private runDiagnosticsNow(): void {
    if (!this.monaco || !this.model) return;
    runSpecDiagnostics(this.monaco, this.model);
    const all = this.monaco.editor.getModelMarkers({ resource: this.model.uri, owner: 'specship-spec' });
    const errors = all.filter((m) => m.severity === this.monaco!.MarkerSeverity.Error).length;
    const warnings = all.filter((m) => m.severity === this.monaco!.MarkerSeverity.Warning).length;
    this.errorCount.set(errors);
    this.warningCount.set(warnings);
    this.validationChange.emit({ errors, warnings });
  }

  private preferDark(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  private dispose(): void {
    if (this.diagnosticsTimer !== null) {
      clearTimeout(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
    this.editor?.dispose();
    this.editor = null;
    this.model?.dispose();
    this.model = null;
  }
}
