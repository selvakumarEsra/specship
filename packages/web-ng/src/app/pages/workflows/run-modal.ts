/**
 * Workflow launch modal (WF-LAUNCH-DOC / REQ-WF-LAUNCH-001..003).
 *
 * Opened from a workflow card. Renders the workflow's declared inputs + its
 * `requires` prerequisites, then launches a real run via POST /api/workflows/runs
 * and navigates to `runs/:id`. Mirrors the design's `RunModal` in
 * `screens-workflows.jsx`; the launch is real, not the design's mock fixed-id nav.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { ProjectsService } from '../../api/projects';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import type { WorkflowDef } from '../../api/types';

interface RunStartResponse {
  runId: string;
  status: string;
}

@Component({
  selector: 'app-run-modal',
  imports: [Pill, Icon],
  templateUrl: './run-modal.html',
  styleUrl: './run-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class RunModal {
  readonly workflow = input.required<WorkflowDef>();
  readonly close = output<void>();

  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly vals = signal<Record<string, string>>({});
  protected readonly launching = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly inputs = computed(() => this.workflow().inputs ?? []);
  protected readonly requires = computed(() => this.workflow().requires ?? []);

  protected placeholderFor(name: string): string {
    return name === 'SPEC_ID' ? 'REQ-AUTH-005' : 'value…';
  }

  protected setVal(name: string, value: string): void {
    this.vals.update((v) => ({ ...v, [name]: value }));
  }

  protected onEscape(): void {
    if (!this.launching()) this.close.emit();
  }

  /** Backdrop click closes; panel click is stopped in the template. */
  protected onBackdrop(): void {
    if (!this.launching()) this.close.emit();
  }

  protected async launch(): Promise<void> {
    if (this.launching()) return;
    this.launching.set(true);
    this.error.set(null);
    try {
      const res = await this.api.post<RunStartResponse>(
        `/api/workflows/runs${this.projects.projectQuery()}`,
        { workflowName: this.workflow().name, inputs: this.vals() },
      );
      if (res?.runId) {
        this.close.emit();
        this.router.navigate(['/runs', res.runId]);
        return;
      }
      this.error.set('The server did not return a run id.');
      this.launching.set(false);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to launch run.');
      this.launching.set(false);
    }
  }
}
