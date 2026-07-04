/**
 * Resolve the latest published version for an install method
 * (REQ-CLI-UPDATE-002 / 004). `fetch` is injected so the parsing is testable.
 *
 * - bundle → the GitHub `releases/latest` redirect lands on `.../tag/vX.Y.Z`;
 *   we read the version out of the final URL (same source `install.sh` uses).
 * - npm    → the registry packument's `dist-tags.latest`.
 *
 * Both throw on an unreachable / non-OK source so the caller (`runUpdate`) fails
 * cleanly without touching the existing install.
 */
import type { InstallMethod } from './updater';

const GITHUB_LATEST = 'https://github.com/selvakumarEsra/specship/releases/latest';
const NPM_PACKUMENT = 'https://registry.npmjs.org/@specship/specship';

export async function resolveLatestVersion(
  method: InstallMethod,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (method === 'npm') {
    const res = await fetchFn(NPM_PACKUMENT);
    if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
    const body = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    const latest = body['dist-tags']?.latest;
    if (!latest) throw new Error('npm registry returned no dist-tags.latest');
    return stripV(latest);
  }

  // bundle
  const res = await fetchFn(GITHUB_LATEST);
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const tag = (res.url || '').match(/\/releases\/tag\/([^/?#]+)/)?.[1];
  if (!tag) throw new Error(`could not read a release tag from ${res.url || '(no url)'}`);
  return stripV(tag);
}

function stripV(v: string): string {
  return v.replace(/^v/, '');
}
