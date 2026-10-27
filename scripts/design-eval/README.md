# design.md pixel eval

Measures whether a small model builds a UI pixel-exact from `design.md`
(DESIGNMD-DOC). Results: `docs/benchmarks/design-md-pixel-eval.md`.

1. Serve the real Claude Design bundle and cut static screens from its render:
   ```bash
   (cd specs/specship-desktop && python3 -m http.server 8765 &)
   node scripts/design-eval/make-screens.cjs <work-dir>
   ```
   This writes `<work-dir>/design-{sidebar,header}/snapshot.html` with
   `styles.css`. Fix the sidebar frame to `display:flex` (row), then
   screenshot each snapshot with `compare.cjs` and keep those images as the
   references `ref-{sidebar,header}.png`.
2. Build design.md for each screen:
   `specship design extract design-<screen>/snapshot.html --out design-<screen>/design.md -p <work-dir>`.
   Then fill the authored sections (`fill.py <work-dir>` holds the text used
   in the recorded run) and pass `specship design check`.
3. Copy `compare.cjs` and `run-arm.sh` into `<work-dir>` and run (agent `haiku` or `flash`; Flash needs `GEMINI_API_KEY` in the environment and a `<work-dir>/gemhome/.gemini/settings.json` selecting `gemini-api-key`; `DESIGN_MD=<file>` builds from another design.md)
   `run-arm.sh <screen> <designmd|screenshot> <run#> <w> <h>`.
   - Each run gets an empty folder with only its one input file.
   - Each run uses headless `claude -p --model haiku` with no MCP servers, no
     shell and no settings.
4. `compare.cjs` screenshots the build at the screen's exact size and compares
   it with the reference pixel by pixel. It reports the share of pixels that
   are exactly equal (`exactPct`) and the share within 16/255 on every channel
   (`within16Pct`), and writes a red diff image.

Needs the e2e Playwright install (`npm --prefix e2e ci && npm --prefix e2e run install:browser`)
and network access for the React/Babel CDN scripts and Google Fonts.

## Added for the final run

- **`capture.cjs <url> <w> <h> <out-dir>`** captures any running app (for
  example rendered Figma React + Tailwind code) as a static
  `snapshot.html` + `styles.css`: rendered DOM, every stylesheet rule,
  scripts removed.
- **`STATE="hover|<locator>"` or `STATE="focus|<locator>"`** makes
  `compare.cjs` put one element in that state before the screenshot. Run it
  on the design's own snapshot to make the state reference.
- **`final-run.sh`** runs everything end to end:
  1. Haiku writes each design.md's authored sections.
  2. `specship design check` runs on each file.
  3. Haiku and Flash build 3 times per screen, plus screenshot-only
     baselines.
  4. `score-all.sh` scores every build at rest and in each state.

  Set `SPECSHIP_REPO`, `SPECSHIP_BIN` (optional) and `GEMINI_API_KEY`.
- **`cssdiff.cjs`** and **`where.cjs`** are diagnosis tools.
  - `cssdiff.cjs` compares computed styles element by element (set `ALL=1`
    for every property).
  - `where.cjs` reports where two screenshots differ and by how much.
