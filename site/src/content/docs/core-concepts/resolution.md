---
title: Resolution & Frameworks
description: How SpecShip connects references, links routes to handlers, bridges dynamic dispatch, and ties specs to code.
---

Extraction produces nodes and raw edges; **resolution** turns names into real connections.

## Reference resolution

After parsing, SpecShip resolves:

- **Imports** → the source files they point at, including tsconfig path aliases, JS/TS monorepo workspace packages (npm, yarn, bun, pnpm), Go module paths from `go.mod`, and cargo workspace members.
- **Calls** → their definitions, by import resolution and name matching.
- **Inheritance** → `extends` / `implements` between types.

## Framework awareness

SpecShip recognizes web-framework routing files and emits `route` nodes linked by `references` edges to their handler classes or functions. Querying the callers of a view or controller then surfaces the URL pattern that binds it. See [Framework Routes](/guides/framework-routes/) for the full list of recognized frameworks.

Some framework resolvers cross languages:

- **React Native**: the legacy bridge, Fabric/Codegen view components, and Expo Modules, from JS to the native Swift/Objective-C/Kotlin/Java code.
- **Swift ↔ Objective-C** bridging in mixed iOS codebases.
- **MyBatis**: Java mapper methods to their XML SQL statements.
- **Spring**: `@Value("${…}")` references to keys in `application.yml` / `application.properties`.

## Dynamic-dispatch coverage

Static parsing misses computed and indirect calls, so flows can break at dynamic dispatch. SpecShip bridges several of these boundaries with synthesizers so a flow connects end-to-end:

- Callback / observer registration, and callbacks stored in collections
- `EventEmitter` channels, including React Native native-event channels
- React re-render (`setState` → `render`) and JSX child (`render` → child component)
- Flutter `setState` → `build`
- Vue template event handlers → their script functions
- Interface / protocol / trait method → its implementations, and C++ virtual overrides
- Go gRPC client stubs → server implementations, and Gin middleware chains
- Django ORM descriptors

Every synthesized edge is marked `provenance: 'heuristic'` with the site that wired it, and is shown inline wherever a path crosses it. Where a runtime gives no static signal to follow (for example a mediator or reactive proxy), SpecShip leaves the hop out rather than guess.

## Spec links

Requirements in your `specs/` folder are indexed alongside the code and resolved to the symbols they name:

- `implementations:` and `verifies:` blocks in a spec (on a requirement or an individual acceptance criterion)
- `@implements REQ-X` / `@verifies REQ-X` comments on a symbol
- Test titles that mention a requirement ID, such as `it('rejects expired tokens (REQ-AUTH-005.A2)')`, which become test links automatically (test files only)

Link targets are checked against the graph, so `Class.method` and `Class::method` resolve to the same symbol. An orphaned link re-attaches by itself when its symbol comes back. See [Spec links & drift](/specs/links-and-drift/).
