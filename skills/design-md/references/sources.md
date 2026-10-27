# Capturing a design source

Every path ends with the source saved **byte for byte** under `specs/<slug>/`,
so `specship design extract` can read it and `specship design check` can tell
when it changes. Never plain-fetch a design URL.

## Claude Design: a `claude.ai/design` link

The link looks like `https://claude.ai/design/p/<project-id>/?file=<File+Name>.html`.
The file name comes from the `file=` parameter (`Data+Flow.html` is
`Data Flow.html`).

1. `designer_session({ action: "status" })`. If it reports that CDP is not up
   or Chrome is not signed in, tell the user to run `designer setup` once and
   **stop**.
2. If the session isn't on this project yet, `designer_session({ action: "adopt" })`
   on an open tab, or `resume` the stored URL.
3. `designer_snapshot({ filename: "<File Name>.html" })`. It returns
   `htmlPath`, the real rendered HTML read from inside the preview frame.
4. Copy it byte for byte: `cp "<htmlPath>" specs/<slug>/snapshot.html`.
5. Copy every **local** stylesheet the snapshot links
   (`<link rel="stylesheet" href="styles.css">`) next to it, keeping the
   relative path. Remote font links (Google Fonts) stay as links.
6. Write `specs/<slug>/source.md` with the link, the file name and today's
   date.

## Claude Design: a handoff bundle

A bundle is `handoff-<ts>/` holding `project/` and `decision-record.md`. It is
already on disk, so nothing is fetched.

1. Choose the file: `project/<chosen>.html`. If there are several and the user
   hasn't said which, ask.
2. `cp` it to `specs/<slug>/snapshot.html`, along with the CSS, JS and assets it
   references from `project/`.
3. Write `specs/<slug>/source.md` with the bundle path, then append
   `decision-record.md` verbatim. It records why the design looks the way it
   does.

## Figma: a `figma.com` link

The link looks like `https://www.figma.com/design/<fileKey>/<name>?node-id=<a>-<b>`.
The node id is `<a>:<b>`. Use the Figma MCP server's tools. If they aren't in
the session, tell the user to run
`claude mcp add --transport http figma https://mcp.figma.com/mcp`, sign in,
and restart. Then **stop**.

For each frame (screen) in scope:

| Tool | Gives you | Save as |
|---|---|---|
| `get_metadata` | the layer tree with every frame's x, y, width, height | `specs/<slug>/figma/metadata.xml` |
| `get_design_context` | code for the frame, including every color, size and spacing as a literal | `specs/<slug>/figma/<frame>.tsx` |
| `get_variable_defs` | the variables (tokens) the frame uses, as name → value | `specs/<slug>/figma/variables.json` |
| `get_screenshot` | a rendered image of the frame | `specs/<slug>/figma/<frame>.png` |

- Save each response verbatim. When `get_design_context` returns code, write
  the code exactly. Don't convert it to the project's framework yet; that
  is implementation.
- If a frame is too large for one `get_design_context` call, call it on each
  child frame named in `metadata.xml`. Save each one as its own `.tsx`.
- Then extract:
  `specship design extract specs/<slug>/figma/*.tsx specs/<slug>/figma/variables.json --out specs/<slug>/design.md --origin "<link>"`.
- Frame sizes for **Screens & layout** come from `metadata.xml`. Look at the
  `.png` to see order and grouping.

## Exported HTML / CSS

Copy the files into `specs/<slug>/` with their names unchanged, and pass the
HTML entry file to `extract`. Local stylesheets it links are read
automatically.
