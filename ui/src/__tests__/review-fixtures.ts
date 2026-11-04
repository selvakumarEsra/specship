/**
 * Minimal /api/spec/coverage + /api/drift fixtures for suites that host the
 * shared SpecDetail pane on the Review screen (REQ-DASHSIMPLE-004). Each
 * requirement gets empty rollups — it lands in Pending, which is all these
 * suites need: a row to click and the detail pane beside it.
 */
export function reviewRoutes(reqs: Array<{ id: string; title: string }>): Record<string, unknown> {
  const empty = { count: 0, states: {} };
  return {
    '/api/spec/coverage': {
      specId: null,
      requirements: reqs.map((r) => ({
        specId: r.id, title: r.title, kind: 'requirement',
        implementsLinks: empty, testsLinks: empty, verdict: 'untested',
        criteria: [], criteriaTotals: { untested: 0, tested: 0, verified: 0, broken: 0 },
        criteriaWithTests: 0, criteriaCount: 0,
      })),
      totals: { requirements: reqs.length, criteria: 0, criteriaWithTests: 0, criteriaVerified: 0, criteriaBroken: 0 },
    },
    '/api/drift': { links: [] },
  };
}

/** The same fixture, derived from a /api/specs body's requirement rows. */
export function reviewRoutesFromSpecs(specs: { specs: Array<{ id: string; title: string; kind?: string }> }): Record<string, unknown> {
  return reviewRoutes(specs.specs.filter((s) => s.kind === 'requirement'));
}
