/**
 * Minimal ambient typings for the node builtins the control-states test uses
 * to read app.css and sweep the component sources. The ui module deliberately
 * ships without @types/node (REQ-DESKTOP-017 lean footprint), and vitest's
 * CSS interception returns an empty module for `app.css?raw`, so the tests
 * read through node:fs instead — typed here, scoped to what they call.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
