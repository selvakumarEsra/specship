import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Domain } from './domain';
import { ApiService } from '../../api/api';
import type { DomainResponse } from '../../api/types';

/**
 * Domain page (REQ-DOMAIN-006 / REQ-DOMAIN-008) — renders /api/domain grouped by
 * type, with the coverage strip and the server-supplied per-fact `state` chip +
 * `governs` symbols. The page no longer cross-references /api/drift, so we stub
 * only /api/domain (and /api/projects). ProjectsService / RefreshService /
 * ConnectionService stay real (they all route through the same stub).
 */

// Mutable per-test fixture — set before createComponent.
let domainFixture: DomainResponse;

class MockApiService {
  get apiBase(): string { return 'http://test'; }
  get isConfigured(): boolean { return true; }

  async get<T>(path: string): Promise<T> {
    if (path.startsWith('/api/projects')) {
      return { claudeRoot: '/tmp', projects: [] } as unknown as T;
    }
    if (path.startsWith('/api/domain')) {
      return domainFixture as unknown as T;
    }
    throw new Error('unexpected path ' + path);
  }

  openEventStream(): () => void {
    return () => { /* noop */ };
  }
}

async function makeComponent() {
  TestBed.configureTestingModule({
    imports: [Domain],
    providers: [
      provideRouter([]),
      { provide: ApiService, useClass: MockApiService },
    ],
  });
  const fixture = TestBed.createComponent(Domain);
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('Domain', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    domainFixture = {
      factsByType: {
        term: [{
          id: 'DOMAIN-TERM-1', title: 'Spec link', body: 'A row tying a spec to code.',
          governs: [{ specId: 'REQ-LINK-1', symbol: 'SpecLinkResolver.resolveAll' }],
          state: 'verified',
        }],
        rule: [{
          id: 'DOMAIN-RULE-1', title: 'No bare import', body: 'Server must not bare-import.',
          governs: [{ specId: 'REQ-RULE-1', symbol: 'registerDomainRoutes' }],
          state: 'drifted',
        }],
        decision: [{
          id: 'DOMAIN-DEC-1', title: 'Claude Code only', body: 'One agent target.',
          governs: [], state: 'none',
        }],
        constraint: [{
          id: 'DOMAIN-CON-1', title: 'Local-first', body: 'Data lives in .specship/.',
          governs: [], state: 'none',
        }],
        other: [],
      },
      coverage: { documented: 3, gaps: 2 },
    };
  });

  it('renders the four type headings', async () => {
    const fixture = await makeComponent();
    const heads = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.sig-head'),
    ).map((el) => el.textContent ?? '');
    expect(heads.some((t) => t.includes('Terms'))).toBe(true);
    expect(heads.some((t) => t.includes('Rules'))).toBe(true);
    expect(heads.some((t) => t.includes('Decisions'))).toBe(true);
    expect(heads.some((t) => t.includes('Constraints'))).toBe(true);
  });

  it('shows the coverage strip with documented · gaps from the seed', async () => {
    const fixture = await makeComponent();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('3 documented');
    expect(text).toContain('2 gaps');
  });

  it('renders the governs symbols supplied by the server', async () => {
    const fixture = await makeComponent();
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.fact-governs-row'),
    ).map((el) => el.textContent ?? '');
    expect(rows.some((t) => t.includes('REQ-LINK-1') && t.includes('SpecLinkResolver.resolveAll'))).toBe(true);
    expect(rows.some((t) => t.includes('REQ-RULE-1') && t.includes('registerDomainRoutes'))).toBe(true);
  });

  it('surfaces a Review affordance only for a drifted fact', async () => {
    const fixture = await makeComponent();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent ?? '');
    // Exactly the one drifted fact (DOMAIN-RULE-1) gets a Review button.
    expect(buttons.filter((t) => t.includes('Review')).length).toBe(1);
  });

  it('never shows "No linked code yet" for a fact that resolves to code', async () => {
    const fixture = await makeComponent();
    const verifiedCard = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.fact'),
    ).find((el) => (el.textContent ?? '').includes('Spec link'));
    expect(verifiedCard).toBeTruthy();
    expect(verifiedCard!.textContent ?? '').not.toContain('No linked code yet');
  });

  it('shows "No linked code yet" for a fact with state none and no governs', async () => {
    const fixture = await makeComponent();
    const decisionCard = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.fact'),
    ).find((el) => (el.textContent ?? '').includes('Claude Code only'));
    expect(decisionCard!.textContent ?? '').toContain('No linked code yet');
  });

  it('renders an empty state (no error) when the layer has no facts', async () => {
    domainFixture = {
      factsByType: { term: [], rule: [], decision: [], constraint: [], other: [] },
      coverage: { documented: 0, gaps: 0 },
    };
    const fixture = await makeComponent();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No domain knowledge captured yet');
    expect(text).not.toContain('Error');
  });
});
