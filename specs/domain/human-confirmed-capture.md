---
id: DOM-SPECSHIP-003
title: Domain knowledge is human-confirmed, never auto-extracted
type: decision
depends_on: DOMAIN-DOC
---

# Domain knowledge is human-confirmed, never auto-extracted

We capture domain facts only on explicit human confirmation. The system MAY
detect gaps and draft a fact, but nothing reaches `specs/domain/` until a human
confirms it.

**Why:** SpecShip's value is deterministic, trustworthy extraction. Silently
auto-extracting interpretive "domain knowledge" would put guessed facts on equal
footing with AST-derived truth and erode that trust.

**Alternatives considered:** fully automatic concept-graph extraction (rejected
for v1 — too fuzzy, off-brand); a model-proposes/human-approves queue (kept, as
the `/ss-domain` interview).
