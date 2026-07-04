/**
 * Minimal, dependency-free Markdown → HTML for the SSR dashboard.
 *
 * Scope is deliberately small: the subset spec bodies actually use — headings,
 * bold/italic/inline-code, fenced code, unordered/ordered lists, and paragraphs.
 * Everything is HTML-escaped first, so rendering is safe for untrusted spec
 * text (no raw HTML passthrough). This is the SSR counterpart to the Angular
 * app's `render-md.ts`; keeping it dependency-free is what keeps the web-ssr
 * tree under the REQ-DASHLEAN-002 package ceiling.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip embedded `<!-- id: REQ-X -->` markers — structural noise, not prose. */
export function stripSpecMarkers(s) {
  return String(s).replace(/<!--[\s\S]*?-->/g, '');
}

function inline(s) {
  // Operate on already-escaped text so the markup we add is the only HTML.
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, (_, p, c) => `${p}<em>${c}</em>`);
}

export function renderMd(src) {
  const lines = escapeHtml(stripSpecMarkers(src ?? '')).split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' ')).trim()}</p>`); para = []; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flushPara();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // closing fence
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`); i++; continue; }

    // list (consume a run of bullet / ordered lines)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '').trim())}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // blank line ends a paragraph
    if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join('\n');
}
