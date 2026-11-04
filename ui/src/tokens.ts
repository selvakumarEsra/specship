/**
 * Token manifest for the Design system gallery (REQ-DESKTOP-028.A4). Names
 * the CSS custom properties defined in styles/tokens.css — the gallery renders
 * `var(<name>)` so every swatch/state is the LIVE token value, never a
 * hard-coded hex. Pill states come from components/ui.tsx's STATE record
 * (their own single source).
 *
 * Every value traces to the BookMyGame UI design system snapshot
 * (specs/dashboard-theme-bmg/snapshot/_ds_bundle.css) via
 * ADOPTED_BMG_TOKENS — REQ-DASHTHEME-001.
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
  { name: 'border/subtle', varName: '--border-subtle' },
  { name: 'fill/soft', varName: '--fill-soft' },
  { name: 'accent/primary', varName: '--accent' },
];

export const NODE_TOKENS: TokenSwatch[] = [
  { name: 'node/code', varName: '--node-code' },
  { name: 'node/spec', varName: '--node-spec' },
  { name: 'node/test', varName: '--node-test' },
  { name: 'node/route', varName: '--node-route' },
];

/**
 * Semantic state pairs — strong color + its soft surface. Spec states map
 * onto these (REQ-DASHTHEME-001): completed/verified → accent, pending →
 * warning, drifted/broken/orphaned → danger, informational → info.
 */
export const SEMANTIC_TOKENS: Array<{ state: string; varName: string; softVar: string }> = [
  { state: 'accent', varName: '--accent', softVar: '--accent-soft' },
  { state: 'warning', varName: '--warning', softVar: '--warning-soft' },
  { state: 'danger', varName: '--danger', softVar: '--danger-soft' },
  { state: 'info', varName: '--info', softVar: '--info-soft' },
];

/** Spacing scale (tokens.css --space-* → --bmg-space-*). */
export const SPACE_TOKENS: TokenSwatch[] = [
  { name: 'space/xs', varName: '--space-xs' },
  { name: 'space/sm', varName: '--space-sm' },
  { name: 'space/md', varName: '--space-md' },
  { name: 'space/lg', varName: '--space-lg' },
  { name: 'space/xl', varName: '--space-xl' },
  { name: 'space/2xl', varName: '--space-2xl' },
  { name: 'space/gutter', varName: '--space-gutter' },
];

/** Corner radii (tokens.css --r-* → --bmg-radius-*). */
export const RADIUS_TOKENS: TokenSwatch[] = [
  { name: 'radius/sm', varName: '--r-sm' },
  { name: 'radius/md', varName: '--r-md' },
  { name: 'radius/lg', varName: '--r-lg' },
  { name: 'radius/xl', varName: '--r-xl' },
  { name: 'radius/pill', varName: '--r-pill' },
];

/** The documented type scale (tokens.css --fs-* → --bmg-font-size-*) with live samples. */
export const TYPE_SCALE: Array<{ label: string; varName: string; sample: string; mono?: boolean }> = [
  { label: 'Big number', varName: '--fs-big', sample: '$1,184.42' },
  { label: 'Page title', varName: '--fs-title', sample: 'Page title' },
  { label: 'Body & labels', varName: '--fs-base', sample: 'Body & labels — Space Grotesk' },
  { label: 'Secondary', varName: '--fs-sm', sample: 'Secondary text' },
  { label: 'Caption / pills', varName: '--fs-xs', sample: 'CAPTIONS & PILLS' },
  { label: 'Mono', varName: '--fs-sm', sample: 'validateSession()', mono: true },
];

/**
 * Every dashboard token whose value is adopted from the BookMyGame UI
 * snapshot, mapped to its `--bmg-*` source. tokens.css defines each key as
 * `var(<source>)`, and the guard test (REQ-DASHTHEME-001.A1) checks both that
 * wiring and that tokens.css's copy of the source equals the snapshot.
 */
export const ADOPTED_BMG_TOKENS: Record<string, string> = {
  // surfaces & fills
  '--bg-canvas': '--bmg-color-bg',
  '--bg-canvas-2': '--bmg-color-surface-deep',
  '--bg-panel': '--bmg-color-panel',
  '--bg-panel-2': '--bmg-color-surface-raised',
  '--bg-elevated': '--bmg-color-sheet',
  '--bg-popover': '--bmg-color-popover',
  '--bg-hover': '--bmg-color-fill-faint',
  '--bg-active': '--bmg-color-fill-tile',
  '--fill-soft': '--bmg-color-fill-soft',
  '--fill': '--bmg-color-fill',
  '--fill-strong': '--bmg-color-fill-strong',
  '--overlay': '--bmg-color-overlay',
  '--scrim': '--bmg-color-scrim',
  '--inset': '--bmg-color-inset',
  // borders
  '--border-subtle': '--bmg-color-border-quiet',
  '--border-strong': '--bmg-color-border-strong',
  '--border-active': '--bmg-color-border-active',
  '--border-hover': '--bmg-color-border-hover',
  '--border-focus': '--bmg-color-accent',
  // text
  '--text-primary': '--bmg-color-text',
  '--text-strong': '--bmg-color-text-strong',
  '--text-secondary': '--bmg-color-text-dim',
  '--text-muted': '--bmg-color-text-faint',
  '--text-faint': '--bmg-color-text-off',
  '--on-strong': '--bmg-color-wash',
  '--on-accent': '--bmg-color-canvas',
  // accent & status
  '--accent': '--bmg-color-accent',
  '--accent-hover': '--bmg-color-accent-hover',
  '--accent-strong': '--bmg-color-accent-pressed',
  '--success': '--bmg-color-success',
  '--warning': '--bmg-color-warning',
  '--danger': '--bmg-color-danger',
  '--info': '--bmg-color-info',
  // graph nodes
  '--node-code': '--bmg-color-violet',
  '--node-spec': '--bmg-color-info',
  '--node-test': '--bmg-color-success',
  '--node-route': '--bmg-color-hero-end',
  '--node-text': '--bmg-color-wash',
  '--dot-grid': '--bmg-color-wallpaper-ink',
  // spacing
  '--space-xs': '--bmg-space-xs',
  '--space-sm': '--bmg-space-sm',
  '--space-md': '--bmg-space-md',
  '--space-lg': '--bmg-space-lg',
  '--space-xl': '--bmg-space-xl',
  '--space-2xl': '--bmg-space-2xl',
  '--space-gutter': '--bmg-space-gutter',
  // radius
  '--r-sm': '--bmg-radius-xs',
  '--r-md': '--bmg-radius-sm',
  '--r-lg': '--bmg-radius-md',
  '--r-xl': '--bmg-radius-xl',
  '--r-pill': '--bmg-radius-pill',
  // type scale
  '--fs-big': '--bmg-font-size-h0',
  '--fs-title': '--bmg-font-size-h2',
  '--fs-lg': '--bmg-font-size-lg',
  '--fs-base': '--bmg-font-size-label',
  '--fs-sm': '--bmg-font-size-meta-sm',
  '--fs-xs': '--bmg-font-size-tiny',
};

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
