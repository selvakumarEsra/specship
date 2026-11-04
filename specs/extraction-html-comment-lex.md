---
id: HTMLLEX-DOC
title: Declarations survive HTML-comment sequences in JS/TS literals
owner: extraction
priority: high
version: 1
epicKey: SSHIP-583
jira: SSHIP-584
jira_issue_REQ-HTMLLEX-001: SSHIP-584
jira_fingerprint_REQ-HTMLLEX-001: d6638bb81bc1580e
jira_issue_REQ-HTMLLEX-002: SSHIP-591
jira_fingerprint_REQ-HTMLLEX-002: 0e8b8b75af1fcc02
jira_issue_REQ-HTMLLEX-003: SSHIP-596
jira_fingerprint_REQ-HTMLLEX-003: c951760120cc49ab
---

<!-- id: HTMLLEX-DOC -->
# Declarations survive HTML-comment sequences in JS/TS literals

The vendored tree-sitter TypeScript/JavaScript grammar lexes `<!--` and `-->`
as Annex-B HTML-like comments even when they sit inside a regex literal. The
enclosing declaration then parses as an `ERROR` node and the extractor drops
it without a word, while still indexing its local constants. Minimal repro:

```ts
function a() { return /-->/; }
// → (program (ERROR (identifier) parameters: (formal_parameters)) (html_comment))
```

Any code that strips or matches HTML comments with a regex (`/<!--[\s\S]*?-->/`)
is affected. In this repository nine files lose symbols. Among them are
`checkDesignMd` and `runDesignCheckCli` in `src/design-md/check.ts`,
`reqEvkind005A5` in `__tests__/criterion-ids.test.ts`, and the Gemini installer
and design-md upkeep test functions, so 17 spec links are born `orphaned`.
Retrieval misses those symbols too: `specship_explore` and `specship_search`
can't return them, and the agent falls back to Read/Grep.

This document makes those declarations extract correctly, heals existing
indexes on upgrade, and stops parse errors from dropping declarations without
telling anyone.

**Non-goals.** Recovering declarations from source that is genuinely
malformed (REQ-HTMLLEX-003 only reports those); changing grammars or
extraction for languages outside the JS/TS family; and giving real
`<!--` / `-->` comments in legacy non-module scripts any new meaning.

**Test plan.** Unit tests in `__tests__/extraction.test.ts` cover
REQ-HTMLLEX-001.A1–A4 and REQ-HTMLLEX-003.A1–A2. A fixture index built by the
pre-fix extractor covers REQ-HTMLLEX-002.A1–A3. A self-index assertion over
this repository covers REQ-HTMLLEX-001.A5. The existing extraction suite,
passing unmodified, covers REQ-HTMLLEX-001.A6.

<!-- id: REQ-HTMLLEX-001 -->
## Declarations containing `<!--` or `-->` inside literals MUST be extracted

For TypeScript, TSX, JavaScript and JSX sources, a declaration whose body
contains `<!--` or `-->` inside a regex, string or template literal MUST
produce the same nodes and edges it would produce if those sequences were
absent. Emitted node names, qualified names, line/column ranges and source
text MUST describe the original, unaltered source. Real JavaScript semantics
are preserved: the postfix-decrement-then-compare form `x-->0` is code, not a
comment.

implementations:
  - src/extraction/tree-sitter.ts:TreeSitterExtractor.extract

## Acceptance
<!-- id: REQ-HTMLLEX-001.A1 -->
- `function a() { return /-->/; }` and `function a() { return /<!--/; }`
  each extract a `function` node named `a`, spanning line 1, in `.ts`, `.tsx`,
  `.js` and `.jsx` files.
<!-- id: REQ-HTMLLEX-001.A2 -->
- An exported function whose body uses `/<!--[\s\S]*?-->/g` extracts with
  the same name, qualified name, start/end line, and `calls` edges as the
  same function with that regex replaced by `/x/g`.
<!-- id: REQ-HTMLLEX-001.A3 -->
- The emitted node's signature and source text for that function contain the
  literal `<!--` and `-->` characters exactly as written in the file.
<!-- id: REQ-HTMLLEX-001.A4 -->
- `function f(x: number) { while (x-->0) {} }` extracts `f`. The existing
  behaviour of `<!--` and `-->` inside string literals (already correct) is
  unchanged.
<!-- id: REQ-HTMLLEX-001.A5 -->
- Indexing this repository yields function nodes for
  `src/design-md/check.ts:checkDesignMd`,
  `src/design-md/check.ts:runDesignCheckCli`,
  `__tests__/criterion-ids.test.ts:reqEvkind005A5` and
  `__tests__/design-md-upkeep.test.ts:uiChangeWithoutChangeLogFails`, and
  the spec links that target them are no longer `orphaned`.
<!-- id: REQ-HTMLLEX-001.A6 -->
- Extraction output for non-JS-family languages is byte-for-byte unchanged
  (the existing extraction suite passes unmodified).

<!-- id: REQ-HTMLLEX-002 -->
## Existing indexes MUST recover the dropped declarations on the next sync

An index built before this fix holds files whose content hash is current but
whose declarations were dropped, and today's incremental sync skips them as
up to date. After upgrading, the first `specship sync` (or MCP auto-sync, or
`specship index`) MUST re-extract every file whose stored extraction predates
the fix, with no manual reindex and no user action. Files unaffected by the
fix MAY be re-extracted too. Correctness wins over the one-off cost.

implementations:
  - src/extraction/index.ts:ExtractionOrchestrator
  - src/extraction/index.ts:ExtractionOrchestrator.sync
  - src/extraction/index.ts:ExtractionOrchestrator.indexAll
  - src/extraction/index.ts:ExtractionOrchestrator.isExtractionStale
  - src/extraction/index.ts:ExtractionOrchestrator.stampExtractionVersion
  - src/extraction/index.ts:ExtractionOrchestrator.storeExtractionResult
  - src/extraction/index.ts:EXTRACTION_VERSION

verifies:
  - __tests__/htmllex-recovery.test.ts:reqHtmllex002A1
  - __tests__/htmllex-recovery.test.ts:reqHtmllex002A2
  - __tests__/htmllex-recovery.test.ts:reqHtmllex002A3
  - __tests__/htmllex-recovery.test.ts:reqHtmllex002A4
  - __tests__/htmllex-recovery.test.ts:reqHtmllex002ScopedSyncDoesNotStamp

## Acceptance
<!-- id: REQ-HTMLLEX-002.A1 -->
- Given an index created by the pre-fix extractor containing a file with a
  `-->` regex inside a function, running `specship sync` after the upgrade,
  with no file changes, adds that function's node.
<!-- id: REQ-HTMLLEX-002.A2 -->
- A second `specship sync` with no file changes re-extracts nothing
  (the recovery runs once).
<!-- id: REQ-HTMLLEX-002.A3 -->
- Spec links whose targets reappear through this recovery leave `orphaned`
  in the same pass (via the existing re-attach behaviour, REQ-LINKFIX-001).
<!-- id: REQ-HTMLLEX-002.A4 -->
- `CHANGELOG.md` `[Unreleased]` carries a `### Fixes` entry stating that
  functions containing HTML-comment text in a regex were missing from the
  index and are restored automatically on the next sync.

<!-- id: REQ-HTMLLEX-003 -->
## A parse error that swallows declarations MUST be reported, not silent

Whatever the cause, when a source file's parse tree contains an error region
that encloses code which produced no declaration node, extraction MUST emit a
`warning`-severity extraction error naming the file and the region's line
range. Indexing still stores everything it did extract, and the file is not
counted as errored. The warning is for humans and for the next bug report.
It MUST NOT change what retrieval tools return.

implementations:
  - src/extraction/tree-sitter.ts:TreeSitterExtractor.extract

## Acceptance
<!-- id: REQ-HTMLLEX-003.A1 -->
- Extracting a file containing a genuinely malformed function (for example a
  missing closing brace) returns an `errors[]` entry with
  `severity: 'warning'`, a stable `code` [needs review: name, e.g.
  `parse_error_region`], the `filePath`, and the region's start `line`.
<!-- id: REQ-HTMLLEX-003.A2 -->
- A file that parses with no error regions emits no such warning. After
  REQ-HTMLLEX-001, none of this repository's nine previously affected files
  emits one.
<!-- id: REQ-HTMLLEX-003.A3 -->
- `specship index` and `specship sync` report the count of files carrying
  this warning in their completion summary [needs review: exact surface;
  status/doctor optional], and the file's other nodes are still stored.
