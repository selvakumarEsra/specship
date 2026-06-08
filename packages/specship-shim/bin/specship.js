#!/usr/bin/env node
'use strict';

/**
 * `specship` — thin shim that delegates to the scoped
 * `@selvakumaresra/specship` package.
 *
 * Exists so users can type `npx specship install` instead of
 * `npx @selvakumaresra/specship install` and have it Just Work.
 *
 * Implementation: resolve the scoped package via require.resolve (respects
 * any npm install layout, hoisted or not), then spawn its real bin with the
 * arguments we received. Signals and exit codes are propagated verbatim.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

function resolveRealBin() {
  let pkgPath;
  try {
    pkgPath = require.resolve('@selvakumaresra/specship/package.json');
  } catch (err) {
    process.stderr.write(
      'specship: cannot find @selvakumaresra/specship in the install tree.\n' +
        '         Try a clean install: npm i -g @selvakumaresra/specship\n' +
        (err && err.message ? '         (resolve error: ' + err.message + ')\n' : ''),
    );
    process.exit(1);
  }
  const pkg = require(pkgPath);
  const bin = pkg.bin;
  let rel;
  if (typeof bin === 'string') rel = bin;
  else if (bin && typeof bin.specship === 'string') rel = bin.specship;
  else {
    process.stderr.write('specship: @selvakumaresra/specship has no `specship` bin entry.\n');
    process.exit(1);
  }
  return path.resolve(path.dirname(pkgPath), rel);
}

const realBin = resolveRealBin();
const child = spawn(process.execPath, [realBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  process.stderr.write('specship: failed to launch real bin (' + err.message + ')\n');
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
      return;
    } catch {
      /* fall through to exit code 1 below */
    }
  }
  process.exit(typeof code === 'number' ? code : 1);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* ignore */ }
  });
}
