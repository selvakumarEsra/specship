---
description: List spec→code links in concerning states (drifted, broken, orphaned). The non-coder review queue.
argument-hint: [--state drifted,broken,orphaned] [--limit N]
allowed-tools: mcp__specship__specship_drifted, Bash
---

# SpecShip Drift Queue

Call `mcp__specship__specship_drifted` to list spec links that need attention.

For a quick CLI view instead, run:

```bash
specship drifted $ARGUMENTS
```

Add `--fail-on=broken,drifted,orphaned` to make it exit non-zero — useful as a pre-commit or CI gate.

For each link returned:
- **drifted (drift_axis=spec)**: spec body changed; the code may be stale. Run `/cg-fix <SPEC_ID>` to investigate.
- **drifted (drift_axis=code)**: code's signature changed since the link was set. Re-verify with `mcp__specship__specship_link_verify` if behavior is still correct.
- **broken**: verification failed. Open the spec, find the failing test, fix the code.
- **orphaned**: target symbol no longer exists. Use `/cg-relink <SPEC_ID>` to re-attach.
