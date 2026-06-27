---
id: DOM-SPECSHIP-002
title: Domain facts attach only at the spec tier
type: rule
depends_on: REQ-DOMAIN-002
---

# Domain facts attach only at the spec tier

A domain fact MUST link to one or more requirement **specs**, never directly to a
code symbol. Its association with code — and therefore its drift state — is
inherited transitively through the linked spec's own `implements` links. This
keeps a single source of truth for code linkage (the spec layer) and means a
domain fact reflects drift automatically with no separate tracking.
