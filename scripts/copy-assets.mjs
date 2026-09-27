/**
 * Build step: stage non-TypeScript assets into dist/.
 *
 * Grammar wasm above GZIP_THRESHOLD_BYTES is staged gzipped as `<name>.wasm.gz`
 * instead of raw — the loader in src/extraction/grammars.ts falls back to the
 * `.gz` when the plain `.wasm` is absent. Keeps the published package small
 * (REQ-SLIM-002) without a download-on-demand step. Sources in
 * src/extraction/wasm stay uncompressed in git.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const GZIP_THRESHOLD_BYTES = 200 * 1024;

fs.mkdirSync('dist/db', { recursive: true });
fs.copyFileSync('src/db/schema.sql', 'dist/db/schema.sql');

const wasmSrc = 'src/extraction/wasm';
const wasmOut = 'dist/extraction/wasm';
fs.mkdirSync(wasmOut, { recursive: true });
for (const file of fs.readdirSync(wasmSrc).filter((f) => f.endsWith('.wasm'))) {
  const from = path.join(wasmSrc, file);
  const bytes = fs.readFileSync(from);
  // Remove a stale artifact of the other shape so a threshold change can't
  // leave both a raw and a compressed copy in dist.
  fs.rmSync(path.join(wasmOut, file), { force: true });
  fs.rmSync(path.join(wasmOut, file + '.gz'), { force: true });
  if (bytes.length > GZIP_THRESHOLD_BYTES) {
    fs.writeFileSync(
      path.join(wasmOut, file + '.gz'),
      zlib.gzipSync(bytes, { level: zlib.constants.Z_BEST_COMPRESSION })
    );
  } else {
    fs.writeFileSync(path.join(wasmOut, file), bytes);
  }
}

try {
  fs.mkdirSync('dist/workflows/defaults', { recursive: true });
  for (const file of fs.readdirSync('src/workflows/defaults').filter((f) => /\.ya?ml$/i.test(f))) {
    fs.copyFileSync('src/workflows/defaults/' + file, 'dist/workflows/defaults/' + file);
  }
} catch {
  /* no workflow defaults in this tree */
}

for (const dir of ['commands', 'agents', 'hooks', 'skills', '.claude-plugin']) {
  try {
    fs.cpSync(dir, 'dist/' + dir, { recursive: true });
  } catch {
    /* optional asset dir */
  }
}
