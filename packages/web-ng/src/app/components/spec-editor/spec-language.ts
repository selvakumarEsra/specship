/**
 * Monaco language hooks for SpecShip spec markdown.
 *
 * Two surfaces:
 *
 *   1. **Snippets** — IntelliSense completions for the spec author's most
 *      common typing patterns: a new REQ block, an Acceptance section,
 *      an `implementations:` block, the document frontmatter.
 *
 *   2. **Diagnostics** — flag the markdown patterns the SpecShip parser
 *      rejects: a heading without `<!-- id: -->` above it (the
 *      `spec_missing_id` error), two consecutive ID markers (the
 *      `spec_stranded_id` warning), and duplicate REQ IDs in the file.
 *      Hooked via `setModelMarkers`, debounced 500 ms on edits.
 */

import type * as MonacoNS from 'monaco-editor';

export type Monaco = typeof MonacoNS;

/** Registered once per Monaco instance — caller's responsibility to ensure singleton. */
let registered = false;

/**
 * Register the language hooks against the running Monaco instance.
 * Idempotent — safe to call from every <app-spec-editor> mount.
 */
export function registerSpecLanguage(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  registerSnippets(monaco);
}

/**
 * Run the diagnostics pass against a model and emit markers. Call after
 * each edit (debounced) — Monaco replaces the prior marker set under the
 * `specship-spec` owner string each call, so no cleanup needed between
 * passes.
 */
export function runSpecDiagnostics(monaco: Monaco, model: MonacoNS.editor.ITextModel): void {
  const markers: MonacoNS.editor.IMarkerData[] = [];
  const lines = model.getValue().split('\n');

  // Track which line we last saw an ID marker on, and what ID it carried.
  let pendingId: { id: string; line: number } | null = null;
  const seenIds = new Map<string, number>();

  const ID_RE = /<!--\s*id\s*:\s*([^\s-][^\s]*)\s*-->/;
  const HEADING_RE = /^#{1,6}\s+/;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? '';
    const lineNumber = i + 1; // Monaco markers are 1-indexed

    const idMatch = ln.match(ID_RE);
    if (idMatch && idMatch[1]) {
      if (pendingId !== null) {
        // Two ID comments in a row — the previous one is stranded.
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `Stranded <!-- id: ${pendingId.id} -->: no heading follows on line ${pendingId.line + 1}.`,
          startLineNumber: pendingId.line + 1,
          startColumn: 1,
          endLineNumber: pendingId.line + 1,
          endColumn: (lines[pendingId.line] ?? '').length + 1,
          code: 'spec_stranded_id',
        });
      }
      const id = idMatch[1];
      pendingId = { id, line: i };

      // Duplicate-ID detection — keep the first occurrence as the source
      // of truth; flag every later occurrence.
      const prior = seenIds.get(id);
      if (prior !== undefined) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `Duplicate spec ID "${id}" — first seen on line ${prior + 1}. The second occurrence will be silently lost by the parser.`,
          startLineNumber: lineNumber,
          startColumn: ln.indexOf(id) + 1,
          endLineNumber: lineNumber,
          endColumn: ln.indexOf(id) + id.length + 1,
          code: 'spec_duplicate_id',
        });
      } else {
        seenIds.set(id, i);
      }
      continue;
    }

    if (HEADING_RE.test(ln)) {
      if (pendingId === null) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: 'This heading has no embedded ID. Add `<!-- id: REQ-X -->` on the line above it — required by the SpecShip parser.',
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: ln.length + 1,
          code: 'spec_missing_id',
        });
      } else {
        pendingId = null;
      }
    }
  }

  monaco.editor.setModelMarkers(model, 'specship-spec', markers);
}

/**
 * Register the snippet completion provider against Markdown. Triggered by
 * typing the snippet prefix (`req`, `doc`, `accept`, `impl`) at the start
 * of a word.
 */
function registerSnippets(monaco: Monaco): void {
  monaco.languages.registerCompletionItemProvider('markdown', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: MonacoNS.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const Kind = monaco.languages.CompletionItemKind;
      const InsertRule = monaco.languages.CompletionItemInsertTextRule;

      return {
        suggestions: [
          {
            label: 'req',
            kind: Kind.Snippet,
            insertText: [
              '<!-- id: REQ-${1:AREA}-${2:001} -->',
              '## ${3:Title MUST be concrete}',
              '',
              '${4:Body — describe the contract, not the implementation.}',
              '',
              '## Acceptance',
              '<!-- id: REQ-${1:AREA}-${2:001}.A1 -->',
              '- ${5:First testable acceptance criterion}',
              '$0',
            ].join('\n'),
            insertTextRules: InsertRule.InsertAsSnippet,
            documentation: 'Insert a full requirement (heading + acceptance) with embedded IDs.',
            detail: 'SpecShip · requirement',
            range,
          },
          {
            label: 'doc',
            kind: Kind.Snippet,
            insertText: [
              '---',
              'id: ${1:AREA}-DOC',
              'title: ${2:Title}',
              'owner: ${3:team-or-person}',
              'priority: ${4|high,medium,low|}',
              '---',
              '',
              '<!-- id: ${1:AREA}-DOC -->',
              '# ${2:Title}',
              '',
              '${5:One-paragraph summary of what this document covers.}',
              '$0',
            ].join('\n'),
            insertTextRules: InsertRule.InsertAsSnippet,
            documentation: 'Insert a new spec document with frontmatter.',
            detail: 'SpecShip · document',
            range,
          },
          {
            label: 'accept',
            kind: Kind.Snippet,
            insertText: [
              '## Acceptance',
              '<!-- id: ${1:REQ-X}.A1 -->',
              '- ${2:First testable acceptance criterion}',
              '<!-- id: ${1:REQ-X}.A2 -->',
              '- ${3:Second testable acceptance criterion}',
              '$0',
            ].join('\n'),
            insertTextRules: InsertRule.InsertAsSnippet,
            documentation: 'Insert an Acceptance section with two ID-d bullets.',
            detail: 'SpecShip · acceptance',
            range,
          },
          {
            label: 'impl',
            kind: Kind.Snippet,
            insertText: [
              'implementations:',
              '  - ${1:src/path/to/file.ts}:${2:QualifiedSymbol}',
              '$0',
            ].join('\n'),
            insertTextRules: InsertRule.InsertAsSnippet,
            documentation: 'Insert an implementations block linking the spec to code.',
            detail: 'SpecShip · implementations',
            range,
          },
        ],
      };
    },
    triggerCharacters: ['r', 'd', 'a', 'i'],
  });
}
