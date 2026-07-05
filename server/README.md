# `@specship/specship-server`

Single-process desktop app for SpecShip / SpecShip: Fastify API + the
Angular UI ship in one Node process. No Docker, no Electron, no separate
frontend server — one binary, two URLs.

## Running it

After `npm run build:all` (see below), launch:

```bash
node server/dist/cli.js \
  --project-root /path/to/your/project \
  --port 4242 \
  --open
```

Open `http://127.0.0.1:4242/`. The same port serves:

| URL                       | What                                                     |
|---------------------------|----------------------------------------------------------|
| `/`                       | The Angular SPA (`index.html` + assets)                  |
| any client-side route     | Falls back to `index.html` so `/memory`, `/graph`, … work |
| `/api/status`             | Backend / node-count / drift status                      |
| `/api/memory`             | CLAUDE.md hierarchy + `~/.claude/memory` notes           |
| `/api/graph/*`            | Symbol search and node detail                            |
| `/api/claude/*`           | Sessions, heatmap, costs, tips, compare                  |
| `/api/spec/*`, `/api/workflows/*` | Specs, drift queue, workflows, runs              |

### Flags

| Flag                    | Default         | Notes                                            |
|-------------------------|-----------------|--------------------------------------------------|
| `--project-root, -p`    | `$cwd`          | Project to open (must be `specship init`-ed)    |
| `--port`                | `4242`          | Loopback by default                              |
| `--host`                | `127.0.0.1`     | Bind addr                                        |
| `--web-dir`             | auto-detect     | Override the UI directory                        |
| `--no-web`              | off             | Headless mode — serve the API only               |
| `--no-ingest`           | off             | Skip the Claude JSONL transcript watcher         |
| `--open`                | off             | Open the UI in the default browser once live     |
| `--verbose, -v`         | off             | Enables `pino-pretty` request logging            |

### Env vars

* `SPECSHIP_PROJECT_ROOT` / `SPECSHIP_PROJECT_ROOT` — alternative to `-p`
* `SPECSHIP_WEB_DIR` / `SPECSHIP_WEB_DIR` — alternative to `--web-dir`

## Building

The bundled build does three things in order: builds the Angular SPA,
builds the server's TypeScript, copies the SPA into `public/web/` so it
ships with the npm tarball.

```bash
cd server
npm run build:all
```

Individual steps if you need them:

```bash
npm run build:web      # builds packages/web-ng/dist/web-ng/browser
npm run build          # tsc → dist/, chmods dist/cli.js
npm run build:bundle   # copy web → public/web (run after build:web)
```

## How the UI is located at startup

The CLI's `locateWebDir` tries these in order; the first one with an
`index.html` wins:

1. `--web-dir <path>`
2. `$SPECSHIP_WEB_DIR` / `$SPECSHIP_WEB_DIR`
3. `<package>/public/web/` (production tarball layout)
4. `<package>/../public/web/` (sibling layout)
5. `packages/web-ng/dist/web-ng/browser` relative to the running script
6. `packages/web-ng/dist/web-ng/browser` walked up from `cwd`

If nothing is found and `--no-web` wasn't passed, the server logs `UI:
(none — running headless)` and serves API-only.

## SPA fallback

`@fastify/static` is registered with `index: false` and `wildcard: false`,
so it serves real assets (JS, CSS, fonts, favicons) but not `index.html`.
The `setNotFoundHandler` then catches every non-API GET and returns a
cached copy of `index.html` — that's what makes deep links like
`http://localhost:4242/memory` work on direct page loads. Non-GET methods
and any `/api/*` 404 stay as 404 so the UI can surface them properly.

## Why not Docker?

This package is a single-user local tool that reads the host's
`~/.claude/projects/*.jsonl` and a specific project root. Both would have
to be bind-mounted into the container, and `better-sqlite3`'s native
binary forces a per-arch Linux build. Single-binary Node ships those
constraints without the indirection.
