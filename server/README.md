# `@specship/specship-server`

Single-process desktop app for SpecShip: a Fastify JSON API plus the built
React SPA (the `ui/` module) served from one Node process. No Docker, no
Electron, no separate frontend server — one binary, two URLs.

## Running it

Build the SPA and the server (see [Building](#building)), then launch:

```bash
node server/dist/cli.js \
  --project-root /path/to/your/project \
  --web-dir <repo>/ui/dist \
  --port 4242 \
  --open
```

Open `http://127.0.0.1:4242/`. The same port serves:

| URL                       | What                                                     |
|---------------------------|----------------------------------------------------------|
| `/`                       | The React SPA (`index.html` + hashed assets)             |
| any client-side route     | Falls back to `index.html` so `/memory`, `/graph`, … work |
| `/api/status`             | Backend / node-count / drift status                      |
| `/api/memory`             | CLAUDE.md hierarchy + `~/.claude` memory notes           |
| `/api/graph/*`            | Symbol search and node detail                            |
| `/api/claude/*`           | Sessions, heatmap, costs, tips, compare                  |
| `/api/spec/*`, `/api/workflows/*` | Specs, drift queue, workflows, runs              |
| `/api/config`, `/api/mcp/*`, `/api/chat` | Runtime config, MCP inventory, project chat |

### Flags

| Flag                    | Default         | Notes                                            |
|-------------------------|-----------------|--------------------------------------------------|
| `--project-root, -p`    | `$cwd`          | Project to open (must be `specship init`-ed)     |
| `--port`                | `4242`          | Loopback by default                              |
| `--host`                | `127.0.0.1`     | Bind addr                                        |
| `--web-dir`             | auto-detect     | Explicit path to the built SPA (`index.html` lives here) |
| `--no-web`              | off             | Headless mode — serve the API only               |
| `--no-ingest`           | off             | Skip the Claude JSONL transcript watcher         |
| `--open`                | off             | Open the UI in the default browser once live     |
| `--verbose, -v`         | off             | Verbose request logging                          |

### Env vars

* `SPECSHIP_PROJECT_ROOT` — alternative to `--project-root`.

## Building

From the repository root, build the SPA first, then the server bundle:

```bash
npm --prefix ui run build   # builds ui/dist (the React SPA)
npm run build:server        # bundles server/src → dist/server, copies ui/dist → dist/ui
```

`npm run build` at the root does both (core CLI + server bundle), and the
bundle copies `ui/dist` into `dist/ui` so an installed package ships the SPA
next to the server.

## How the UI is located at startup

`resolveDefaultWebDir()` probes these in order; the first with an `index.html`
wins (or `--web-dir` overrides):

1. `--web-dir <path>`
2. `<bundle>/dist/ui/` (production tarball layout — SPA copied next to the server)
3. `<root>/ui/dist/` (workspace layout — `server/dist` walked up to `ui/dist`)

If nothing is found and `--no-web` wasn't passed, the server runs headless
and serves the API only.

## SPA fallback

`@fastify/static` serves real assets (JS, CSS, fonts, favicons) but not
`index.html`. A not-found handler then catches every non-API GET and returns
a cached copy of `index.html` — that's what makes deep links like
`http://localhost:4242/specs/REQ-X` work on direct page loads. Non-GET methods
and any `/api/*` 404 stay as 404 so the UI can surface them properly. (Asset
URLs are absolute — see the SPA's `base: '/'` — so a fresh load at any route
depth resolves them from the origin root.)

## Why not Docker?

This package is a single-user local tool that reads the host's
`~/.claude/projects/*.jsonl` and a specific project root. Both would have to
be bind-mounted into a container, and `better-sqlite3`'s native binary forces
a per-arch Linux build. Single-binary Node ships those constraints without the
indirection.
