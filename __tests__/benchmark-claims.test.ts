import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-ESM script module shared with the A/B harness.
import { renderBenchSection, extractBenchSection, BENCH_START } from '../scripts/agent-eval/bench-manifest.mjs';

/**
 * BENCH-CLAIM-DOC (specs/benchmark-claim-governance.md): numeric performance
 * claims are generated from the measured manifest, never hand-typed — and the
 * headline stays mechanism-led. This suite is the drift gate (REQ-BENCH-003):
 * editing a README benchmark number without regenerating the manifest fails.
 */

const ROOT = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
const manifestPath = path.join(ROOT, 'docs', 'benchmarks', 'results.json');

/** A "% performance claim": digits+% adjacent to a savings word. */
const PERF_CLAIM = /~?\d+\s*%\s*(cheaper|fewer|faster|saved|less|lower)/i;

describe('benchmark claim governance (BENCH-CLAIM-DOC)', () => {
  it('REQ-BENCH-001.A1: the above-the-fold README block carries no % performance claims', () => {
    const fold = readme.slice(0, readme.indexOf('## Get Started'));
    expect(fold).not.toMatch(PERF_CLAIM);
  });

  it('REQ-BENCH-002.A2: every % performance claim lives inside the governed block', () => {
    const governed = extractBenchSection(readme);
    const outside = governed ? readme.replace(governed, '') : readme;
    const hit = outside.match(PERF_CLAIM);
    expect(
      hit,
      hit
        ? `hand-typed performance claim found outside the BENCH_RESULTS block: "${hit[0]}" — regenerate via parse-bench-readme.mjs --write-readme`
        : undefined
    ).toBeNull();
  });

  it('REQ-BENCH-003.A1: the governed README block matches a regeneration from the manifest', () => {
    const governed = extractBenchSection(readme);
    if (!governed) {
      // No published numbers yet — nothing to drift. The block appears the
      // first time the A/B harness runs with --write-readme.
      expect(readme.includes(BENCH_START)).toBe(false);
      return;
    }
    expect(fs.existsSync(manifestPath), 'README has a benchmarks block but docs/benchmarks/results.json is missing').toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(governed).toBe(renderBenchSection(manifest));
  });

  it('REQ-BENCH-002.A1/A3: the renderer stamps date, version, and model deterministically', () => {
    const manifest = {
      generatedAt: '2026-07-11T00:00:00.000Z',
      claudeCodeVersion: '3.1.4',
      models: ['claude-fable-5'],
      repos: [
        {
          repo: 'gin',
          runs: { with: 4, without: 4, racedExcluded: 0 },
          medians: {
            with: { durationSec: 61, tools: 6, tokens: 400_000, costUsd: 0.55 },
            without: { durationSec: 118, tools: 21, tokens: 1_200_000, costUsd: 0.91 },
          },
          savedPct: { time: 48, tools: 71, tokens: 67, cost: 40 },
        },
      ],
      averageSavedPct: { cost: 40, tokens: 67, time: 48, tools: 71 },
    };
    const a = renderBenchSection(manifest);
    expect(a).toContain('measured 2026-07-11');
    expect(a).toContain('Claude Code 3.1.4');
    expect(a).toContain('claude-fable-5');
    expect(a).toContain('| gin |');
    expect(a).toContain('cost 40% · tokens 67% · time 48% · tool calls 71%');
    // Deterministic — same manifest, same bytes (what makes drift detectable).
    expect(renderBenchSection(manifest)).toBe(a);
  });
});
