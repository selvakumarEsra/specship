---
id: DOM-SPECSHIP-001
title: Drift
type: term
depends_on: REQ-DOMAIN-002
---

# Drift

A spec→code **link** whose code target has changed since the link was created —
SpecShip compares the symbol's current signature against the snapshot taken when
the link was asserted, and flips the link to `drifted` when they differ. Drift is
how the graph tells a reviewer "the code that realizes this requirement moved out
from under it; re-verify." Sticky states (`verified`, `broken`) are not
overwritten by drift detection.
