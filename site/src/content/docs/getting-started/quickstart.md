---
title: Get Started
description: Get up and running with SpecShip in seconds.
---

Get up and running with SpecShip in seconds.

## One command grabs the right build for your OS (needs Node 22.5+, below 25)

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/selvakumarEsra/specship/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/selvakumarEsra/specship/main/install.ps1 | iex
```

## Already have Node? Use npm instead (works on any version)

```bash
npx @specship/specship        # zero-install, or:
npm i -g @specship/specship
```

Nothing to compile, no native build — it runs on the Node.js already on your machine (22.5 or newer, below 25) and works the same everywhere. SpecShip is **Claude Code only**; run `specship install` to wire it in (project-local by default).

## Initialize Projects

```bash
cd your-project
specship init
```

That's it — Claude Code will use SpecShip tools automatically when a `.specship/` directory exists.

Next: build [Your First Graph](/getting-started/your-first-graph/), or see the full [Installation](/getting-started/installation/) options.
