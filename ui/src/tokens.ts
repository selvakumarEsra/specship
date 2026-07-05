/**
 * Token manifest for the Design system gallery (REQ-DESKTOP-028.A4). Names
 * the CSS custom properties defined in styles/app.css — the gallery renders
 * `var(<name>)` so every swatch/state is the LIVE token value in whichever
 * theme wrapper it sits in, never a hard-coded hex. Pill states come from
 * components/ui.tsx's STATE record (their own single source).
 */

export interface TokenSwatch {
  /** Display name, e.g. "bg/panel". */
  name: string;
  /** The CSS custom property, e.g. "--bg-panel". */
  varName: string;
}

export const SURFACE_TOKENS: TokenSwatch[] = [
  { name: 'bg/canvas', varName: '--bg-canvas' },
  { name: 'bg/panel', varName: '--bg-panel' },
  { name: 'bg/elevated', varName: '--bg-elevated' },
  { name: 'text/primary', varName: '--text-primary' },
  { name: 'text/secondary', varName: '--text-secondary' },
  { name: 'text/muted', varName: '--text-muted' },
  { name: 'accent/primary', varName: '--accent' },
];

export const NODE_TOKENS: TokenSwatch[] = [
  { name: 'node/code', varName: '--node-code' },
  { name: 'node/spec', varName: '--node-spec' },
  { name: 'node/test', varName: '--node-test' },
  { name: 'node/route', varName: '--node-route' },
];

/** Semantic state pairs — strong color + its soft surface. */
export const SEMANTIC_TOKENS: Array<{ state: string; varName: string; softVar: string }> = [
  { state: 'success', varName: '--success', softVar: '--success-soft' },
  { state: 'warn', varName: '--warn', softVar: '--warn-soft' },
  { state: 'error', varName: '--error', softVar: '--error-soft' },
  { state: 'info', varName: '--info', softVar: '--info-soft' },
];

/** The documented type scale (app.css --fs-* tokens) with live samples. */
export const TYPE_SCALE: Array<{ label: string; varName: string; sample: string; mono?: boolean }> = [
  { label: 'Big number', varName: '--fs-big', sample: '$1,184.42' },
  { label: 'Page title', varName: '--fs-title', sample: 'Page title' },
  { label: 'Body & labels', varName: '--fs-base', sample: 'Body & labels — Geist' },
  { label: 'Secondary', varName: '--fs-sm', sample: 'Secondary text' },
  { label: 'Caption / pills', varName: '--fs-xs', sample: 'CAPTIONS & PILLS' },
  { label: 'Mono', varName: '--fs-sm', sample: 'validateSession()', mono: true },
];

/**
 * Button control states per variant. Only states app.css actually documents
 * appear here: hover exists for every variant; pressed (`:active` → the
 * .is-active mirror) only for secondary/ghost; disabled is the shared
 * `.btn:disabled`; loading is the app's disabled-with-spinner treatment.
 */
export type ButtonState = 'default' | 'hover' | 'pressed' | 'disabled' | 'loading';

export const BUTTON_VARIANTS: Array<{ label: string; className: string; states: ButtonState[] }> = [
  { label: 'Primary', className: 'btn-primary', states: ['default', 'hover', 'disabled', 'loading'] },
  { label: 'Secondary', className: 'btn-secondary', states: ['default', 'hover', 'pressed', 'disabled', 'loading'] },
  { label: 'Ghost', className: 'btn-ghost', states: ['default', 'hover', 'pressed', 'disabled'] },
  { label: 'Destructive', className: 'btn-destructive', states: ['default', 'hover', 'disabled'] },
];

/** Gallery-only forced-state classes (app.css mirrors of the pseudo states). */
export const FORCED_STATE_CLASS: Partial<Record<ButtonState, string>> = {
  hover: 'is-hover',
  pressed: 'is-active',
};

/**
 * StatePill groupings for the gallery. Keys index components/ui.tsx STATE;
 * the gallery derives an "other" bucket for any STATE key not listed here,
 * so new states can never silently drop out of the reference.
 */
export const PILL_GROUPS: Array<{ label: string; states: string[] }> = [
  { label: 'Spec link states', states: ['drafted', 'implementing', 'implemented', 'verified', 'drifted', 'broken', 'orphaned'] },
  { label: 'Run states', states: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'skipped'] },
  { label: 'Semantic', states: ['success', 'warn', 'error', 'info'] },
];
