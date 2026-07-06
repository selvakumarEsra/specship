/* Claude Code analytics: Sessions, Heatmap, Costs, Compare, Tips. */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI, C = window.Charts;
  window.SCREENS = window.SCREENS || {};

  function cacheColor(v) { return v >= 0.7 ? "var(--success)" : v >= 0.5 ? "var(--warn)" : "var(--error)"; }

  // ============== SESSIONS ==============
  // Synthesize per-prompt tool calls + token split (deterministic)
  function promptTools(p, i) {
    const t = p.text.toLowerCase();
    const out = [];
    const push = (name, input, rt) => out.push({ name, input, rt });
    if (/read|auth|map|directory|explain/.test(t)) { push("Read", "src/auth.ts", 22800); if (i % 2) push("Read", "src/db/sqlite.ts", 14200); }
    if (/grep|call site|every/.test(t)) push("Bash", "grep -rn parseTranscript", 82400);
    if (/implement|refactor|edit|add |write|batch/.test(t)) { push("Edit", "src/" + (i % 2 ? "ingest/transcript.ts" : "graph/explore.ts"), 1800); push("Write", "test/new.test.ts", 900); }
    if (/explore|duplicate|callee|graph/.test(t)) push("specship_explore", "validateSession --depth 2", 4100);
    if (/drift|verify|spec/.test(t)) push("specship_search", "'spec links' --state drifted", 1600);
    if (!out.length) push("Read", "src/index.ts", 8400);
    return out;
  }
  function tokenSplit(p) {
    const cacheRead = Math.round(p.tokens * p.cache * 0.74);
    const input = Math.round(p.tokens * (1 - p.cache) * 0.52);
    const cacheCreate = Math.round(p.tokens * 0.12);
    const output = Math.max(400, p.tokens - cacheRead - input - cacheCreate);
    return { input, output, cacheCreate, cacheRead };
  }
  const TOK_SEG = [
    { key: "input", label: "Input", color: "var(--node-spec)" },
    { key: "output", label: "Output", color: "var(--node-code)" },
    { key: "cacheCreate", label: "Cache write", color: "var(--warn)" },
    { key: "cacheRead", label: "Cache read", color: "var(--node-route)" },
  ];

  // Synthesize command / skills / duration / assistant output for a prompt (deterministic)
  function promptMeta(p) {
    const t = p.text.toLowerCase();
    const rnd = seedRand(hashStr(p.id) + 7);
    let command = null; const skills = [];
    if (/implement/.test(t)) { command = "/specship-implement"; skills.push("spec-implement"); }
    else if (/\bverif|drift/.test(t)) { command = "/specship-verify"; skills.push("spec-verify"); }
    else if (/migration|schema|table/.test(t)) { command = "/specship-migrate"; }
    else if (/changelog|commit/.test(t)) { command = "/specship-changelog"; }
    if (/\btest/.test(t)) skills.push("test-writer");
    if (/explore|graph|callee|module|map|boundaries/.test(t)) skills.push("graph-explore");
    if (/drift|verify|spec link/.test(t) && !skills.includes("spec-verify")) skills.push("drift-detect");
    const dur = Math.max(0.6, p.tokens / 9000 + rnd() * 2.4).toFixed(1) + "s";
    let output;
    if (/implement/.test(t)) output = "Planned the change, edited 2 files in an isolated worktree, added a test, and confirmed the suite passes. Opened a diff for review.";
    else if (/\bverif|drift/.test(t)) output = "Re-checked every link for the spec; found 1 drifted on the code axis. Flagged it in the drift queue with a suggested fix.";
    else if (/\btest/.test(t)) output = "Added 4 cases covering the happy path and two edge conditions. Ran vitest \u2014 all green.";
    else if (/grep|call site|every/.test(t)) output = "Located 14 call sites across 6 files and returned the qualified symbols with their file:line, skipping comments and strings.";
    else if (/explain|map|module|boundaries|walk/.test(t)) output = "Summarized the module boundaries and traced the main data flow between the MCP server, graph engine and SQLite store.";
    else if (/read|auth|token|valid/.test(t)) output = "Found the check in checkExpiry and walked through the token lifecycle, noting the 30s clock-skew tolerance.";
    else if (/migration|schema|table/.test(t)) output = "Generated an up/down migration and wired it into the migration runner. Verified it applies cleanly against a fresh DB.";
    else output = "Answered using structural context pulled from the graph rather than re-reading files.";
    return { command, skills, duration: dur, output };
  }
  function MetaChip({ icon, color, children, mono }) {
    return React.createElement("span", { className: "pill", style: { color: color || "var(--text-secondary)", background: color ? `color-mix(in srgb, ${color} 14%, transparent)` : "var(--bg-hover)", fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontWeight: 500 } },
      icon && React.createElement(Icon, { name: icon, size: 10 }), children);
  }
  function IOBlock({ label, tok, body, mono, accent }) {
    return React.createElement("div", { style: { minWidth: 0 } },
      React.createElement("div", { className: "row gap-6", style: { marginBottom: 5 } },
        React.createElement("span", { className: "eyebrow" }, label),
        React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10 } }, tok)),
      React.createElement("div", { style: { fontSize: 12, lineHeight: 1.55, color: accent ? "var(--text-primary)" : "var(--text-secondary)", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "9px 11px", fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", textWrap: "pretty" } }, body));
  }

  // ---- Prompt quality review (deterministic, rule-based) ----
  function gradeOf(score) {
    if (score >= 85) return { label: "Excellent", color: "var(--success)" };
    if (score >= 70) return { label: "Good", color: "var(--node-route)" };
    if (score >= 50) return { label: "Fair", color: "var(--warn)" };
    return { label: "Needs work", color: "var(--error)" };
  }
  function improveText(p, target) {
    const t = p.text, lower = t.toLowerCase();
    if (/grep|call site|every/.test(lower)) { const term = target || "<symbol>"; return "Use `specship_search '" + term + "' --kind call-site` instead of grep \u2014 it returns just the qualified call sites."; }
    if (/read|explain|map|where|how |why |walk|boundaries|module/.test(lower)) return "Use `specship_explore --symbol " + (target || "<symbol>") + " --depth 2` and summarize callers, callees and linked specs \u2014 avoid re-reading the file.";
    if (/implement/.test(lower) && !/REQ-[A-Z]+-\d+/.test(t)) return "Reference the requirement id: `Implement REQ-\u2026: " + t.slice(0, 48) + "\u2026` then plan before editing.";
    if (!target) return t + " \u2014 name the exact symbol, file or REQ id so it can be resolved structurally.";
    return null;
  }
  function promptQuality(p, tools) {
    const t = p.text;
    const sym = (t.match(/[a-z][a-zA-Z]+[A-Z][a-zA-Z]+/) || [])[0];
    const file = (t.match(/[\w/]+\.(ts|tsx|js|md)/) || [])[0];
    const req = (t.match(/REQ-[A-Z]+-\d+/) || [])[0];
    const target = req || sym || file;
    const namesTarget = !!target;
    const vagueOpener = /^(read |grep |look |check |explain |tell me|why |what )/i.test(t.trim());
    const specific = (t.length >= 45 && !vagueOpener) || t.length >= 72;
    const heavyTool = tools.some((tc) => (tc.name === "Bash" || tc.name === "Grep" || tc.name === "Read") && tc.rt > 30000);
    const usedStructural = tools.some((tc) => /specship_/.test(tc.name));
    const cacheOk = p.cache >= 0.5;

    let score = 62;
    const factors = [];
    factors.push({ label: "Names a concrete target", ok: namesTarget }); score += namesTarget ? 12 : -10;
    factors.push({ label: "Scoped & specific", ok: specific }); score += specific ? 10 : -9;
    factors.push({ label: "Cache-friendly", ok: cacheOk }); score += cacheOk ? 8 : -10;
    factors.push({ label: "Structural over brute-force", ok: usedStructural || !heavyTool }); score += (usedStructural || !heavyTool) ? 9 : -13;
    score = Math.max(14, Math.min(98, Math.round(score)));

    const suggestions = [];
    if (!namesTarget) suggestions.push({ sev: "warn", text: "Name the exact symbol, file or REQ id so the agent doesn\u2019t have to search for it first." });
    if (!specific) suggestions.push({ sev: "warn", text: "Lead with the concrete change you want rather than an open-ended question." });
    if (heavyTool && !usedStructural) suggestions.push({ sev: "error", text: "This turn leaned on Read/grep and pulled a lot of tokens. Ask for a structural query instead.", fix: "specship_explore --symbol " + (sym || "<name>") + " --depth 2" });
    if (!cacheOk) suggestions.push({ sev: "warn", text: "Cache hit was low \u2014 keep a stable prompt prefix and avoid reordering context to reuse the 1h cache." });
    if (suggestions.length === 0) suggestions.push({ sev: "info", text: "Well-formed prompt \u2014 specific, scoped and cache-friendly. Nothing to change." });

    const rewrite = score < 72 ? improveText(p, target) : null;
    const g = gradeOf(score);
    return { score, label: g.label, color: g.color, factors, suggestions, rewrite };
  }
  const SEV_COLOR = { error: "var(--error)", warn: "var(--warn)", info: "var(--success)" };

  function QualityReview({ p, tools }) {
    const q = promptQuality(p, tools);
    const review = "Prompt quality: " + q.label + " (" + q.score + "/100)\n" +
      q.suggestions.map((s) => "- " + s.text + (s.fix ? "  [" + s.fix + "]" : "")).join("\n") +
      (q.rewrite ? "\nSuggested rewrite: " + q.rewrite : "");
    return React.createElement("div", { style: { border: `1px solid color-mix(in srgb, ${q.color} 32%, transparent)`, background: `color-mix(in srgb, ${q.color} 6%, var(--bg-canvas))`, borderRadius: 8, padding: 12, marginBottom: 16 } },
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 10 } },
        React.createElement(Icon, { name: "sparkles", size: 14, style: { color: q.color } }),
        React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Prompt quality"),
        React.createElement("div", { className: "grow" }),
        React.createElement("span", { className: "pill", style: { color: q.color, background: `color-mix(in srgb, ${q.color} 15%, transparent)`, fontWeight: 600 } }, q.label, " \u00b7 ", React.createElement("span", { className: "tabular" }, q.score + "/100")),
        React.createElement(UI.CopyBtn, { text: review, label: "Share" })),
      React.createElement("div", { style: { marginBottom: 12 } }, React.createElement(UI.Bar, { frac: q.score / 100, color: q.color, height: 6 })),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 12 } },
        q.factors.map((f) => React.createElement("div", { key: f.label, className: "row gap-6" },
          React.createElement(Icon, { name: f.ok ? "check" : "minus", size: 13, style: { color: f.ok ? "var(--success)" : "var(--warn)", flexShrink: 0 } }),
          React.createElement("span", { style: { fontSize: 11.5, color: f.ok ? "var(--text-secondary)" : "var(--text-primary)" } }, f.label)))),
      React.createElement("div", { className: "eyebrow", style: { marginBottom: 7 } }, "How to improve"),
      React.createElement("div", { className: "col gap-8" },
        q.suggestions.map((s, k) => React.createElement("div", { key: k, className: "row gap-8", style: { alignItems: "flex-start" } },
          React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: SEV_COLOR[s.sev], flexShrink: 0, marginTop: 5 } }),
          React.createElement("div", { className: "grow", style: { minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)", textWrap: "pretty" } }, s.text),
            s.fix && React.createElement("div", { className: "row gap-6", style: { marginTop: 5 } },
              React.createElement("code", { className: "mono", style: { fontSize: 11, color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "2px 7px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.fix),
              React.createElement(UI.CopyBtn, { text: s.fix })))))),
      q.rewrite && React.createElement("div", { style: { marginTop: 12 } },
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Suggested rewrite"),
        React.createElement("div", { className: "row gap-8", style: { alignItems: "flex-start", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "9px 11px" } },
          React.createElement("span", { className: "grow", style: { fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)", textWrap: "pretty" } }, q.rewrite),
          React.createElement(UI.CopyBtn, { text: q.rewrite }))));
  }

  // Long-form synthesized input/output so the dedicated page has real content
  function promptFull(p, meta, tools) {
    const lower = p.text.toLowerCase();
    let input = p.text;
    if (/implement|fix|refactor|add /.test(lower)) input += "\n\nContext:\n- Keep the public API stable.\n- Add or extend tests under `test/`.\n- Follow the conventions in `CLAUDE.md`.";
    else if (/why|explain|walk|map|how |where/.test(lower)) input += "\n\nI want to understand the structure before touching it \u2014 don\u2019t change anything yet.";
    else if (/grep|call site|every/.test(lower)) input += "\n\nReturn just the qualified locations, not the full lines.";
    const toolLines = tools.map((tc) => "- `" + tc.name + "(" + tc.input + ")` \u2014 " + D.fmtK(tc.rt) + " tok");
    let code = "";
    if (/grep|call site|every/.test(lower)) code = "```\nsrc/ingest/transcript.ts:51   parseTranscript()\nsrc/cli/index.ts:88            parseTranscript()\nsrc/mcp/server.ts:140          parseTranscript()\n\u2026 11 more matches\n```";
    else if (/implement|fix|refactor/.test(lower)) code = "```diff\n- return res.status(401).json({ reason: 'expired' })\n+ return res.status(401).json({ code: 'token_expired' })\n```";
    else if (/test/.test(lower)) code = "```\n\u2713 rejects expired token with 401 (12ms)\n\u2713 includes token_expired code (4ms)\n12 passed, 0 failed\n```";
    const output = meta.output + "\n\n**What I did**\n" + toolLines.join("\n") + (code ? "\n\n" + code : "") + "\n\nLet me know if you want me to take the next step or adjust the approach.";
    return { input, output };
  }
  function renderProse(text) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong style='color:var(--text-primary)'>$1</strong>")
      .replace(/`([^`]+)`/g, "<code class='mono' style='font-size:12px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--node-spec)'>$1</code>");
    const out = []; const lines = text.split("\n"); let inCode = false; let code = [];
    lines.forEach((ln) => {
      if (ln.trim().startsWith("```")) {
        if (inCode) { out.push("<pre class='mono' style='margin:8px 0;padding:10px 12px;background:var(--bg-canvas);border:1px solid var(--border-subtle);border-radius:7px;font-size:11.5px;line-height:1.6;overflow-x:auto;white-space:pre'>" + code.map(esc).join("\n") + "</pre>"); code = []; inCode = false; }
        else inCode = true;
        return;
      }
      if (inCode) { code.push(ln); return; }
      if (/^\s*- /.test(ln)) out.push("<div style='display:flex;gap:8px;font-size:13px;line-height:1.6;padding:1.5px 0'><span style='color:var(--text-faint)'>\u2022</span><span>" + inline(ln.replace(/^\s*- /, "")) + "</span></div>");
      else if (ln.trim() === "") out.push("<div style='height:8px'></div>");
      else out.push("<div style='font-size:13px;line-height:1.65;color:var(--text-secondary)'>" + inline(ln) + "</div>");
    });
    return out.join("");
  }

  // Compact row in the session timeline \u2014 opens the full prompt page on click
  function PromptRow({ p, onOpen }) {
    const tools = promptTools(p, 0);
    const meta = promptMeta(p);
    const quality = promptQuality(p, tools);
    const hot = p.cost > 2.5;
    return React.createElement("div", { onClick: () => onOpen(p.id), className: "row gap-10", style: { padding: "11px 12px", borderRadius: 8, background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", cursor: "pointer", transition: "background 100ms, border-color 100ms" },
      onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-panel-2)"; e.currentTarget.style.borderColor = "var(--border-strong)"; },
      onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; } },
      React.createElement("span", { className: "mono muted", style: { fontSize: 10.5, width: 52, flexShrink: 0 } }, p.when),
      React.createElement("span", { title: "Prompt quality: " + quality.label + " (" + quality.score + "/100)", style: { width: 8, height: 8, borderRadius: "50%", background: quality.color, flexShrink: 0, boxShadow: `0 0 6px ${quality.color}66` } }),
      React.createElement("span", { className: "grow", style: { fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        p.sidechain && React.createElement(UI.Pill, { color: "var(--node-code)", bg: "var(--node-code-soft)" }, React.createElement(Icon, { name: "bot", size: 10 }), "subagent"), " ", p.text),
      meta.command && React.createElement(Icon, { name: "command", size: 12, style: { color: "var(--node-code)", flexShrink: 0 }, title: meta.command }),
      React.createElement("span", { className: "row gap-4", style: { flexShrink: 0 } }, React.createElement(Icon, { name: "wrench", size: 11, style: { color: "var(--text-muted)" } }), React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11 } }, tools.length)),
      React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11, width: 50, textAlign: "right", flexShrink: 0 } }, D.fmtK(p.tokens)),
      React.createElement("span", { className: "mono tabular", style: { fontSize: 11, width: 38, textAlign: "right", flexShrink: 0, color: cacheColor(p.cache) } }, Math.round(p.cache * 100) + "%"),
      React.createElement("span", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, width: 54, textAlign: "right", flexShrink: 0, color: hot ? "var(--error)" : "var(--text-primary)" } }, "$" + p.cost.toFixed(2)),
      React.createElement(Icon, { name: "chevronRight", size: 14, style: { color: "var(--text-muted)", flexShrink: 0 } }));
  }

  function BigIO({ label, tok, body, copy, accent }) {
    return React.createElement("div", { className: "card", style: { display: "flex", flexDirection: "column", minWidth: 0 } },
      React.createElement("div", { className: "row gap-8", style: { padding: "10px 13px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 } },
        React.createElement("span", { className: "eyebrow grow", style: { color: accent ? "var(--node-spec)" : "var(--node-code)" } }, label),
        React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5 } }, tok + " tok"),
        React.createElement(UI.CopyBtn, { text: copy })),
      React.createElement("div", { className: "scroll-y", style: { padding: "13px 15px", maxHeight: "46vh" }, dangerouslySetInnerHTML: { __html: renderProse(body) } }));
  }

  // Dedicated full-page prompt detail
  function PromptPage({ session: s, promptId, onBack, onOpen }) {
    const list = sessionPrompts(s);
    const idx = Math.max(0, list.findIndex((x) => x.id === promptId));
    const p = list[idx] || list[0];
    const tools = promptTools(p, idx);
    const split = tokenSplit(p);
    const meta = promptMeta(p);
    const full = promptFull(p, meta, tools);
    const hot = p.cost > 2.5;
    const prev = idx > 0 ? list[idx - 1] : null;
    const next = idx < list.length - 1 ? list[idx + 1] : null;
    return React.createElement("div", { className: "scroll-y", style: { flex: 1 } },
      // sticky header
      React.createElement("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "var(--bg-canvas)", borderBottom: "1px solid var(--border-subtle)", padding: "12px 20px 14px" } },
        React.createElement("div", { className: "row gap-8", style: { marginBottom: 8 } },
          React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => onBack() }, React.createElement(Icon, { name: "chevronLeft", size: 14 }), "Session"),
          React.createElement("span", { className: "mono muted", style: { fontSize: 11.5 } }, s.id),
          React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 prompt ", idx + 1, " of ", list.length),
          React.createElement("div", { className: "grow" }),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: !prev, onClick: () => prev && onOpen(prev.id), title: "Previous prompt" }, React.createElement(Icon, { name: "chevronLeft", size: 13 }), "Prev"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: !next, onClick: () => next && onOpen(next.id), title: "Next prompt" }, "Next", React.createElement(Icon, { name: "chevronRight", size: 13 }))),
        React.createElement("div", { className: "row gap-8", style: { alignItems: "flex-start" } },
          React.createElement("div", { style: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty", lineHeight: 1.35 } }, p.text),
          React.createElement("div", { className: "grow" }),
          React.createElement(UI.CopyBtn, { text: p.text, label: "Copy" }))),
      // body
      React.createElement("div", { style: { padding: 20, maxWidth: 1140 } },
        // meta chips
        React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap", marginBottom: 16 } },
          React.createElement(MetaChip, { icon: "clock", mono: true }, p.when),
          React.createElement(MetaChip, { icon: "zap", mono: true }, meta.duration),
          React.createElement(MetaChip, { icon: "bot" }, p.model),
          React.createElement(MetaChip, { mono: true, color: hot ? "var(--error)" : "var(--accent)" }, "$" + p.cost.toFixed(2)),
          React.createElement(MetaChip, { mono: true }, D.fmtK(p.tokens) + " tok"),
          React.createElement(MetaChip, { mono: true, color: cacheColor(p.cache) }, Math.round(p.cache * 100) + "% cache"),
          p.sidechain && React.createElement(MetaChip, { icon: "bot", color: "var(--node-code)" }, "subagent"),
          meta.command && React.createElement(MetaChip, { icon: "command", color: "var(--node-code)", mono: true }, meta.command),
          meta.skills.map((sk) => React.createElement(MetaChip, { key: sk, icon: "sparkles", color: "var(--node-test)", mono: true }, sk))),
        // Input / Output (large, scroll independently)
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 } },
          React.createElement(BigIO, { label: "Input", tok: D.fmtK(split.input + split.cacheRead), body: full.input, copy: full.input, accent: true }),
          React.createElement(BigIO, { label: "Output", tok: D.fmtK(split.output), body: full.output, copy: full.output })),
        // quality review
        React.createElement(QualityReview, { p, tools }),
        // token + tools, two columns
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
          React.createElement("div", { className: "card card-pad" },
            React.createElement("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Token breakdown"),
            React.createElement("div", { className: "row", style: { height: 8, borderRadius: 999, overflow: "hidden", marginBottom: 12 } },
              TOK_SEG.map((seg) => { const v = split[seg.key]; return v ? React.createElement("div", { key: seg.key, title: `${seg.label}: ${D.fmtK(v)}`, style: { width: (v / p.tokens * 100) + "%", height: "100%", background: seg.color } }) : null; })),
            React.createElement("div", { className: "col gap-7" },
              TOK_SEG.map((seg) => React.createElement("div", { key: seg.key, className: "row gap-8" },
                React.createElement("span", { style: { width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 } }),
                React.createElement("span", { className: "muted grow", style: { fontSize: 12 } }, seg.label),
                React.createElement("span", { className: "mono tabular", style: { fontSize: 12 } }, D.fmtK(split[seg.key])))))),
          React.createElement("div", { className: "card card-pad" },
            React.createElement("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Tools used \u00b7 " + tools.length),
            React.createElement("div", { className: "col gap-7" },
              tools.map((tc, k) => React.createElement("div", { key: k, className: "row gap-8" },
                React.createElement(Icon, { name: "wrench", size: 12, style: { color: "var(--node-code)", flexShrink: 0 } }),
                React.createElement("span", { className: "mono", style: { fontSize: 11.5, flexShrink: 0 } }, tc.name),
                React.createElement("span", { className: "mono muted grow", style: { fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "(" + tc.input + ")"),
                React.createElement("span", { className: "mono tabular", style: { fontSize: 10.5, color: tc.rt > 40000 ? "var(--error)" : tc.rt > 8000 ? "var(--warn)" : "var(--text-muted)" } }, D.fmtK(tc.rt) + " tok")))))),
        React.createElement("div", { style: { height: 24 } })));
  }

  // Deterministic prompt pool for synthesizing a full session timeline
  const PROMPT_POOL = [
    "Walk me through how the MCP server registers its tools",
    "Why is specship_explore returning duplicate callee edges?",
    "Add a spec-anchored layout mode to the graph view",
    "Read auth.ts and tell me where the session token is validated",
    "Run the drift detector against specs/ and summarize",
    "grep for every call site of parseTranscript across the repo",
    "Implement REQ-INGEST-004: incremental jsonl tailing",
    "Write tests for the pricing table override path",
    "Explain how spec links transition from implementing to verified",
    "Map the module boundaries under src/graph/",
    "Refactor link-verify to batch SQLite writes in one transaction",
    "Why did the last reindex skip the workflows directory?",
    "Add a cost rollup to the run detail page",
    "Fix the drifted link on REQ-AUTH-005",
    "Generate a migration for the new sessions table",
    "Profile the layout pass on a 5k-node graph",
    "Summarize what changed in the last 3 commits",
    "Wire the heatmap cells to open a file drill-down",
    "Check whether checkExpiry honors the 30s clock skew",
    "Draft the changelog entry for the memory surface",
  ];
  function seedRand(seed) { let x = seed % 2147483647; if (x <= 0) x += 2147483646; return () => (x = x * 16807 % 2147483647) / 2147483647; }
  function parseStart(s) {
    const m = (s.started || "").match(/(\d{1,2}):(\d{2})/);
    return m ? { h: +m[1], m: +m[2] } : { h: 10, m: 0 };
  }
  // Returns the real prompts for a session, or synthesizes its full list deterministically.
  function sessionPrompts(s) {
    const real = D.prompts.filter((p) => p.session === s.id);
    if (real.length >= s.prompts) return real.slice(0, s.prompts);
    const rnd = seedRand(hashStr(s.id));
    const n = s.prompts;
    // distribute cost across n prompts with random weights
    const weights = Array.from({ length: n }, () => 0.3 + rnd() * rnd() * 2.4);
    const wsum = weights.reduce((a, b) => a + b, 0);
    let t = parseStart(s); const step = Math.max(1, Math.round(72 / n));
    const out = [];
    for (let i = 0; i < n; i++) {
      // reuse real prompts first, synthesize the rest
      if (i < real.length) { out.push(real[i]); continue; }
      const cost = +(s.cost * weights[i] / wsum).toFixed(2);
      const cache = Math.max(0.12, Math.min(0.96, s.cache + (rnd() - 0.5) * 0.3));
      const tokens = Math.round(8000 + cost * (24000 + rnd() * 16000));
      t = { h: (t.h + Math.floor((t.m + step) / 60)) % 24, m: (t.m + step) % 60 };
      out.push({
        id: s.id + "-p" + i, session: s.id,
        text: PROMPT_POOL[Math.floor(rnd() * PROMPT_POOL.length)],
        cost: Math.max(0.04, cost), tokens, cache, model: s.model,
        sidechain: rnd() < 0.16,
        when: String(t.h).padStart(2, "0") + ":" + String(t.m).padStart(2, "0"),
      });
    }
    return out;
  }

  function SessionDetail({ id, onBack, onOpenPrompt }) {
    const s = D.sessions.find((x) => x.id === id) || D.sessions[0];
    const list = sessionPrompts(s);
    // aggregate session tools + token split
    const toolAgg = {}; let totSplit = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
    list.forEach((p, i) => { promptTools(p, i).forEach((tc) => { toolAgg[tc.name] = toolAgg[tc.name] || { name: tc.name, calls: 0, rt: 0 }; toolAgg[tc.name].calls++; toolAgg[tc.name].rt += tc.rt; }); const sp = tokenSplit(p); Object.keys(totSplit).forEach((k) => totSplit[k] += sp[k]); });
    const toolList = Object.values(toolAgg).sort((a, b) => b.rt - a.rt);
    const totTokens = Object.values(totSplit).reduce((a, b) => a + b, 0);
    const maxPromptCost = Math.max(...list.map((p) => p.cost));
    const sideCost = list.filter((p) => p.sidechain).reduce((a, b) => a + b.cost, 0);
    // aggregate commands & skills across the session
    const cmdAgg = {}, skillAgg = {};
    list.forEach((p) => { const m = promptMeta(p); if (m.command) cmdAgg[m.command] = (cmdAgg[m.command] || 0) + 1; m.skills.forEach((sk) => skillAgg[sk] = (skillAgg[sk] || 0) + 1); });
    const commands = Object.entries(cmdAgg).sort((a, b) => b[1] - a[1]);
    const skills = Object.entries(skillAgg).sort((a, b) => b[1] - a[1]);
    // session-level prompt quality
    const qScores = list.map((p, i) => promptQuality(p, promptTools(p, i)).score);
    const avgQuality = Math.round(qScores.reduce((a, b) => a + b, 0) / qScores.length);
    const qGrade = gradeOf(avgQuality);
    const weakCount = qScores.filter((x) => x < 60).length;
    const sessionReview = "Session " + s.id + " \u2014 avg prompt quality " + qGrade.label + " (" + avgQuality + "/100) across " + list.length + " prompts. " + (weakCount ? weakCount + " prompt(s) need work \u2014 expand them for tailored rewrites." : "All prompts are well-formed.");

    return React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } },
      // main column
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18, minWidth: 0 } },
        React.createElement("div", { className: "row gap-10", style: { marginBottom: 14 } },
          React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onBack }, React.createElement(Icon, { name: "chevronLeft", size: 14 }), "Sessions"),
          React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 600 } }, s.id),
          React.createElement(UI.Pill, { color: "var(--node-spec)", bg: "var(--node-spec-soft)" }, s.project), React.createElement(UI.Pill, null, s.model)),
        React.createElement("div", { className: "row", style: { gap: 24, padding: "12px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)", marginBottom: 16 } },
          stat("Cost", "$" + s.cost.toFixed(2)), stat("Prompts", s.prompts), stat("Cache hit", Math.round(s.cache * 100) + "%", cacheColor(s.cache)),
          stat("Subagent $", "$" + sideCost.toFixed(2), "var(--node-code)"), stat("Window", s.started + " \u2013 " + s.ended)),
        React.createElement("div", { className: "row", style: { justifyContent: "space-between", marginBottom: 8 } },
          React.createElement("div", { className: "eyebrow" }, "Prompt timeline \u00b7 " + list.length),
          React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "click a prompt for full detail")),
        React.createElement("div", { className: "col gap-6" },
          list.map((p) => React.createElement(PromptRow, { key: p.id, p, onOpen: onOpenPrompt }))),
        React.createElement("div", { style: { height: 20 } })),

      // summary rail
      React.createElement("div", { className: "scroll-y", style: { width: 290, flexShrink: 0, borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-panel)", padding: 16 } },
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Token mix"),
        React.createElement("div", { className: "row", style: { height: 10, borderRadius: 999, overflow: "hidden", marginBottom: 10 } },
          TOK_SEG.map((seg) => React.createElement("div", { key: seg.key, style: { width: (totSplit[seg.key] / totTokens * 100) + "%", height: "100%", background: seg.color } }))),
        React.createElement("div", { className: "col gap-6", style: { marginBottom: 20 } },
          TOK_SEG.map((seg) => React.createElement("div", { key: seg.key, className: "row gap-8" },
            React.createElement("span", { style: { width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 } }),
            React.createElement("span", { className: "muted grow", style: { fontSize: 11.5 } }, seg.label),
            React.createElement("span", { className: "mono tabular", style: { fontSize: 11.5 } }, D.fmtK(totSplit[seg.key])),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10, width: 32, textAlign: "right" } }, Math.round(totSplit[seg.key] / totTokens * 100) + "%")))),

        React.createElement("div", { style: { background: "var(--success-soft)", border: "1px solid rgba(70,194,107,0.25)", borderRadius: 8, padding: "10px 12px", marginBottom: 20 } },
          React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "database", size: 13, style: { color: "var(--success)" } }), React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "Cache effectiveness")),
          React.createElement("div", { className: "row", style: { alignItems: "baseline", gap: 8, marginTop: 4 } },
            React.createElement("span", { className: "tabular", style: { fontSize: 24, fontWeight: 700, color: "var(--success)" } }, Math.round(s.cache * 100) + "%"),
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "of input served from cache"))),

        React.createElement("div", { style: { background: `color-mix(in srgb, ${qGrade.color} 7%, var(--bg-canvas))`, border: `1px solid color-mix(in srgb, ${qGrade.color} 30%, transparent)`, borderRadius: 8, padding: "10px 12px", marginBottom: 20 } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 8 } },
            React.createElement(Icon, { name: "sparkles", size: 13, style: { color: qGrade.color } }),
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "Avg prompt quality"),
            React.createElement("div", { className: "grow" }),
            React.createElement(UI.CopyBtn, { text: sessionReview, label: "Share" })),
          React.createElement("div", { className: "row", style: { alignItems: "baseline", gap: 8 } },
            React.createElement("span", { className: "tabular", style: { fontSize: 24, fontWeight: 700, color: qGrade.color } }, avgQuality),
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "/100 \u00b7 " + qGrade.label)),
          React.createElement("div", { style: { margin: "8px 0 2px" } }, React.createElement(UI.Bar, { frac: avgQuality / 100, color: qGrade.color, height: 5 })),
          weakCount > 0 && React.createElement("div", { className: "muted", style: { fontSize: 10.5, marginTop: 7 } }, React.createElement("span", { style: { color: "var(--warn)" } }, weakCount + " prompt" + (weakCount > 1 ? "s" : "")), " could be improved \u2014 expand for rewrites")),

        (commands.length > 0 || skills.length > 0) && React.createElement("div", { style: { marginBottom: 20 } },
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Commands & skills"),
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap" } },
            commands.map(([c, n]) => React.createElement("span", { key: c, className: "pill", style: { color: "var(--node-code)", background: "var(--node-code-soft)", fontFamily: "var(--font-mono)", fontWeight: 500 } },
              React.createElement(Icon, { name: "command", size: 10 }), c, n > 1 && React.createElement("span", { style: { opacity: 0.7 } }, "\u00d7" + n))),
            skills.map(([sk, n]) => React.createElement("span", { key: sk, className: "pill", style: { color: "var(--node-test)", background: "var(--node-test-soft)", fontFamily: "var(--font-mono)", fontWeight: 500 } },
              React.createElement(Icon, { name: "sparkles", size: 10 }), sk, n > 1 && React.createElement("span", { style: { opacity: 0.7 } }, "\u00d7" + n))),
            commands.length === 0 && skills.length === 0 && React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "None used"))),

        React.createElement("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Tools used \u00b7 " + toolList.length),
        React.createElement(C.HBars, { items: toolList, valueKey: "rt", labelKey: "name", fmt: (v) => D.fmtK(v), color: (it) => it.rt > 60000 ? "var(--error)" : it.rt > 20000 ? "var(--warn)" : "var(--node-code)" }),
        React.createElement("div", { className: "muted", style: { fontSize: 10, marginTop: 8 } }, "bar = result tokens returned"),

        React.createElement("div", { className: "eyebrow", style: { margin: "20px 0 10px" } }, "Cost per prompt"),
        React.createElement("div", { className: "col gap-5" },
          list.map((p) => React.createElement("div", { key: p.id, className: "row gap-8" },
            React.createElement("span", { className: "mono muted", style: { fontSize: 10, width: 44, flexShrink: 0 } }, p.when),
            React.createElement("div", { className: "grow" }, React.createElement(UI.Bar, { frac: p.cost / maxPromptCost, color: p.cost > 2.5 ? "var(--error)" : "var(--accent)" })),
            React.createElement("span", { className: "mono tabular", style: { fontSize: 10.5, width: 40, textAlign: "right" } }, "$" + p.cost.toFixed(2)))))));
  }
  function stat(label, value, color) {
    return React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, label), React.createElement("div", { className: "mono tabular", style: { fontSize: 16, fontWeight: 600, marginTop: 2, color: color || "var(--text-primary)" } }, value));
  }

  function Sessions({ query }) {
    const [sel, setSel] = useState(query && query.sel);
    const [sort, setSort] = useState("cost");
    const [promptSel, setPromptSel] = useState(null);
    if (sel && promptSel) {
      const sObj = D.sessions.find((x) => x.id === sel) || D.sessions[0];
      return React.createElement(PromptPage, { session: sObj, promptId: promptSel, onBack: () => setPromptSel(null), onOpen: (pid) => setPromptSel(pid) });
    }
    if (sel) return React.createElement(SessionDetail, { id: sel, onBack: () => setSel(null), onOpenPrompt: (pid) => setPromptSel(pid) });
    const sorted = [...D.sessions].sort((a, b) => sort === "cost" ? b.cost - a.cost : b.prompts - a.prompts);
    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { style: { padding: "16px 18px 12px" } }, React.createElement(UI.PageHead, { icon: "sessions", title: "Sessions", sub: D.sessions.length + " sessions \u00b7 across all projects" })),
      React.createElement("div", { className: "row gap-8", style: { padding: "0 18px 12px" } },
        React.createElement(Icon, { name: "filter", size: 13, style: { color: "var(--text-muted)" } }),
        React.createElement("select", { className: "input", style: { fontSize: 12, padding: "4px 8px" } }, React.createElement("option", null, "All projects")),
        React.createElement("select", { className: "input", style: { fontSize: 12, padding: "4px 8px" } }, React.createElement("option", null, "All models")),
        React.createElement("div", { className: "grow" }),
        React.createElement("span", { className: "muted", style: { fontSize: 11.5 } }, "sort"),
        React.createElement(UI.Segmented, { size: "sm", value: sort, onChange: setSort, options: [{ value: "cost", label: "Cost" }, { value: "prompts", label: "Prompts" }] })),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: "0 18px 18px" } },
        React.createElement("div", { className: "card", style: { overflow: "hidden" } },
          React.createElement("div", { className: "row", style: { padding: "8px 14px", fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, borderBottom: "1px solid var(--border-subtle)" } },
            React.createElement("span", { style: { width: 90 } }, "Session"), React.createElement("span", { style: { width: 110 } }, "Project"), React.createElement("span", { className: "grow" }, "Window"),
            React.createElement("span", { style: { width: 70, textAlign: "right" } }, "Prompts"), React.createElement("span", { style: { width: 70, textAlign: "right" } }, "Cache"), React.createElement("span", { style: { width: 70, textAlign: "right" } }, "Cost")),
          sorted.map((s) => React.createElement("div", { key: s.id, onClick: () => setSel(s.id), className: "row", style: { padding: "11px 14px", borderTop: "1px solid var(--border-subtle)", cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { className: "mono", style: { width: 90, fontSize: 12 } }, s.id),
            React.createElement("span", { style: { width: 110 } }, React.createElement(UI.Pill, null, s.project)),
            React.createElement("span", { className: "mono muted grow", style: { fontSize: 11.5 } }, s.started + " \u2013 " + s.ended + "  \u00b7  " + s.model),
            React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12 } }, s.prompts),
            React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12, color: cacheColor(s.cache) } }, Math.round(s.cache * 100) + "%"),
            React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12.5, fontWeight: 600 } }, "$" + s.cost.toFixed(2)))))));
  }
  window.SCREENS.sessions = Sessions;

  // ============== HEATMAP ==============
  // ---- squarified treemap layout (Bruls et al.) ----
  function squarify(data, X, Y, W, H) {
    const total = data.reduce((a, b) => a + b.value, 0) || 1;
    const items = data.map((d) => ({ d, area: d.value / total * (W * H) }));
    const res = []; let rect = { x: X, y: Y, w: W, h: H }; let row = [];
    const sum = (arr) => arr.reduce((a, b) => a + b.area, 0);
    const worst = (arr, len) => { if (!arr.length) return Infinity; const s = sum(arr); const mx = Math.max(...arr.map((a) => a.area)); const mn = Math.min(...arr.map((a) => a.area)); return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn)); };
    const flush = () => {
      const len = Math.min(rect.w, rect.h); const s = sum(row); const thick = s / (len || 1); let off = 0;
      const horizontal = rect.w >= rect.h;
      row.forEach((it) => { const cl = it.area / (thick || 1); if (horizontal) res.push({ ...it.d, x: rect.x, y: rect.y + off, w: thick, h: cl }); else res.push({ ...it.d, x: rect.x + off, y: rect.y, w: cl, h: thick }); off += cl; });
      if (horizontal) rect = { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h }; else rect = { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
      row = [];
    };
    items.forEach((it) => { const len = Math.min(rect.w, rect.h); if (row.length && worst([...row, it], len) > worst(row, len)) flush(); row.push(it); });
    if (row.length) flush();
    return res;
  }
  function useMeasure() {
    const ref = React.useRef(null); const [w, setW] = React.useState(0);
    React.useEffect(() => { if (!ref.current || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver((es) => setW(es[0].contentRect.width)); ro.observe(ref.current); return () => ro.disconnect(); }, []);
    return [ref, w];
  }
  function fileStats(f) { const ft = fileTools(f); const tokens = ft.reduce((a, b) => a + b.rt, 0); return { path: f.path, calls: f.calls, tokens, tpc: tokens / Math.max(1, f.calls) }; }
  window.cgFileStats = fileStats;

  function FileTreemap({ files, metric, selKey, onPick }) {
    const [ref, w] = useMeasure();
    const H = 268; const W = w || 760;
    const data = files.map(fileStats);
    const maxTpc = Math.max(...data.map((d) => d.tpc));
    const valueOf = (d) => metric === "tokens" ? d.tokens : d.calls;
    const sorted = [...data].sort((a, b) => valueOf(b) - valueOf(a)).map((d) => ({ ...d, value: valueOf(d) }));
    const cells = squarify(sorted, 0, 0, W, H);
    return React.createElement("div", { ref, style: { position: "relative", width: "100%", height: H, borderRadius: 8, overflow: "hidden", background: "var(--bg-canvas)" } },
      cells.map((c) => {
        const t = c.tpc / maxTpc; // waste intensity
        const on = selKey === c.path;
        const warm = t > 0.66 ? "var(--error)" : t > 0.33 ? "var(--warn)" : "var(--node-route)";
        const bg = `color-mix(in srgb, ${warm} ${Math.round(20 + t * 60)}%, var(--bg-elevated))`;
        const big = c.w > 58 && c.h > 30; const mid = c.w > 40 && c.h > 18;
        return React.createElement("div", { key: c.path, onClick: () => onPick(c.path), title: `${c.path}\n${c.calls} calls \u00b7 ${fmtTok(c.tokens)} result tokens \u00b7 ${D.fmtK(Math.round(c.tpc))}/call`,
          style: { position: "absolute", left: c.x + 1.5, top: c.y + 1.5, width: Math.max(0, c.w - 3), height: Math.max(0, c.h - 3), background: bg, borderRadius: 5, cursor: "pointer", overflow: "hidden", padding: big ? "7px 9px" : "0 6px", display: "flex", flexDirection: "column", justifyContent: big ? "flex-start" : "center", border: on ? "1.5px solid var(--accent)" : "1px solid rgba(0,0,0,0.28)", boxShadow: on ? "0 0 0 3px var(--accent-soft)" : "none", transition: "box-shadow 100ms" } },
          mid && React.createElement("span", { className: "mono", style: { fontSize: big ? 11 : 9.5, fontWeight: 500, color: t > 0.45 ? "#fff" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 } }, c.path.replace("src/", "")),
          big && React.createElement("span", { className: "mono tabular", style: { fontSize: 10, color: t > 0.45 ? "rgba(255,255,255,0.82)" : "var(--text-muted)", marginTop: 2 } }, (metric === "tokens" ? fmtTok(c.tokens) : c.calls + " calls")));
      }));
  }

  function ToolEffRow({ tool, maxTok, selected, onClick }) {
    const tpc = tool.tokens / Math.max(1, tool.calls);
    const eff = tpc > 20000 ? "var(--error)" : tpc > 8000 ? "var(--warn)" : "var(--success)";
    return React.createElement("div", { onClick, className: "row gap-8", style: { padding: "6px 8px", margin: "0 -8px", borderRadius: 6, cursor: "pointer", background: selected ? "var(--accent-soft)" : "transparent" },
      onMouseEnter: (e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }, onMouseLeave: (e) => { if (!selected) e.currentTarget.style.background = "transparent"; } },
      React.createElement("span", { className: "mono", style: { width: 116, flexShrink: 0, fontSize: 11.5, color: selected ? "var(--accent)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tool.name),
      React.createElement("div", { className: "grow", style: { height: 16, background: "var(--bg-hover)", borderRadius: 4, overflow: "hidden" } },
        React.createElement("div", { style: { width: (tool.tokens / maxTok * 100) + "%", height: "100%", background: eff, borderRadius: 4 } })),
      React.createElement("span", { className: "mono tabular muted", style: { width: 36, textAlign: "right", fontSize: 10.5, flexShrink: 0 } }, "\u00d7" + tool.calls),
      React.createElement("span", { className: "mono tabular", style: { width: 64, textAlign: "right", fontSize: 10.5, color: eff, flexShrink: 0 } }, D.fmtK(Math.round(tpc)) + "/call"),
      React.createElement("span", { className: "mono tabular", style: { width: 48, textAlign: "right", fontSize: 11.5, fontWeight: 600, flexShrink: 0 } }, fmtTok(tool.tokens)),
      React.createElement(Icon, { name: "chevronRight", size: 12, style: { color: "var(--text-faint)", flexShrink: 0 } }));
  }

  function fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : D.fmtK(n); }
  function hsum(label, value, icon, color, sub) {
    return React.createElement("div", { className: "card", style: { padding: "10px 13px", display: "flex", flexDirection: "column", gap: 3 } },
      React.createElement("div", { className: "row gap-6", style: { color: "var(--text-muted)", whiteSpace: "nowrap" } }, React.createElement(Icon, { name: icon, size: 12, style: { color, flexShrink: 0 } }), React.createElement("span", { className: "eyebrow", style: { letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis" } }, label)),
      React.createElement("div", { className: "mono tabular", style: { fontSize: 18, fontWeight: 650, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, value),
      sub && React.createElement("div", { className: "mono muted", style: { fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, sub));
  }

  function Heatmap() {
    const [range, setRange] = useState("week");
    const [metric, setMetric] = useState("calls");
    const [sel, setSel] = useState(null); // { type, key }
    const pick = (type, key) => setSel((s) => (s && s.type === type && s.key === key) ? null : { type, key });
    const isSel = (type, key) => sel && sel.type === type && sel.key === key;
    const file = sel && sel.type === "file" ? D.files.find((f) => f.path === sel.key) : null;
    const tool = sel && sel.type === "tool" ? D.tools.find((t) => t.name === sel.key) : null;
    const sub = sel && sel.type === "subagent" ? D.subagents.find((t) => t.name === sel.key) : null;
    // summary
    const totalCalls = D.tools.reduce((a, b) => a + b.calls, 0);
    const totalTok = D.tools.reduce((a, b) => a + b.tokens, 0);
    const busiest = [...D.files].sort((a, b) => b.calls - a.calls)[0];
    const heaviest = [...D.tools].sort((a, b) => b.tokens - a.tokens)[0];
    const toolsByTok = [...D.tools].sort((a, b) => b.tokens - a.tokens);
    const maxTok = Math.max(...D.tools.map((t) => t.tokens));
    return React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } },
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18, minWidth: 0 } },
        React.createElement(UI.PageHead, { icon: "heatmap", title: "Heatmap", sub: "Where tool calls land \u2014 files, tools, subagents", actions: React.createElement(UI.RangeSelector, { value: range, onChange: setRange }) }),
        // summary row
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 } },
          hsum("Tool calls", totalCalls.toLocaleString(), "wrench", "var(--node-spec)", "this " + range),
          hsum("Result tokens", fmtTok(totalTok), "database", "var(--node-route)", "returned to context"),
          hsum("Busiest file", busiest.path.replace("src/", ""), "box", "var(--warn)", busiest.calls + " calls"),
          hsum("Heaviest tool", heaviest.name, "flame", "var(--error)", fmtTok(heaviest.tokens) + " tokens")),
        // files treemap
        React.createElement("div", { className: "card card-pad", style: { marginBottom: 14 } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 12 } },
            React.createElement(Icon, { name: "box", size: 14, style: { color: "var(--warn)" } }),
            React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Files"),
            React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 area = " + (metric === "tokens" ? "result tokens" : "tool calls") + ", color = tokens / call"),
            React.createElement("div", { className: "grow" }),
            React.createElement(UI.Segmented, { size: "sm", value: metric, onChange: setMetric, options: [{ value: "calls", label: "Calls" }, { value: "tokens", label: "Tokens" }] })),
          React.createElement(FileTreemap, { files: D.files, metric, selKey: file ? file.path : null, onPick: (p) => pick("file", p) }),
          React.createElement("div", { className: "row gap-12", style: { marginTop: 10, alignItems: "center" } },
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "tokens / call"),
            React.createElement("div", { className: "row", style: { width: 120, height: 7, borderRadius: 999, overflow: "hidden", background: "linear-gradient(90deg, var(--node-route), var(--warn), var(--error))" } }),
            React.createElement("span", { className: "muted", style: { fontSize: 10 } }, "efficient \u2192 wasteful"),
            React.createElement("div", { className: "grow" }),
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "click a tile to drill in"))),
        // tools + subagents
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
          React.createElement("div", { className: "card card-pad" },
            React.createElement("div", { className: "row gap-8", style: { marginBottom: 4 } }, React.createElement(Icon, { name: "wrench", size: 14, style: { color: "var(--node-code)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Tools"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 by result tokens, ranked")),
            React.createElement("div", { className: "row", style: { padding: "8px 0 4px", fontSize: 9.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 } },
              React.createElement("span", { style: { width: 116 } }, "Tool"), React.createElement("span", { className: "grow" }, "Result tokens"), React.createElement("span", { style: { width: 36, textAlign: "right" } }, "Calls"), React.createElement("span", { style: { width: 64, textAlign: "right" } }, "Per call"), React.createElement("span", { style: { width: 48, textAlign: "right" } }, "Total"), React.createElement("span", { style: { width: 14 } })),
            React.createElement("div", { className: "col gap-2" }, toolsByTok.map((t) => React.createElement(ToolEffRow, { key: t.name, tool: t, maxTok, selected: isSel("tool", t.name), onClick: () => pick("tool", t.name) }))),
            React.createElement("div", { className: "muted", style: { fontSize: 10.5, marginTop: 10, display: "flex", gap: 12 } }, lg("var(--error)", ">20k / call"), lg("var(--warn)", ">8k"), lg("var(--success)", "lean"))),
          React.createElement("div", { className: "card card-pad" },
            React.createElement("div", { className: "row gap-8", style: { marginBottom: 14 } }, React.createElement(Icon, { name: "bot", size: 14, style: { color: "var(--node-route)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Subagents"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 by isSidechain attribution")),
            React.createElement(C.HBars, { items: D.subagents, valueKey: "tokens", fmt: (v) => fmtTok(v), onItemClick: (it) => pick("subagent", it.name), selectedKey: sub ? sub.name : null, color: "var(--node-route)" })))),
      // drill-down rail
      file && React.createElement("div", { style: railStyle }, React.createElement(FileDetail, { file, onClose: () => setSel(null) })),
      tool && React.createElement("div", { style: railStyle }, React.createElement(ToolDetail, { tool, onClose: () => setSel(null) })),
      sub && React.createElement("div", { style: railStyle }, React.createElement(SubagentDetail, { sub, onClose: () => setSel(null) })));
  }

  // ---- deterministic per-file synth ----
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function fileTools(f) {
    const isTest = /test/.test(f.path), isMd = /\.md$/.test(f.path);
    let mix;
    if (isMd) mix = [["Read", 0.7, 12], ["Write", 0.3, 1]];
    else if (isTest) mix = [["Read", 0.4, 14], ["Bash", 0.4, 60], ["Edit", 0.2, 2]];
    else mix = [["Read", 0.46, 18], ["Edit", 0.24, 2], ["Grep", 0.16, 40], ["specship_explore", 0.14, 4]];
    let rem = f.calls;
    return mix.map(([name, frac, kPerCall], i) => {
      const calls = i === mix.length - 1 ? rem : Math.max(1, Math.round(f.calls * frac));
      rem -= calls;
      return { name, calls, rt: calls * kPerCall * 1000 };
    }).filter((x) => x.calls > 0);
  }
  function fileSessions(f) {
    const h = hashStr(f.path);
    const n = 1 + (h % 3);
    return D.sessions.slice(0, 6).filter((_, i) => ((h >> i) & 1) || i < n).slice(0, n + 1);
  }
  function fileGraphNode(f) {
    const base = f.path.replace(/\.[^.]+$/, "");
    return D.graphNodes.find((n) => n.file && n.file.split(":")[0].replace(/\.[^.]+$/, "") === base);
  }
  function fileTrend(f) {
    const h = hashStr(f.path); const out = []; let rem = f.calls;
    for (let i = 0; i < 7; i++) { const v = Math.max(0, Math.round((f.calls / 7) + ((h >> i) % 5) - 2)); out.push(Math.min(rem, v)); rem -= v; }
    out[6] += Math.max(0, rem); return out;
  }

  function FileDetail({ file, onClose }) {
    const tools = fileTools(file);
    const sessions = fileSessions(file);
    const node = fileGraphNode(file);
    const trend = fileTrend(file);
    const totalRt = tools.reduce((a, b) => a + b.rt, 0);
    const heavy = tools.find((t) => t.rt > 40000);
    return React.createElement("div", { className: "col", style: { width: 360, height: "100%" } },
      React.createElement("div", { className: "row gap-8", style: { padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement(Icon, { name: "box", size: 14, style: { color: "var(--warn)", flexShrink: 0 } }),
        React.createElement("span", { className: "mono grow", style: { fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, file.path),
        React.createElement(UI.CopyBtn, { text: file.path }),
        React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onClose }, React.createElement(Icon, { name: "x", size: 14 }))),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 14 } },
        React.createElement("div", { className: "row", style: { gap: 20, marginBottom: 16 } },
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Tool calls"), React.createElement("div", { className: "tabular", style: { fontSize: 26, fontWeight: 700, lineHeight: 1 } }, file.calls)),
          React.createElement("div", { className: "grow" }, React.createElement("div", { className: "muted", style: { fontSize: 10.5, marginBottom: 4 } }, "7-day trend"), React.createElement(C.Sparkline, { data: trend, color: "var(--warn)", fill: true, w: 150, h: 30 }))),

        heavy && React.createElement("div", { style: { background: "var(--warn-soft)", border: "1px solid rgba(229,165,10,0.25)", borderRadius: 8, padding: "9px 11px", marginBottom: 16, display: "flex", gap: 9 } },
          React.createElement(Icon, { name: "flame", size: 14, style: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } }),
          React.createElement("div", { style: { fontSize: 11.5, lineHeight: 1.5 } }, React.createElement("span", { className: "mono", style: { color: "var(--warn)" } }, heavy.name), " returned ", React.createElement("span", { className: "mono" }, D.fmtK(heavy.rt)), " tokens here. A structural query would cover it in a fraction.")),

        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Tool breakdown"),
        React.createElement("div", { className: "col gap-8", style: { marginBottom: 18 } },
          tools.map((tc) => React.createElement("div", { key: tc.name, className: "row gap-10" },
            React.createElement("span", { className: "mono", style: { fontSize: 11.5, width: 92, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tc.name),
            React.createElement("div", { className: "grow" }, React.createElement(UI.Bar, { frac: tc.rt / totalRt, color: tc.rt > 40000 ? "var(--error)" : tc.rt > 12000 ? "var(--warn)" : "var(--node-code)" })),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5, width: 22, textAlign: "right" } }, "\u00d7" + tc.calls),
            React.createElement("span", { className: "mono tabular", style: { fontSize: 10.5, width: 44, textAlign: "right" } }, D.fmtK(tc.rt)))),
          React.createElement("div", { className: "muted", style: { fontSize: 10 } }, "bar = result tokens \u00b7 \u00d7 = call count")),

        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Touched in " + sessions.length + " session" + (sessions.length > 1 ? "s" : "")),
        React.createElement("div", { className: "col gap-6", style: { marginBottom: 18 } },
          sessions.map((s) => React.createElement("div", { key: s.id, onClick: () => window.go("sessions", { query: { sel: s.id } }), className: "row gap-8", style: { padding: "7px 9px", borderRadius: 7, border: "1px solid var(--border-subtle)", cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { className: "mono", style: { fontSize: 11.5, flexShrink: 0 } }, s.id),
            React.createElement("span", { className: "muted grow", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.project + " \u00b7 " + s.started),
            React.createElement(Icon, { name: "chevronRight", size: 12, style: { color: "var(--text-muted)", flexShrink: 0 } })))),

        node && React.createElement("button", { className: "btn btn-secondary btn-sm", style: { width: "100%", justifyContent: "center", marginBottom: 8 }, onClick: () => window.go("graph", { query: { focus: node.id } }) }, React.createElement(Icon, { name: "graph", size: 13 }), "Show " + node.label + " in graph"),
        React.createElement("button", { className: "btn btn-secondary btn-sm", style: { width: "100%", justifyContent: "center" } }, React.createElement(Icon, { name: "reveal", size: 13 }), "Reveal in editor")));
  }
  function lg(c, t) { return React.createElement("span", { className: "row gap-4" }, React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: c } }), t); }

  const railStyle = { width: 360, flexShrink: 0, borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-panel)", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" };
  function DrillHeader({ icon, color, title, copy, onClose }) {
    return React.createElement("div", { className: "row gap-8", style: { padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 } },
      React.createElement(Icon, { name: icon, size: 14, style: { color, flexShrink: 0 } }),
      React.createElement("span", { className: "mono grow", style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title),
      copy && React.createElement(UI.CopyBtn, { text: copy }),
      React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onClose }, React.createElement(Icon, { name: "x", size: 14 })));
  }
  // top files touched by a given tool (reverse of fileTools)
  function toolFiles(toolName) {
    const out = [];
    D.files.forEach((f) => { fileTools(f).forEach((tc) => { if (tc.name === toolName) out.push({ path: f.path, calls: tc.calls, rt: tc.rt }); }); });
    return out.sort((a, b) => b.rt - a.rt).slice(0, 6);
  }
  function entitySessions(key, n) {
    const h = hashStr(key); const k = n || (1 + (h % 3));
    return D.sessions.filter((_, i) => i < k + 1);
  }
  const TOOL_TIP = {
    Bash: { sev: "error", text: "Bash(grep) dumps whole matching lines into context. specship_search returns just the qualified call sites \u2014 same answer, ~99% fewer tokens." },
    Grep: { sev: "error", text: "Raw grep is your heaviest token sink per call. specship_search is indexed and covers most of these queries." },
    Read: { sev: "warn", text: "Re-reading files rebuilds the same mental map each turn. specship_explore returns callers, callees and linked specs in one call." },
    Task: { sev: "warn", text: "Subagents re-read their plan artifact on each call. Pass --plan-ref instead of inlining it to roughly halve subagent input." },
  };
  function ToolDetail({ tool, onClose }) {
    const topFiles = toolFiles(tool.name);
    const sessions = entitySessions(tool.name);
    const trend = fileTrend({ path: tool.name, calls: tool.calls });
    const maxRt = Math.max(1, ...topFiles.map((f) => f.rt));
    const tip = TOOL_TIP[tool.name];
    const avg = Math.round(tool.tokens / tool.calls);
    return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
      React.createElement(DrillHeader, { icon: "wrench", color: "var(--node-code)", title: tool.name, copy: tool.name, onClose }),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 14 } },
        React.createElement("div", { className: "row", style: { gap: 16, marginBottom: 16 } },
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Calls"), React.createElement("div", { className: "tabular", style: { fontSize: 24, fontWeight: 700, lineHeight: 1 } }, tool.calls)),
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Result tokens"), React.createElement("div", { className: "tabular", style: { fontSize: 24, fontWeight: 700, lineHeight: 1, color: tool.tokens > 1e6 ? "var(--error)" : "var(--text-primary)" } }, D.fmtK(tool.tokens))),
          React.createElement("div", { className: "grow" }, React.createElement("div", { className: "muted", style: { fontSize: 10.5, marginBottom: 4 } }, "7-day"), React.createElement(C.Sparkline, { data: trend, color: "var(--node-code)", fill: true, w: 110, h: 28 }))),
        React.createElement("div", { className: "row gap-8", style: { marginBottom: 16 } },
          React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "avg per call"),
          React.createElement("span", { className: "mono tabular", style: { fontSize: 12, color: avg > 30000 ? "var(--error)" : avg > 8000 ? "var(--warn)" : "var(--text-secondary)" } }, D.fmtK(avg) + " tokens")),
        tip && React.createElement("div", { style: { background: tip.sev === "error" ? "var(--error-soft)" : "var(--warn-soft)", border: "1px solid " + (tip.sev === "error" ? "rgba(242,85,90,0.25)" : "rgba(229,165,10,0.25)"), borderRadius: 8, padding: "9px 11px", marginBottom: 16, display: "flex", gap: 9 } },
          React.createElement(Icon, { name: "tips", size: 14, style: { color: tip.sev === "error" ? "var(--error)" : "var(--warn)", flexShrink: 0, marginTop: 1 } }),
          React.createElement("div", { style: { fontSize: 11.5, lineHeight: 1.5 }, dangerouslySetInnerHTML: { __html: tip.text.replace(/(specship_\w+|--plan-ref|Bash\(grep\))/g, "<code class='mono' style='font-size:11px;color:inherit'>$1</code>") } })),
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Top files hit"),
        React.createElement("div", { className: "col gap-7", style: { marginBottom: 18 } },
          topFiles.map((f) => React.createElement("div", { key: f.path, onClick: () => window.go("graph"), className: "row gap-8" },
            React.createElement("span", { className: "mono", style: { fontSize: 11, width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" } }, f.path.replace("src/", "")),
            React.createElement("div", { className: "grow" }, React.createElement(UI.Bar, { frac: f.rt / maxRt, color: f.rt > 40000 ? "var(--error)" : "var(--node-code)" })),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10, width: 20, textAlign: "right" } }, "\u00d7" + f.calls),
            React.createElement("span", { className: "mono tabular", style: { fontSize: 10, width: 40, textAlign: "right" } }, D.fmtK(f.rt))))),
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Used in " + sessions.length + " sessions"),
        React.createElement("div", { className: "col gap-6" },
          sessions.map((s) => React.createElement("div", { key: s.id, onClick: () => window.go("sessions", { query: { sel: s.id } }), className: "row gap-8", style: { padding: "7px 9px", borderRadius: 7, border: "1px solid var(--border-subtle)", cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { className: "mono", style: { fontSize: 11.5, flexShrink: 0 } }, s.id),
            React.createElement("span", { className: "muted grow", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.project + " \u00b7 " + s.started),
            React.createElement(Icon, { name: "chevronRight", size: 12, style: { color: "var(--text-muted)", flexShrink: 0 } }))))));
  }

  const SUB_DESC = {
    "drift-detector": "Scans spec links and reports which have drifted since they were set. Runs as a sidechain off spec-verify.",
    "spec-implementer": "Plans and writes code for a requirement inside an isolated worktree. The heaviest subagent \u2014 mostly plan re-reads.",
    "test-writer": "Generates and runs tests for freshly implemented code paths.",
    "link-verifier": "Re-checks a single spec link against current code and updates its state.",
  };
  function SubagentDetail({ sub, onClose }) {
    const sessions = entitySessions(sub.name);
    const trend = fileTrend({ path: sub.name, calls: sub.calls });
    const cost = (sub.tokens / 1e6 * 6.2).toFixed(2); // rough blended $/M
    const avg = Math.round(sub.tokens / sub.calls);
    const heavy = sub.tokens > 800000;
    return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
      React.createElement(DrillHeader, { icon: "bot", color: "var(--node-route)", title: sub.name, copy: sub.name, onClose }),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 14 } },
        React.createElement("div", { className: "secondary", style: { fontSize: 12, lineHeight: 1.55, marginBottom: 16 } }, SUB_DESC[sub.name]),
        React.createElement("div", { className: "row", style: { gap: 16, marginBottom: 16 } },
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Invocations"), React.createElement("div", { className: "tabular", style: { fontSize: 22, fontWeight: 700, lineHeight: 1 } }, sub.calls)),
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Tokens"), React.createElement("div", { className: "tabular", style: { fontSize: 22, fontWeight: 700, lineHeight: 1, color: heavy ? "var(--warn)" : "var(--text-primary)" } }, D.fmtK(sub.tokens))),
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Cost"), React.createElement("div", { className: "tabular", style: { fontSize: 22, fontWeight: 700, lineHeight: 1, color: "var(--node-code)" } }, "$" + cost))),
        React.createElement("div", { className: "row", style: { gap: 18, marginBottom: 16, alignItems: "center" } },
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5, marginBottom: 4 } }, "7-day trend"), React.createElement(C.Sparkline, { data: trend, color: "var(--node-route)", fill: true, w: 130, h: 28 })),
          React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "avg / call"), React.createElement("div", { className: "mono tabular", style: { fontSize: 13, color: avg > 100000 ? "var(--warn)" : "var(--text-secondary)" } }, D.fmtK(avg)))),
        heavy && React.createElement("div", { style: { background: "var(--warn-soft)", border: "1px solid rgba(229,165,10,0.25)", borderRadius: 8, padding: "9px 11px", marginBottom: 16, display: "flex", gap: 9 } },
          React.createElement(Icon, { name: "tips", size: 14, style: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } }),
          React.createElement("div", { style: { fontSize: 11.5, lineHeight: 1.5 } }, "Averages ", React.createElement("span", { className: "mono" }, D.fmtK(avg)), " input per call. Most is the re-read plan artifact \u2014 pass ", React.createElement("code", { className: "mono", style: { fontSize: 11 } }, "--plan-ref"), " to cut it roughly in half.")),
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Ran in " + sessions.length + " sessions"),
        React.createElement("div", { className: "col gap-6", style: { marginBottom: 16 } },
          sessions.map((s) => React.createElement("div", { key: s.id, onClick: () => window.go("sessions", { query: { sel: s.id } }), className: "row gap-8", style: { padding: "7px 9px", borderRadius: 7, border: "1px solid var(--border-subtle)", cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { className: "mono", style: { fontSize: 11.5, flexShrink: 0 } }, s.id),
            React.createElement("span", { className: "muted grow", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, s.project + " \u00b7 " + s.started),
            React.createElement(Icon, { name: "chevronRight", size: 12, style: { color: "var(--text-muted)", flexShrink: 0 } })))),
        React.createElement("button", { className: "btn btn-secondary btn-sm", style: { width: "100%", justifyContent: "center" }, onClick: () => window.go("tips") }, React.createElement(Icon, { name: "tips", size: 13 }), "See related tips")));
  }
  window.SCREENS.heatmap = Heatmap;

  // ============== COSTS ==============
  function Costs() {
    const [range, setRange] = useState("month");
    const [hover, setHover] = useState(null);
    const total = D.byModel.reduce((a, b) => a + b.cost, 0);
    const ranked = [...D.prompts].sort((a, b) => b.cost - a.cost).slice(0, 8);
    const maxP = ranked[0].cost;
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "dollar", title: "Costs", sub: "Where the money goes", actions: React.createElement(UI.RangeSelector, { value: range, onChange: setRange }) }),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14, marginBottom: 14 } },
        React.createElement("div", { className: "card card-pad" },
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 } },
            React.createElement("div", null,
              React.createElement("div", { className: "tabular", style: { fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" } }, "$" + total.toFixed(2)),
              React.createElement("div", { className: "row gap-8", style: { marginTop: 2 } }, React.createElement("span", { className: "muted", style: { fontSize: 11.5 } }, "total \u00b7 30 days"), React.createElement(UI.Delta, { value: 0.14, invert: true }))),
            hover && React.createElement("div", { style: { textAlign: "right" } }, React.createElement("div", { className: "mono", style: { fontSize: 13, fontWeight: 600 } }, "$" + hover.cost.toFixed(2)), React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, hover.prompts + " prompts \u00b7 " + hover.day + "d ago"))),
          React.createElement(C.LineChart, { series: D.costSeries, color: "var(--accent)", onHover: setHover, h: 200 })),
        React.createElement("div", { className: "card card-pad", style: { display: "flex", flexDirection: "column", alignItems: "center" } },
          React.createElement("div", { className: "row gap-8", style: { alignSelf: "flex-start", marginBottom: 8 } }, React.createElement(Icon, { name: "layers", size: 14, style: { color: "var(--node-code)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "By model")),
          React.createElement(C.Donut, { data: D.byModel, size: 150, centerLabel: "$" + total.toFixed(0), centerSub: "30 days" }),
          React.createElement("div", { className: "col gap-6", style: { marginTop: 14, width: "100%" } },
            D.byModel.map((m) => React.createElement("div", { key: m.model, className: "row gap-8" },
              React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: m.color } }),
              React.createElement("span", { className: "mono grow", style: { fontSize: 11.5 } }, m.short),
              React.createElement("span", { className: "mono tabular", style: { fontSize: 11.5 } }, "$" + m.cost.toFixed(1)),
              React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5, width: 38, textAlign: "right" } }, Math.round(m.cost / total * 100) + "%"))))),
      React.createElement("div", { className: "card card-pad" },
        React.createElement("div", { className: "row gap-8", style: { marginBottom: 12 } }, React.createElement(Icon, { name: "sortAsc", size: 14, style: { color: "var(--accent)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Most expensive prompts"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 top " + ranked.length)),
        ranked.map((p, i) => React.createElement("div", { key: p.id, className: "row gap-12", style: { padding: "9px 0", borderTop: i ? "1px solid var(--border-subtle)" : "none" } },
          React.createElement("span", { className: "mono muted tabular", style: { width: 16, fontSize: 11 } }, i + 1),
          React.createElement("div", { className: "grow", style: { minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.text),
            React.createElement("div", { style: { marginTop: 4, maxWidth: 280 } }, React.createElement(UI.Bar, { frac: p.cost / maxP, color: p.cost / maxP > 0.66 ? "var(--error)" : "var(--accent)" }))),
          React.createElement("span", { className: "mono muted", style: { fontSize: 10.5, width: 64, textAlign: "right" } }, p.model),
          React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11, width: 56, textAlign: "right" } }, D.fmtK(p.tokens)),
          React.createElement("span", { className: "mono tabular", style: { fontSize: 11, width: 40, textAlign: "right", color: cacheColor(p.cache) } }, Math.round(p.cache * 100) + "%"),
          React.createElement("span", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, width: 52, textAlign: "right" } }, "$" + p.cost.toFixed(2)))))));
  }
  window.SCREENS.costs = Costs;

  // ============== COMPARE ==============
  function Compare() {
    const [sel, setSel] = useState(new Set(D.projects.map((p) => p.id)));
    const rows = D.projects.filter((p) => sel.has(p.id));
    const best = [...rows].sort((a, b) => (b.cacheHit - b.avg / 100) - (a.cacheHit - a.avg / 100))[0];
    const segs = [{ key: "Opus 4", color: "#A586F5", label: "Opus" }, { key: "Sonnet 4", color: "#5B93F2", label: "Sonnet" }, { key: "Haiku 4", color: "#29D2BE", label: "Haiku" }];
    const barRows = rows.map((p) => ({ label: p.name, values: { "Opus 4": p.cost * 0.62, "Sonnet 4": p.cost * 0.3, "Haiku 4": p.cost * 0.08 } }));
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "compare", title: "Compare projects", sub: "Which projects are cost-efficient vs hungry" }),
      React.createElement("div", { className: "row gap-6", style: { marginBottom: 14, flexWrap: "wrap" } },
        D.projects.map((p) => React.createElement("button", { key: p.id, onClick: () => setSel((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; }), style: {
          height: 28, padding: "0 12px", borderRadius: 999, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
          border: "1px solid " + (sel.has(p.id) ? "transparent" : "var(--border-subtle)"), background: sel.has(p.id) ? "var(--accent-soft)" : "var(--bg-panel)", color: sel.has(p.id) ? "var(--accent)" : "var(--text-muted)" } }, p.name))),
      best && React.createElement("div", { className: "card card-pad", style: { marginBottom: 14, borderColor: "rgba(70,194,107,0.3)", background: "var(--success-soft)", display: "flex", gap: 12, alignItems: "center" } },
        React.createElement("div", { style: { color: "var(--success)" } }, React.createElement(Icon, { name: "sparkles", size: 18 })),
        React.createElement("div", { className: "grow" }, React.createElement("span", { style: { fontWeight: 600, fontSize: 13 } }, "Most efficient: "), React.createElement("span", { className: "mono", style: { color: "var(--success)" } }, best.name),
          React.createElement("span", { className: "secondary", style: { fontSize: 12.5 } }, " \u2014 " + Math.round(best.cacheHit * 100) + "% cache hit, $" + best.avg.toFixed(2) + " avg/session, just " + best.drift + " drifted links.")),
        React.createElement("button", { className: "btn btn-secondary btn-sm" }, React.createElement(Icon, { name: "external", size: 12 }), "Export report")),
      React.createElement("div", { className: "card", style: { overflow: "hidden", marginBottom: 14 } },
        React.createElement("div", { className: "row", style: { padding: "9px 14px", fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, borderBottom: "1px solid var(--border-subtle)" } },
          React.createElement("span", { className: "grow" }, "Project"), th("Cost"), th("Runs"), th("Avg"), th("Cache"), React.createElement("span", { style: { width: 60, textAlign: "right" } }, "Drift"), React.createElement("span", { style: { width: 150, textAlign: "right" } }, "Top tools")),
        rows.map((p) => React.createElement("div", { key: p.id, className: "row", style: { padding: "11px 14px", borderTop: "1px solid var(--border-subtle)" } },
          React.createElement("span", { className: "mono grow", style: { fontSize: 12.5, color: p.id === best.id ? "var(--success)" : "var(--text-primary)" } }, p.name),
          td("$" + p.cost.toFixed(0)), td(p.sessions), td("$" + p.avg.toFixed(2)),
          React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12, color: cacheColor(p.cacheHit) } }, Math.round(p.cacheHit * 100) + "%"),
          React.createElement("span", { className: "mono tabular", style: { width: 60, textAlign: "right", fontSize: 12, color: p.drift > 10 ? "var(--warn)" : "var(--text-secondary)" } }, p.drift),
          React.createElement("span", { className: "row gap-4", style: { width: 150, justifyContent: "flex-end" } }, p.tools.map((t) => React.createElement("code", { key: t, className: "mono", style: { fontSize: 9.5, background: "var(--bg-canvas)", padding: "1px 5px", borderRadius: 3, color: "var(--text-secondary)" } }, t)))))),
      React.createElement("div", { className: "card card-pad" },
        React.createElement("div", { className: "row", style: { justifyContent: "space-between", marginBottom: 14 } },
          React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "dollar", size: 14, style: { color: "var(--accent)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Cost by model per project")),
          React.createElement("div", { className: "row gap-12" }, segs.map((s) => React.createElement("span", { key: s.key, className: "row gap-4 muted", style: { fontSize: 10.5 } }, React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: s.color } }), s.label)))),
        React.createElement(C.StackedBars, { rows: barRows, segments: segs, fmt: (v) => "$" + v.toFixed(0) })));
  }
  function th(t) { return React.createElement("span", { style: { width: 70, textAlign: "right" } }, t); }
  function td(v) { return React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12 } }, v); }
  window.SCREENS.compare = Compare;

  // ============== TIPS ==============
  function TipCard({ tip, focus }) {
    const [snoozed, setSnoozed] = useState(false);
    const [showSnooze, setShowSnooze] = useState(false);
    const [lit, setLit] = useState(false);
    const ref = React.useRef(null);
    React.useEffect(() => {
      if (!focus || !ref.current) return;
      const card = ref.current;
      const sc = card.closest(".scroll-y");
      if (sc) sc.scrollTop = Math.max(0, card.offsetTop - 20);
      setLit(true);
      const t = setTimeout(() => setLit(false), 1800);
      return () => clearTimeout(t);
    }, [focus]);
    const col = tip.severity === "error" ? "var(--error)" : tip.severity === "warn" ? "var(--warn)" : "var(--info)";
    if (snoozed) return null;
    return React.createElement("div", { ref, className: "card", style: { display: "flex", transition: "box-shadow 200ms ease, border-color 200ms ease", boxShadow: lit ? `0 0 0 2px ${col}` : "none", borderColor: lit ? col : undefined } },
      React.createElement("div", { style: { width: 3, background: col, flexShrink: 0, borderRadius: "9px 0 0 9px" } }),
      React.createElement("div", { style: { padding: "14px 16px", flex: 1, minWidth: 0 } },
        React.createElement("div", { className: "row gap-10", style: { marginBottom: 10 } },
          React.createElement("div", { style: { width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${col} 16%, transparent)`, display: "grid", placeItems: "center", color: col, flexShrink: 0 } }, React.createElement(Icon, { name: tip.icon, size: 15 })),
          React.createElement("div", { className: "grow", style: { minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty" } }, tip.title)),
          React.createElement(UI.Pill, { color: col, bg: `color-mix(in srgb, ${col} 14%, transparent)` }, tip.severity)),
        React.createElement("div", { className: "secondary", style: { fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 } }, tip.why),
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } },
          React.createElement("div", { onClick: () => window.go("sessions", { query: { sel: tip.evidence.session } }), title: "Open session " + tip.evidence.session, style: { background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10, cursor: "pointer", transition: "border-color 120ms ease, background 120ms ease" },
            onMouseEnter: (e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.background = "var(--bg-hover)"; },
            onMouseLeave: (e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.background = "var(--bg-canvas)"; } },
            React.createElement("div", { className: "row gap-6", style: { marginBottom: 5 } },
              React.createElement("span", { className: "eyebrow" }, "Evidence"),
              React.createElement("span", { className: "grow" }),
              React.createElement(Icon, { name: "arrowRight", size: 11, style: { color: "var(--text-muted)" } })),
            React.createElement("div", { className: "row gap-6", style: { fontSize: 11.5 } }, React.createElement(Icon, { name: "sessions", size: 11, style: { color: "var(--text-muted)" } }), React.createElement("span", { className: "mono", style: { color: "var(--accent)" } }, tip.evidence.session)),
            React.createElement("div", { className: "mono secondary", style: { fontSize: 11, marginTop: 4 } }, tip.evidence.detail)),
          React.createElement("div", { style: { background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10 } },
            React.createElement("div", { className: "eyebrow", style: { marginBottom: 5 } }, "Impact"),
            React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--success)", fontVariantNumeric: "tabular-nums" } }, tip.saving))),
        React.createElement("div", { className: "row gap-8", style: { alignItems: "center" } },
          React.createElement("div", { className: "row gap-8 grow", style: { background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "6px 10px", minWidth: 0 } },
            React.createElement("span", { className: "muted", style: { fontSize: 10.5, flexShrink: 0 } }, "fix"),
            React.createElement("code", { className: "mono grow", style: { fontSize: 11.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tip.fix),
            React.createElement(UI.CopyBtn, { text: tip.fix })),
          React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 applying tips is disabled" }, "Apply"),
          React.createElement("div", { style: { position: "relative" } },
            React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setShowSnooze((s) => !s) }, "Dismiss", React.createElement(Icon, { name: "chevronDown", size: 12 })),
            showSnooze && React.createElement("div", { style: { position: "absolute", top: "100%", right: 0, marginTop: 4, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 5, width: 130, zIndex: 30 } },
              ["1 day", "1 week", "Forever"].map((o) => React.createElement("div", { key: o, onClick: () => setSnoozed(true), style: { padding: "6px 9px", borderRadius: 5, cursor: "pointer", fontSize: 12 },
                onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" }, "Snooze " + o)))))));
  }
  function Tips({ query }) {
    const focusId = query && query.sel;
    const ordered = [...D.tips].sort((a, b) => { const w = { error: 0, warn: 1, info: 2 }; return w[a.severity] - w[b.severity]; });
    const counts = { error: D.tips.filter((t) => t.severity === "error").length, warn: D.tips.filter((t) => t.severity === "warn").length, info: D.tips.filter((t) => t.severity === "info").length };
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "tips", title: "Tips", sub: "A senior teammate reviewed your transcripts",
        actions: React.createElement("div", { className: "row gap-6" }, React.createElement(UI.Pill, { color: "var(--error)", bg: "var(--error-soft)" }, counts.error + " urgent"), React.createElement(UI.Pill, { color: "var(--warn)", bg: "var(--warn-soft)" }, counts.warn + " warn"), React.createElement(UI.Pill, { color: "var(--info)", bg: "var(--info-soft)" }, counts.info + " info")) }),
      React.createElement("div", { className: "col gap-12", style: { maxWidth: 860 } }, ordered.map((t) => React.createElement(TipCard, { key: t.id, tip: t, focus: t.id === focusId }))));
  }
  window.SCREENS.tips = Tips;
})();
