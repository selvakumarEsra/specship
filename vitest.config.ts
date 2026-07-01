import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    /**
     * Several MCP integration tests (mcp-daemon, mcp-initialize, mcp-ppid-watchdog,
     * mcp-roots) spawn `dist/bin/specship.js serve --mcp` with `process.execPath`
     * and rely on the child inheriting `process.env`. On a Node >= 25 dev machine
     * the CLI's hard-block (src/bin/specship.ts) would otherwise exit the child
     * before it ever responds, so every spawn-based test times out — see #478.
     *
     * Setting the override here keeps the CLI's runtime guard intact for end
     * users (it's still enforced when `specship` is invoked directly) while
     * letting the test suite run on whatever Node the contributor happens to
     * have installed. CI on Node 22/23 is unaffected — the guard doesn't fire
     * there, so the variable is a no-op.
     */
    env: { SPECSHIP_ALLOW_UNSAFE_NODE: '1' },
    /**
     * Run test files in child-process forks and put `--liftoff-only` on each
     * fork's command line. Compiling tree-sitter's large WASM grammars on V8's
     * turboshaft optimizing tier OOMs the process (`Fatal … Zone`) on Node >= 22,
     * even with tens of GB free (see src/extraction/wasm-runtime-flags.ts, #293/#298).
     * The CLI self-relaunches with this flag; the test runner can't, so the full
     * suite crashed 3 grammar-heavy files on Node 24. `--liftoff-only` can't ride
     * `NODE_OPTIONS` or a worker_thread's `execArgv` (both reject it) — but a
     * child-process fork's `execArgv` accepts it, and a fork governs the WASM
     * compilation of any parse-worker it spawns. So flagging the forks fixes it.
     */
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--liftoff-only'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
