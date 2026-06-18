/**
 * Markdown renderer used by Memory and Specs pages.
 *
 * Renders the Markdown subset SpecShip's CLAUDE.md and spec files actually
 * use into HTML with semantic classes. All styling lives in the consuming
 * page's SCSS (under `.md-content`) — no inline styles so theme variables
 * stay authoritative across pages.
 *
 * Supported:
 *   - h1..h4 (`#`, `##`, `###`, `####`)
 *   - Bulleted lists (`- foo`) and numbered lists (`1. foo`)
 *   - Fenced code blocks (```lang … ```), inline code (`x`), bold (**x**)
 *   - Tables (`| a | b |` + `|---|---|`)
 *   - Blockquotes (`> note`)
 *   - `@path` import lines
 *   - Blank lines as paragraph breaks
 *
 * Anything richer (links, images, html, nested lists) renders as plain
 * text — keep the renderer small. If a consumer needs full GFM, swap in
 * markdown-it. The CLAUDE.md and spec surfaces this util targets stay
 * within the subset above.
 *
 * Output expects to be passed through DomSanitizer.bypassSecurityTrustHtml
 * by the caller. Inputs are HTML-escaped before any class wrapping so
 * untrusted bodies cannot inject markup.
 */

export function renderMd(body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="md-inline-code mono">$1</code>');

  const out: string[] = [];
  type ListKind = 'ul' | 'ol' | null;
  let listKind: ListKind = null;
  const closeList = () => {
    if (listKind) { out.push(`</${listKind}>`); listKind = null; }
  };

  const lines = body.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? '';

    // --- fenced code block: greedy until closing fence or EOF -------------
    const fence = ln.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      // i now points at the closing fence (or past EOF) — for-loop's i++ skips it
      const langAttr = lang ? ` data-lang="${esc(lang)}"` : '';
      const langBadge = lang ? `<span class="md-pre-lang mono">${esc(lang)}</span>` : '';
      out.push(`<pre class="md-pre"${langAttr}>${langBadge}<code class="mono">${esc(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // --- table: header row + separator row + body rows -------------------
    const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
    const isTableSep = (s: string) => /^\s*\|?\s*:?-{3,}/.test(s) && s.includes('|');
    if (isTableRow(ln) && isTableSep(lines[i + 1] ?? '')) {
      closeList();
      const splitRow = (s: string) =>
        s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const headers = splitRow(ln);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && isTableRow(lines[i] ?? '')) {
        rows.push(splitRow(lines[i] ?? ''));
        i++;
      }
      i--; // for-loop's i++ will advance past the last consumed row
      const head = headers.map((h) => `<th>${inline(h)}</th>`).join('');
      const bodyRows = rows.map((r) =>
        `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`
      ).join('');
      out.push(`<div class="md-table-scroll"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table></div>`);
      continue;
    }

    // --- headings: ####, ###, ##, # --------------------------------------
    if (ln.startsWith('#### ')) {
      closeList(); out.push(`<h5 class="md-h4">${inline(ln.slice(5))}</h5>`); continue;
    }
    if (ln.startsWith('### ')) {
      closeList(); out.push(`<h4 class="md-h3">${inline(ln.slice(4))}</h4>`); continue;
    }
    if (ln.startsWith('## ')) {
      closeList(); out.push(`<h3 class="md-h2">${inline(ln.slice(3))}</h3>`); continue;
    }
    if (ln.startsWith('# ')) {
      closeList(); out.push(`<h2 class="md-h1">${inline(ln.slice(2))}</h2>`); continue;
    }

    // --- @path import lines ---------------------------------------------
    if (ln.startsWith('@')) {
      closeList(); out.push(`<div class="md-import mono">${esc(ln)}</div>`); continue;
    }

    // --- blockquote ------------------------------------------------------
    if (/^\s*> /.test(ln)) {
      closeList();
      out.push(`<blockquote class="md-blockquote">${inline(ln.replace(/^\s*> /, ''))}</blockquote>`);
      continue;
    }

    // --- numbered list ---------------------------------------------------
    if (/^\s*\d+\.\s+/.test(ln)) {
      if (listKind !== 'ol') { closeList(); out.push('<ol class="md-ol">'); listKind = 'ol'; }
      out.push(`<li>${inline(ln.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // --- bullet list -----------------------------------------------------
    if (/^\s*- /.test(ln)) {
      if (listKind !== 'ul') { closeList(); out.push('<ul class="md-list">'); listKind = 'ul'; }
      out.push(`<li>${inline(ln.replace(/^\s*- /, ''))}</li>`);
      continue;
    }

    // --- blank line as spacer -------------------------------------------
    if (ln.trim() === '') {
      closeList();
      out.push('<div class="md-spacer" aria-hidden="true"></div>');
      continue;
    }

    // --- fallback paragraph ---------------------------------------------
    closeList();
    out.push(`<p class="md-p">${inline(ln)}</p>`);
  }
  closeList();
  return out.join('');
}
