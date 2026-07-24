# Resolution module

<!-- Inherits all rules from the root CLAUDE.md. This file adds
     resolution-specific guidance for src/resolution/. -->

## What this module is

`ReferenceResolver` + import/name-matching + `frameworks/` resolvers and the
dynamic-dispatch synthesizers (`callback-synthesizer.ts`) that bridge
computed/indirect calls so `specship_explore` connects flows end-to-end.

## Non-negotiable invariants

- **Partial dynamic-dispatch coverage is WORSE than none.** Bridging one
  boundary but not the next reveals a hop the agent then drills + reads to
  finish (measured on excalidraw: react-render alone *raised* reads to 5–7;
  completing the flow with the jsx-child hop dropped them to 0–1). Always
  close the flow end-to-end and re-measure — never ship a half-bridged flow.
- Every synthesized edge carries `provenance:'heuristic'` with
  `metadata.synthesizedBy` + `registeredAt` (the wiring site).
- Silent beats wrong: reactive/reconciler runtimes with no static edges
  (MediatR, Vue Proxy, Halo's ReactiveExtensionClient) stay uncovered
  rather than guessed.

## Conventions worth following

- Channels covered today: callback/observer, EventEmitter, React re-render,
  JSX child, django ORM descriptor. Design records:
  `docs/design/callback-edge-synthesis.md` and
  `docs/design/dynamic-dispatch-coverage-playbook.md` (the coverage matrix —
  record new language/framework numbers there).

## How to verify work is done

- Deterministic probes + agent A/B per `scripts/agent-eval/CLAUDE.md`
  (node-count stable before/after re-index; heuristic-edge precision
  spot-check; ≥2 runs/arm).
