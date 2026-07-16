/**
 * Reflection engine (REFLECT-DOC) — barrel.
 *
 * Mines the ingested `claude_*` transcript tables for recurring, actionable
 * patterns and turns them into durable, human-gated proposals (memory/CLAUDE.md
 * rules, skills/commands, hooks). Surfaced via the SpecShip class methods, the
 * `specship reflect` CLI, and the dashboard's Improvements list.
 */

export * from './types';
export { mineProposals, projectPathForms } from './miner';
export { buildProposal, learningMarkers, memoryNoteMarker } from './targets';
export { previewProposal, applyProposal, undoProposal, lineDiff } from './apply';
export { ReflectStore } from './store';
export { analyze, sweep, capture, captureLesson } from './sweep';
export type { AnalyzeResult, SweepResult } from './sweep';
export { sessionsTouchingFiles, sessionOutcome } from './session-outcomes';
export type { SessionOutcome } from './session-outcomes';
