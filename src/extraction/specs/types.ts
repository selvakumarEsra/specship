/**
 * Spec extraction types — shared by all per-format spec extractors
 * (Markdown, YAML, Gherkin, OpenAPI). Each extractor consumes a source file
 * and returns these shapes; the orchestrator persists them via SpecQueries.
 */

import { ExtractionError, Spec, SpecFormat, SpecLinkKind, NodeKind } from '../../types';

/**
 * A pending spec→code link discovered during spec extraction (e.g., from
 * `implementations:` frontmatter). The extractor doesn't know whether the
 * target node currently exists in the graph — that's SpecLinkResolver's job.
 * Provenance is 'spec-declaration' (confidence 0.7).
 */
export interface SpecLinkCandidate {
  specId: string;
  targetFilePath: string;
  targetQualifiedName: string;
  /**
   * Best-effort guess at the target node kind. The resolver matches on
   * (file_path, qualified_name) loosely; this is a hint, not a hard filter.
   */
  targetNodeKind: NodeKind;
  kind: SpecLinkKind;
}

/**
 * Result of extracting from a single spec file.
 */
export interface SpecExtractionResult {
  /** All extracted spec entities (document + children) */
  specs: Spec[];

  /** Pending links declared by the spec author (provenance='spec-declaration') */
  linkCandidates: SpecLinkCandidate[];

  /** Parse errors. Missing-ID-on-heading is the most common — surfaced as 'error' severity. */
  errors: ExtractionError[];

  /** Source format */
  format: SpecFormat;

  /** Extraction wall-clock duration */
  durationMs: number;
}
