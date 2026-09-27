/**
 * Compressed grammar loading (SLIM-DOC, REQ-SLIM-002)
 *
 * The build ships oversized grammars as `<name>.wasm.gz`; the loader has to
 * make that invisible to callers. The integration case runs against the real
 * `dist/` — where the raw `.wasm` genuinely does not exist — because a fixture
 * can only prove the decompression path, not that the shipped build uses it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { resolveVendoredGrammar } from '../src/extraction/grammars';

const repoRoot = path.resolve(__dirname, '..');
const srcWasmDir = path.join(repoRoot, 'src', 'extraction', 'wasm');
const distWasmDir = path.join(repoRoot, 'dist', 'extraction', 'wasm');

// The dist-shaped assertions need a build; `npm test` on a clean clone has none.
const distBuilt = fs.existsSync(path.join(repoRoot, 'dist', 'extraction', 'index.js'));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'specship-wasmgz-'));
}

describe('resolveVendoredGrammar (SLIM-DOC)', () => {
  it('REQ-SLIM-002.A1: returns the plain path when the raw .wasm is present', () => {
    const dir = tempDir();
    try {
      const file = 'tree-sitter-fake.wasm';
      fs.writeFileSync(path.join(dir, file), Buffer.from([0, 97, 115, 109]));
      expect(resolveVendoredGrammar(dir, file)).toBe(path.join(dir, file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQ-SLIM-002.A1: returns the decompressed bytes when only the .wasm.gz is present', () => {
    const dir = tempDir();
    try {
      const file = 'tree-sitter-fake.wasm';
      const original = Buffer.from('\0asm-not-really-but-round-trips');
      fs.writeFileSync(path.join(dir, `${file}.gz`), zlib.gzipSync(original));
      const resolved = resolveVendoredGrammar(dir, file);
      expect(Buffer.isBuffer(resolved) || resolved instanceof Uint8Array).toBe(true);
      expect(Buffer.from(resolved as Uint8Array).equals(original)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQ-SLIM-002.A3: a corrupt .wasm.gz throws an error naming the file', () => {
    const dir = tempDir();
    try {
      const file = 'tree-sitter-fake.wasm';
      const gz = path.join(dir, `${file}.gz`);
      fs.writeFileSync(gz, Buffer.from('this is not gzip data at all'));
      expect(() => resolveVendoredGrammar(dir, file)).toThrow(/tree-sitter-fake\.wasm\.gz/);
      expect(() => resolveVendoredGrammar(dir, file)).toThrow(/Corrupt compressed grammar/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REQ-SLIM-002.A1: falls back to the plain path when neither shape exists', () => {
    const dir = tempDir();
    try {
      // Callers should see "grammar missing", not "archive missing".
      expect(resolveVendoredGrammar(dir, 'tree-sitter-absent.wasm')).toBe(
        path.join(dir, 'tree-sitter-absent.wasm')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.runIf(distBuilt)('shipped dist grammars (SLIM-DOC)', () => {
  it('REQ-SLIM-002.A1: dist carries scala/pascal only as .gz, and they decompress byte-identically', () => {
    for (const name of ['tree-sitter-scala.wasm', 'tree-sitter-pascal.wasm']) {
      expect(fs.existsSync(path.join(distWasmDir, name))).toBe(false);
      const gz = path.join(distWasmDir, `${name}.gz`);
      expect(fs.existsSync(gz)).toBe(true);
      const restored = zlib.gunzipSync(fs.readFileSync(gz));
      expect(restored.equals(fs.readFileSync(path.join(srcWasmDir, name)))).toBe(true);
    }
  });

  it('REQ-SLIM-002.A2: Scala and Pascal extraction work against the compressed build', () => {
    // Driven in a child process so it exercises dist/ (where only the .gz is
    // present) rather than the src/ grammars this suite already has loaded.
    const script = `
      (async () => {
        const { initGrammars, loadGrammarsForLanguages } = require('./dist/extraction/grammars');
        const { extractFromSource } = require('./dist/extraction');
        await initGrammars();
        await loadGrammarsForLanguages(['scala', 'pascal']);
        const scala = extractFromSource('UserService.scala',
          'class UserService(repo: Repo) {\\n  def findUser(id: Int): String = repo.get(id)\\n}\\n');
        const pascal = extractFromSource('Unit1.pas',
          'unit Unit1;\\ninterface\\nprocedure DoWork;\\nimplementation\\nprocedure DoWork;\\nbegin\\nend;\\nend.\\n');
        console.log(JSON.stringify({
          scala: scala.nodes.map(n => n.name),
          scalaErrors: scala.errors.map(e => e.message),
          pascal: pascal.nodes.map(n => n.name),
          pascalErrors: pascal.errors.map(e => e.message),
        }));
      })().catch(e => { console.error(e); process.exit(1); });
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = JSON.parse(stdout.trim().split('\n').pop()!);

    expect(out.scalaErrors).toEqual([]);
    expect(out.scala).toContain('UserService');
    expect(out.scala).toContain('findUser');
    expect(out.pascalErrors).toEqual([]);
    expect(out.pascal).toContain('DoWork');
  });
});
