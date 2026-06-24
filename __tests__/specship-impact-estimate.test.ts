import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import SpecShip from '../src/index';

// The SpecShip constructor is private; instances are created via the static
// factory methods (init / open). close() is synchronous.

let dir: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('estimateReadEquivalent', () => {
  it('returns distinct files+sizes for resolved symbols; flags unresolved', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-impact-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function alpha(){ return 1 }\n'.repeat(20));

    // init() creates .specship + DB. indexAll() is separate here so we can
    // verify the exact sizeA against the real on-disk file after writing.
    const ss = await SpecShip.init(dir);
    await ss.indexAll();
    const sizeA = fs.statSync(path.join(dir, 'a.ts')).size;

    // --- hit: single known symbol resolves to a.ts ---
    const hit = ss.estimateReadEquivalent(['alpha']);
    expect(hit.resolved).toBe(true);
    // Node.filePath and FileRecord.path are both project-relative
    expect(hit.files).toEqual([{ path: 'a.ts', size: sizeA }]);

    // --- dedup: same symbol twice must not double-count the file ---
    const dup = ss.estimateReadEquivalent(['alpha', 'alpha']);
    expect(dup.files).toEqual([{ path: 'a.ts', size: sizeA }]);

    // --- miss: unknown symbol → resolved:false, no files ---
    const miss = ss.estimateReadEquivalent(['doesNotExist']);
    expect(miss.resolved).toBe(false);
    expect(miss.files).toEqual([]);

    // --- empty input → resolved:false, no files ---
    const empty = ss.estimateReadEquivalent([]);
    expect(empty.resolved).toBe(false);
    expect(empty.files).toEqual([]);

    ss.close();
  });
});
