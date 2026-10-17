---
title: Languages
description: Every language SpecShip parses, and the extensions it recognizes.
---

Language support is automatic from the file extension — there's nothing to configure.

| Language | Extensions | Status |
|---|---|---|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | Full support |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`, `.xsjs`, `.xsjslib` | Full support |
| Python | `.py`, `.pyw` | Full support |
| Go | `.go` | Full support (module-aware cross-package resolution via `go.mod`) |
| Rust | `.rs` | Full support (cargo workspace members) |
| Java | `.java` | Full support |
| C# | `.cs` | Full support |
| PHP | `.php`, plus Drupal's `.module`, `.install`, `.theme`, `.inc` | Full support |
| Ruby | `.rb`, `.rake` | Full support |
| C | `.c`, `.h` | Full support |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` | Full support |
| Objective-C | `.m`, `.mm` | Full support (including Swift ↔ Objective-C bridging) |
| Swift | `.swift` | Full support |
| Kotlin | `.kt`, `.kts` | Full support |
| Scala | `.scala`, `.sc` | Full support (classes, traits, methods, type aliases, Scala 3 enums) |
| Dart | `.dart` | Full support |
| Svelte | `.svelte` | Full support (script extraction, Svelte 5 runes, SvelteKit routes) |
| Vue | `.vue` | Full support (script + script-setup, Nuxt page/API/middleware routes) |
| Liquid | `.liquid` | Full support |
| Pascal / Delphi | `.pas`, `.dpr`, `.dpk`, `.lpr`, `.dfm`, `.fmx` | Full support (classes, records, interfaces, enums, DFM/FMX forms) |
| Lua | `.lua` | Full support (functions, methods, locals, `require` imports, call edges) |
| Luau | `.luau` | Full support (Lua, plus typed signatures, `type` aliases, Roblox `require`) |

## Config and template files

These are indexed so changes to them are tracked and framework resolvers can use them, but they have no general symbol extraction:

| File type | Extensions | What SpecShip does with it |
|---|---|---|
| XML | `.xml` | MyBatis mapper files become SQL-statement nodes, linked to their Java mapper methods; other XML is tracked only |
| YAML | `.yml`, `.yaml` | Drupal `*.routing.yml` routes and Spring `application.yml` keys; otherwise tracked only |
| Properties | `.properties` | Spring `application.properties` keys, linked from `@Value("${…}")` references |
| Twig | `.twig` | Tracked only |
| Play routes | `conf/routes` (no extension) | Play Framework routes, linked to their controller actions |

## Source of truth

<!-- GENERATED:languages START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
**Tree-sitter languages:** `c-cpp` · `csharp` · `dart` · `go` · `java` · `javascript` · `kotlin` · `lua` · `luau` · `objc` · `pascal` · `php` · `python` · `ruby` · `rust` · `scala` · `swift` · `typescript`

**Standalone extractors:** `dfm` · `liquid` · `mybatis` · `svelte` · `vue`

**Framework resolvers:** `cargo-workspace` · `csharp` · `drupal` · `expo-modules` · `express` · `fabric` · `go` · `java` · `laravel` · `nestjs` · `play` · `python` · `react` · `react-native` · `ruby` · `rust` · `svelte` · `swift` · `swift-objc` · `vue`
<!-- GENERATED:languages END -->
