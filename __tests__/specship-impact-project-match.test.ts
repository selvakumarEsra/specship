import { describe, it, expect } from 'vitest';
import { primaryProjectMatcher } from '../server/src/ingest/ingestor';

/**
 * Regression: Claude Code stores transcripts under a slug dir
 * (`-Users-a-dev-claude-projects-x`). The ingester derives project_path by
 * decoding that slug, which lossily turns EVERY '-' into '/', so a real path
 * `/Users/a/dev/claude-projects/x` is stored as `/Users/a/dev/claude/projects/x`.
 * The savings resolver keys off the REAL primary path, so it never matched the
 * mangled stored paths → graph always null → savedTokens always 0.
 *
 * primaryProjectMatcher must accept BOTH the real primary path and its mangled
 * stored form so the primary project's sessions resolve their graph.
 */
describe('primaryProjectMatcher', () => {
  it('matches the real primary path AND its lossy-decoded stored form', () => {
    const real = '/Users/superdeveloper/dev/claude-projects/specship';
    const mangled = '/Users/superdeveloper/dev/claude/projects/specship'; // hyphen → slash
    const matches = primaryProjectMatcher(real);

    expect(matches(real)).toBe(true);     // live ingest may pass the real cwd
    expect(matches(mangled)).toBe(true);  // stored project_path / backfill passes the mangled form
    expect(matches('/Users/superdeveloper/dev/claude-projects/other')).toBe(false);
    expect(matches('/some/unrelated/path')).toBe(false);
  });

  it('is a no-op-safe matcher for paths without hyphens', () => {
    const real = '/Users/a/dev/plainproject';
    const matches = primaryProjectMatcher(real);
    expect(matches(real)).toBe(true);
    expect(matches('/Users/a/dev/other')).toBe(false);
  });
});
