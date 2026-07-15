---
id: LINKFIX-DOC
title: Spec-link re-attachment and qualified-name matching
owner: core
priority: high
version: 1
---

<!-- id: LINKFIX-DOC -->
# Spec-link re-attachment and qualified-name matching

Two resolver defects leave spec→code links stuck in `orphaned` even though the
code they govern exists and is indexed:

1. `orphaned` is a one-way street — the resolver caches a fresh
   `resolved_node_id` when the target reappears but never transitions the
   link's state back, so a link orphaned once (e.g. during a repository
   restructure) stays orphaned forever.
2. Spec-declared targets use dotted qualified names (`Class.method`, the
   documented `implementations:` convention), while the extractors store
   `Class::method` — exact-equality lookup means every method-level spec link
   is born orphaned and can never resolve.

This document makes re-attachment and name matching correct so the drift queue
reflects reality.

<!-- id: REQ-LINKFIX-001 -->
## An orphaned link MUST re-attach when its logical target reappears

When a resolver pass (`resolveAll` or `resolveLinksForFiles`) finds the logical
target — same file path and qualified name — of a link currently in `orphaned`,
it MUST transition the link back to a live state, not merely refresh the
`resolved_node_id` cache. The landing state is `implemented`, and the pass MUST
immediately apply the normal code-drift comparison against the signature
baseline captured at link creation: a target that changed while the link was
orphaned surfaces as `drifted(code)`, never as silently healthy. Sticky states
(`verified`, `broken`) are unaffected — they are never orphaned in the first
place.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.resolveOneLink

## Acceptance
<!-- id: REQ-LINKFIX-001.A1 -->
- A link in `orphaned` whose target file path and qualified name match an
  indexed node again is in state `implemented` after the next resolver pass,
  with `resolved_node_id` pointing at that node.
<!-- id: REQ-LINKFIX-001.A2 -->
- If the reappeared node's signature differs from the link's
  `node_sig_at_link` baseline, the same pass leaves the link in `drifted` with
  `drift_axis = 'code'` instead of `implemented`.
<!-- id: REQ-LINKFIX-001.A3 -->
- The orphaned→implemented transition is recorded in the resolver stats
  transitions, so the session drift notice (REQ-DRIFT-PUSH-001) can report it.
<!-- id: REQ-LINKFIX-001.A4 -->
- The pass is idempotent: running it again over an already re-attached link
  changes nothing.

<!-- id: REQ-LINKFIX-002 -->
## Qualified-name matching MUST treat `Class.method` and `Class::method` as equivalent

Everywhere a spec link's logical target is resolved to an indexed node —
spec-declared `implementations:` candidates, `@implements` code comments,
agent-asserted links, and every re-resolution pass — the dotted form
(`Class.method`) and the extractor form (`Class::method`) of the same
qualified name MUST match the same node. Only the member separator is
normalized: names that differ in any other way MUST NOT match, and the
existing same-file and same-kind preferences are unchanged. Both forms of one
target MUST upsert to the same link row (one logical key), never two.

implementations:
  - src/resolution/spec-link-resolver.ts:SpecLinkResolver.findLogicalTarget

## Acceptance
<!-- id: REQ-LINKFIX-002.A1 -->
- A spec-declared entry `- src/workflows/executor.ts:WorkflowExecutor.reject`
  resolves to the node whose qualified name is `WorkflowExecutor::reject` in
  that file, and the link enters `implemented`.
<!-- id: REQ-LINKFIX-002.A2 -->
- Asserting the dotted form and the `::` form of the same target produces one
  link row, not two.
<!-- id: REQ-LINKFIX-002.A3 -->
- Names that differ beyond the separator do not match: `Foo.bar` matches
  neither `Foobar` nor `Foo::barbaz`.
<!-- id: REQ-LINKFIX-002.A4 -->
- Separator-free names (module-level functions like `planPurge`) resolve
  exactly as before.
