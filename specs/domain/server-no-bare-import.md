---
id: DOM-SPECSHIP-004
title: Dashboard server routes must not bare-import the package
type: constraint
depends_on: REQ-DOMAIN-007
---

# Dashboard server routes must not bare-import the package

Code under `packages/server` MUST NOT runtime-`import` from the bare
`@specship/specship` package. Doing so silently binds to a stale published
build — a new route 404s while its neighbors work. Server code MUST reach the
engine through the dynamically-loaded instance (e.g. `cg.getSpecQueries()`,
`cg.getDomainGapSeed()`) or server-local modules. This is enforced for the
`/api/domain` route by a source-scan test.
