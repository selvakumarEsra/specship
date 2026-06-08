# `specship-cli` — unscoped shim for `@selvakumaresra/specship`

This is the **unscoped shim** for [`@selvakumaresra/specship`](https://www.npmjs.com/package/@selvakumaresra/specship). It exists so you can type:

```bash
npx specship-cli install
```

…instead of remembering the full scoped name:

```bash
npx @selvakumaresra/specship install
```

The shim has one file (a `bin` script that delegates to the real CLI) and one dependency: the actual `@selvakumaresra/specship` package. Installing either one gives you the full thing. The binary on `PATH` is always called `specship` — that part doesn't change.

> npm doesn't allow brand-new single-word unscoped names (anti-typosquat policy), so we use the `-cli` suffix here. Same product underneath.

## Install

```bash
# globally — installs the `specship` bin on your PATH
npm i -g specship-cli

# one-shot via npx
npx specship-cli --help
npx specship-cli install
npx specship-cli init -i
```

## What is SpecShip?

A local-first **workflow engine for AI coding agents**. Define multi-step development workflows in YAML, run them in isolated git worktrees from the CLI / desktop UI / GitHub Actions, with a knowledge graph of your code and specs backing every step.

- **Docs**: https://selvakumarEsra.github.io/specship/
- **GitHub**: https://github.com/selvakumarEsra/specship
- **Real package**: [`@selvakumaresra/specship`](https://www.npmjs.com/package/@selvakumaresra/specship)
- **License**: MIT
