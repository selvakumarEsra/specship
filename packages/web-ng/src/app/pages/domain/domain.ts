/**
 * Domain page (REQ-DOMAIN-006).
 *
 * Renders the human-confirmed domain knowledge layer — facts grouped by type
 * (Terms / Rules / Decisions / Constraints, plus an Other catch-all) with a
 * coverage strip (documented · gaps). Each fact's verify/drift state chip is
 * derived by cross-referencing /api/drift on `specId === fact.id`, since
 * GET /api/domain carries no link/state info itself. A fact in a concerning
 * state surfaces a Review affordance into the drift queue; every card always
 * offers Capture, and an empty layer prompts the author to capture knowledge.
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
import type { DomainResponse, DomainFactType, DriftResponse, SpecLink } from '../../api/types';

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

/** Worst-first priority — the chip reflects the most actionable link state. */
const STATE_PRIORITY: ReadonlyArray<SpecLink['state']> = [
  'broken', 'orphaned', 'drifted', 'verified', 'implemented', 'implementing', 'drafted',
];

const REVIEW_STATES = new Set<SpecLink['state']>(['broken', 'orphaned', 'drifted']);

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

  // Full state set (not just the concerning default) so the chip can show
  // verified/implemented as well as drifted/broken.
  protected readonly drift = apiResource<DriftResponse>(
    this.api,
    () => `/api/drift?state=drafted,implementing,implemented,verified,drifted,broken,orphaned${this.projects.projectQuery('&')}`,
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

  /** Map a fact id → its drift links (a fact may have several). */
  private readonly linksByFact = computed<Map<string, SpecLink[]>>(() => {
    const links = this.drift.state().data?.links ?? [];
    const m = new Map<string, SpecLink[]>();
    for (const l of links) {
      const arr = m.get(l.specId);
      if (arr) arr.push(l);
      else m.set(l.specId, [l]);
    }
    return m;
  });

  /** The chip state for a fact, or null when no linked code exists yet. */
  protected stateOf(factId: string): SpecLink['state'] | null {
    const links = this.linksByFact().get(factId);
    if (!links?.length) return null;
    for (const state of STATE_PRIORITY) {
      if (links.some((l) => l.state === state)) return state;
    }
    return null;
  }

  /** True when a fact's linked code is in a state that wants attention. */
  protected needsReview(factId: string): boolean {
    const s = this.stateOf(factId);
    return s != null && REVIEW_STATES.has(s);
  }

  /** Jump to the drift queue to review a fact's drifted/broken links. */
  protected review(): void {
    this.router.navigate(['/drift']);
  }
}
