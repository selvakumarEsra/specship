import fs from 'node:fs';
import path from 'node:path';

// Walk up from this file's location until we find package.json. Lets the
// vendored designer subtree locate its shipped resource (selectors.json) at
// the SpecShip install root regardless of layout:
//   - source mode: repo-root.ts at src/designer/ → walks up to the repo root.
//   - compiled mode (tsc → dist/designer/): repo-root.js → walks up past
//     dist/ to the dir holding SpecShip's package.json (the install root).
//
// Uses CommonJS `__dirname` — this subtree compiles to CJS under
// src/designer/tsconfig.json, so there is no `import.meta` to reconcile with
// SpecShip's `module: commonjs` toolchain.
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo-root: could not find package.json walking up from ' + __dirname);
}

export const REPO_ROOT: string = findRepoRoot();
