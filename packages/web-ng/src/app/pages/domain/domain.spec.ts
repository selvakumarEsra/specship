import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Domain } from './domain';
import { ApiService } from '../../api/api';
import type { DomainResponse, DriftResponse } from '../../api/types';

/**
 * Domain page (REQ-DOMAIN-006) — renders /api/domain grouped by type, with the
 * coverage strip and a drift-derived state chip per fact. We stub ApiService so
 * the component's two apiResources (domain + drift) resolve against fixtures;
 * ProjectsService / RefreshService / ConnectionService stay real (they all route
 * through the same stub).
 */

// Mutable per-test fixtures — set before createComponent.
let domainFixture: DomainResponse;
let driftFixture: DriftResponse;

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
    if (path.startsWith('/api/drift')) {
      return driftFixture as unknown as T;
    }
    throw new Error('unexpected path ' + path);
  }

  openEventStream(): () => void {
    return () => { /* noop */ };
  }
}

function link(specId: string, state: DriftResponse['links'][number]['state']) {
  return {
    id: Math.floor(specId.length + state.length),
    specId,
    specTitle: specId,
    targetFilePath: 'src/x.ts',
    targetQualifiedName: 'x',
    targetNodeKind: 'function',
    resolvedNodeId: 'n1',
    kind: 'implements',
    state,
    driftAxis: null,
    provenance: 'manual',
    confidence: 1,
    createdAt: 0,
    updatedAt: 0,
  } as DriftResponse['links'][number];
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
        term: [{ id: 'DOMAIN-TERM-1', title: 'Spec link', body: 'A row tying a spec to code.' }],
        rule: [{ id: 'DOMAIN-RULE-1', title: 'No bare import', body: 'Server must not bare-import.' }],
        decision: [{ id: 'DOMAIN-DEC-1', title: 'Claude Code only', body: 'One agent target.' }],
        constraint: [{ id: 'DOMAIN-CON-1', title: 'Local-first', body: 'Data lives in .specship/.' }],
        other: [],
      },
      coverage: { documented: 3, gaps: 2 },
    };
    driftFixture = {
      links: [
        link('DOMAIN-RULE-1', 'drifted'),
        link('DOMAIN-TERM-1', 'verified'),
      ],
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

  it('surfaces a Review affordance for a drifted fact', async () => {
    const fixture = await makeComponent();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t.includes('Review'))).toBe(true);
  });

  it('renders an empty state (no error) when the layer has no facts', async () => {
    domainFixture = {
      factsByType: { term: [], rule: [], decision: [], constraint: [], other: [] },
      coverage: { documented: 0, gaps: 0 },
    };
    driftFixture = { links: [] };
    const fixture = await makeComponent();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No domain knowledge captured yet');
    expect(text).not.toContain('Error');
  });
});
