/**
 * Domain page (REQ-DOMAIN-006 / REQ-DOMAIN-008).
 *
 * Renders the human-confirmed domain knowledge layer — facts grouped by type
 * (Terms / Rules / Decisions / Constraints, plus an Other catch-all) with a
 * coverage strip (documented · gaps). Each fact arrives from GET /api/domain
 * already enriched with the symbols it `governs` and the collapsed `state` of
 * that code (derived server-side from the fact's inherited spec→code links), so
 * the page renders the state chip and governed symbols directly — no client-side
 * cross-reference of /api/drift. A fact whose code has drifted surfaces a Review
 * affordance into the drift queue; every card always offers Capture, and an
 * empty layer prompts the author to capture knowledge.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { StatePill } from '../../ui/state-pill';
import { Empty } from '../../ui/empty';
import { Icon } from '../../shell/icon/icon';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type { DomainResponse, DomainFact, DomainFactType } from '../../api/types';

interface DomainSection {
  type: DomainFactType;
  label: string;
  facts: DomainResponse['factsByType'][DomainFactType];
}

/** Ordered fact groups. `other` only renders when it has facts. */
const SECTION_ORDER: ReadonlyArray<{ type: DomainFactType; label: string }> = [
  { type: 'term', label: 'Terms' },
  { type: 'rule', label: 'Rules' },
  { type: 'decision', label: 'Decisions' },
  { type: 'constraint', label: 'Constraints' },
  { type: 'other', label: 'Other' },
];

@Component({
  selector: 'app-domain',
  imports: [PageHead, Pill, StatePill, Empty, Icon, PickProjectEmpty],
  templateUrl: './domain.html',
  styleUrl: './domain.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Domain {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly resource = apiResource<DomainResponse>(
    this.api,
    () => `/api/domain${this.projects.projectQuery()}`,
  );

  protected readonly data = computed(() => this.resource.state().data);

  protected readonly coverage = computed(
    () => this.data()?.coverage ?? { documented: 0, gaps: 0 },
  );

  protected readonly sections = computed<DomainSection[]>(() => {
    const d = this.data();
    if (!d) return [];
    return SECTION_ORDER
      .map((s) => ({ ...s, facts: d.factsByType[s.type] ?? [] }))
      .filter((s) => s.facts.length > 0);
  });

  protected readonly total = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return SECTION_ORDER.reduce((n, s) => n + (d.factsByType[s.type]?.length ?? 0), 0);
  });

  /** No facts at all — distinct from "no project" and "still loading". */
  protected readonly isEmpty = computed(() => {
    const st = this.resource.state();
    return !st.loading && !st.noProject && st.data != null && this.total() === 0;
  });

  /** The chip state for a fact, or null when no linked code exists yet. */
  protected stateOf(f: DomainFact): DomainFact['state'] | null {
    return f.state === 'none' ? null : f.state;
  }

  /** True when a fact's governed code has drifted and wants attention. */
  protected needsReview(f: DomainFact): boolean {
    return f.state === 'drifted';
  }

  /** Jump to the drift queue to review a fact's drifted links. */
  protected review(): void {
    this.router.navigate(['/drift']);
  }
}
