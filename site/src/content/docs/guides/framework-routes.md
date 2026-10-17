---
title: Framework Routes
description: SpecShip links URL patterns to the handlers that serve them.
---

SpecShip detects web-framework routing files and emits `route` nodes linked by `references` edges to their handler classes or functions. Querying the callers of a view or controller then surfaces the URL pattern that binds it.

| Framework | Shapes recognized |
|---|---|
| **Django** | `path()`, `re_path()`, `url()`, `include()` in `urls.py` (CBV `.as_view()`, dotted paths) |
| **Flask** | `@app.route('/path', methods=[…])`, blueprint routes |
| **FastAPI** | `@app.get(…)`, `@router.post(…)`, all standard methods |
| **Express** | `app.get(…)`, `router.post(…)` with middleware chains |
| **NestJS** | `@Controller` + `@Get/@Post/…`, `RouterModule` prefixes, GraphQL resolvers, message/event patterns, WebSocket subscriptions |
| **Laravel** | `Route::get()`, `Route::resource()`, `Controller@action`, tuple syntax |
| **Drupal** | `*.routing.yml` routes; `hook_*` implementations in `.module`/`.theme`/`.install`/`.inc` |
| **Rails** | `get '/x', to: 'users#index'`, hash-rocket syntax, `resources` / `resource` |
| **Spring** | `@GetMapping`, `@PostMapping`, `@RequestMapping` on methods |
| **Play** (Scala / Java) | `conf/routes` and included `*.routes` files (`GET /x controllers.Foo.bar`) |
| **Gin / Echo / Fiber / chi / net/http** | `r.GET(…)`, `group.POST(…)`, `mux.HandleFunc(…)` — including routes on group variables |
| **Axum / Actix / Rocket** | `.route("/x", get(handler))`, route attributes |
| **ASP.NET** | `[HttpGet("/x")]` attributes on action methods (including bare attributes with a class-level `[Route]`), Minimal API `app.MapGet("/x", handler)` |
| **Vapor** | `app.get("x", use: handler)` |
| **React Router** | `<Route path="/x" component={Comp}/>` (v5), `<Route path="/x" element={<Comp/>}/>` (v6), and `createBrowserRouter([{ path, element }])` |
| **Next.js** | `pages/` router files and App Router `page` files, converted to URL paths (`pages/blog/[slug].tsx` → `/blog/:slug`) |
| **Nuxt** | File-based page, server API and middleware routes |
| **SvelteKit** | File-based routes (`src/routes/blog/[slug]/+page.svelte` → `/blog/:slug`) |

Route resolution is automatic — there's nothing to configure. If a framework file is recognized, its routes appear in the graph after the next index or sync. They also show up as entry points in a [flow diagram](/guides/flow-diagrams/).

The [Languages](/reference/languages/) page lists every framework resolver SpecShip ships. To see which ones were detected in a particular project, call `getDetectedFrameworks()` from the [Library API](/reference/api/).
