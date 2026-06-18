/**
 * Single-flight Monaco lazy loader.
 *
 * The whole monaco-editor bundle (~3 MB raw, ~1 MB gz) is pulled in via a
 * dynamic `import()` so it only lands on the wire when the user actually
 * enters edit mode on the Specs page. Other dashboard pages don't pay
 * the cost.
 *
 * Worker strategy: markdown has no dedicated language worker in Monaco,
 * and we don't ship a TypeScript / JSON / CSS schema. So we register a
 * "noop worker" — Monaco still constructs one to keep its message
 * channel happy, but it never gets meaningful traffic. This avoids
 * shipping `editor.worker.js` as a separate asset under `dist/web/` and
 * the corresponding angular.json asset-pipeline plumbing.
 */

let monacoPromise: Promise<typeof import('monaco-editor')> | null = null;

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?(workerId: string, label: string): Worker;
      getWorkerUrl?(workerId: string, label: string): string;
    };
  }
}

/** Body of the noop worker — keeps the message channel open silently. */
const NOOP_WORKER_SOURCE = `self.onmessage = () => {};`;

export function loadMonaco(): Promise<typeof import('monaco-editor')> {
  if (monacoPromise) return monacoPromise;

  if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
    window.MonacoEnvironment = {
      getWorker: (_workerId: string, label: string): Worker => {
        const blob = new Blob([NOOP_WORKER_SOURCE], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        return new Worker(url, { name: label || 'monaco-noop' });
      },
    };
  }

  monacoPromise = import('monaco-editor');
  return monacoPromise;
}
