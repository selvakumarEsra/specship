import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { Icon } from '../../shell/icon/icon';
import { StatePill } from '../../ui/state-pill';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';
import { Empty } from '../../ui/empty';
import { STATE } from '../../ui/state';
import { renderMd } from '../../util/render-md';
import type { SpecDetailResponse, Spec, SpecLink } from '../../api/types';

/** Strip embedded `<!-- id: REQ-X -->` markers — structural noise, not prose. */
function stripSpecMarkers(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

/** Worst-first ordering so the meta pill reflects the spec's least-healthy link. */
const STATE_RANK = ['broken', 'orphaned', 'drifted', 'drafted', 'implementing', 'implemented', 'verified'];

/** Per-criterion CritMark icon by state (mirrors the design's CRIT_ICON). */
const CRIT_ICON: Record<string, string> = {
  verified: 'check', implemented: 'check', completed: 'check',
  drifted: 'drift', broken: 'cancel', orphaned: 'cancel', failed: 'cancel',
};

/** Collapse a criterion's links into a single worst-first state. */
function critState(ls: SpecLink[]): string {
  if (!ls.length) return 'pending';
  if (ls.some((l) => l.state === 'broken')) return 'broken';
  if (ls.some((l) => l.state === 'orphaned')) return 'orphaned';
  if (ls.some((l) => l.state === 'drifted')) return 'drifted';
  if (ls.every((l) => l.state === 'verified')) return 'verified';
  return 'implemented';
}

interface Criterion { id: string; title: string; state: string; met: boolean; hasLinks: boolean; }

/**
 * Spec detail page (DASH-SPECDETAIL-DOC) — the right-hand pane of the
 * "SpecShip Desktop" Specs screen, as a standalone `/specs/:id` route. Reads
 * `GET /api/spec/:id` and renders the requirement, its acceptance criteria with
 * a met rollup, and the code it links to.
 */
@Component({
  selector: 'app-spec-detail',
  imports: [RouterLink, Icon, StatePill, Pill, CopyBtn, Empty],
  templateUrl: './spec-detail.html',
  styleUrl: './spec-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecDetail {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  // Reactive route param so navigating between specs re-fetches (REQ-001).
  private readonly paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  protected readonly specId = computed(() => this.paramMap().get('id') ?? '');

  protected readonly detail = apiResource<SpecDetailResponse>(this.api, () => {
    const id = this.specId();
    return id ? `/api/spec/${encodeURIComponent(id)}${this.projects.projectQuery()}` : null;
  });

  protected readonly loading = computed(() => this.detail.state().loading);
  protected readonly spec = computed<Spec | null>(() => this.detail.state().data?.spec ?? null);
  protected readonly links = computed<SpecLink[]>(() => this.detail.state().data?.links ?? []);
  private readonly children = computed<Spec[]>(() => this.detail.state().data?.children ?? []);
  private readonly childLinks = computed<Record<string, SpecLink[]>>(() => this.detail.state().data?.childLinks ?? {});

  /** Finished loading but the id resolved to no spec (404 / null) — REQ-001.A3. */
  protected readonly notFound = computed(() => !this.loading() && !!this.specId() && !this.spec());

  /** The spec's worst link state, for the header pill (REQ-002.A2). */
  protected readonly overallState = computed<string>(() => {
    const ls = this.links();
    if (!ls.length) return 'drafted';
    for (const st of STATE_RANK) {
      if (ls.some((l) => l.state === st)) return st;
    }
    return 'implemented';
  });

  /** Most recent verification time across links, or null (REQ-002). */
  protected readonly verifiedAt = computed<number | null>(() => {
    const v = this.links().filter((l) => l.state === 'verified').map((l) => l.updatedAt);
    return v.length ? Math.max(...v) : null;
  });

  /** Acceptance-kind children with a per-criterion met flag (REQ-004). */
  protected readonly criteria = computed<Criterion[]>(() => {
    const cl = this.childLinks();
    return this.children()
      .filter((c) => c.kind === 'acceptance')
      .map((c) => {
        const ls = cl[c.id] ?? [];
        const state = critState(ls);
        return { id: c.id, title: stripSpecMarkers(c.title).trim(), state, hasLinks: ls.length > 0, met: state === 'verified' };
      });
  });
  protected readonly metCount = computed(() => this.criteria().filter((c) => c.met).length);

  /** CritMark presentation for an acceptance criterion's collapsed state. */
  protected critIcon(state: string): string | null {
    return CRIT_ICON[state] ?? null;
  }
  protected critColor(state: string): string {
    return STATE[state]?.color ?? 'var(--text-muted)';
  }
  protected critBg(state: string): string {
    return STATE[state]?.bg ?? 'rgba(255,255,255,0.05)';
  }

  protected readonly bodyHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(renderMd(stripSpecMarkers(this.spec()?.body ?? ''))),
  );

  // ── Display helpers ────────────────────────────────────────────────────────

  protected stateColor(state: string): string {
    return STATE[state]?.color ?? 'var(--node-spec)';
  }
  protected stateLabel(state: string): string {
    return STATE[state]?.label ?? state;
  }

  /** Compact relative time, e.g. "2h ago". `now` injected only via the value. */
  protected relTime(ms: number): string {
    const diff = Date.now() - ms;
    const s = Math.max(0, Math.round(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24); return `${d}d ago`;
  }

  /** The file portion of a link's target, plus its symbol — `src/auth.ts:fn`. */
  protected linkTarget(l: SpecLink): string {
    return `${l.targetFilePath}:${l.targetQualifiedName}`;
  }

  // ── Actions (REQ-006) ──────────────────────────────────────────────────────

  /** Transient "copied" toast keyed by the action that fired it. */
  protected readonly copied = signal<string | null>(null);

  private copyCmd(cmd: string, key: string): void {
    try { navigator.clipboard?.writeText(cmd); } catch { /* clipboard unavailable */ }
    this.copied.set(key);
    setTimeout(() => { if (this.copied() === key) this.copied.set(null); }, 1800);
  }

  /** Implement / Verify are agent commands — copy the door command to run. */
  protected onImplement(): void {
    const id = this.spec()?.id; if (id) this.copyCmd(`/specship:spec implement ${id}`, 'implement');
  }
  protected onVerify(): void {
    this.copyCmd('/specship:check', 'verify');
  }
  /** Edit lives on the Specs page (Monaco editor); navigate there. */
  protected onEdit(): void {
    this.router.navigate(['/specs']);
  }
  /** Show the spec's neighborhood in the graph (focus param matches Specs page). */
  protected onShowInGraph(): void {
    const id = this.spec()?.id;
    this.router.navigate(['/graph'], { queryParams: id ? { focus: 'spec:' + id } : {} });
  }

  /** Reveal a linked symbol — focus it in the graph. */
  protected revealLink(l: SpecLink): void {
    this.router.navigate(['/graph'], { queryParams: { focus: this.linkTarget(l) } });
  }
}
