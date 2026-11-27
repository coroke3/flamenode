function decodeHtmlEntities(text: string): string {
  // Match the existing supported references once; replacement text is never
  // scanned again, even when numeric references produce an ampersand.
  return text.replace(/&(?:[nN][bB][sS][pP]|lt|gt|quot|amp|#(?:[xX][0-9a-fA-F]+|\d+));/g, (entity) => {
    switch (entity) {
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&amp;": return "&";
    }
    if (!entity.startsWith("&#")) return " ";
    const raw = entity.slice(2, -1);
    const point = /^x/i.test(raw)
      ? Number.parseInt(raw.slice(1), 16)
      : Number(raw);
    // Numeric HTML references denote Unicode scalar values, not UTF-16
    // code units. fromCharCode truncates emoji and may introduce NUL.
    if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff
      || (point >= 0xd800 && point <= 0xdfff)) return "\uFFFD";
    return String.fromCodePoint(point);
  });
}

function stripHtmlTags(fragment: string): string {
  // Keep explicit BR separators separate from text whitespace trimming.
  const parts = fragment.split(/(<!--(?:-?>|[\s\S]*?--!?>)|<!(?!--)[^<>]*>|<\?[^<>]*>|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>)/gi);
  const lines = [""];
  for (const [index, part] of parts.entries()) {
    // Decode each text token before joining across markup; otherwise removing
    // a tag or comment can create a character reference that was never present.
    if (index % 2 === 0) lines[lines.length - 1] += decodeHtmlEntities(part).replace(/\u00a0/g, " ");
    else if (/^<br(?=[\s/>])/i.test(part)) lines.push("");
  }
  lines[0] = lines[0].trimStart();
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  return lines.join("\n");
}

/** DOM なし環境向けの簡易 HTML 表パース */
function parseHtmlTableRegex(html: string): string[][] {
  // Use the same quote/comment-aware tokens as cell text extraction. Never
  // search raw attributes or comments for row/cell delimiters. HTML5 also
  // closes comments at --!>, <!--> and <!--->; do not consume later cells.
  const tokens = /<!--(?:-?>|[\s\S]*?--!?>)|<!(?!--)[^<>]*>|<\?[^<>]*>|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  const rows: string[][] = [];
  let inTable = false;
  let row: string[] | null = null;
  let cell: { name: string; start: number } | null = null;
  let rawHeader: string | null = null;
  // Simple declarations and processing instructions end at the first >.
  // If one contains another <, or is unfinished, matchAll must not resume
  // at an apparent row/cell token inside it. Decline that ambiguous HTML.
  // The comment alternative above remains separate from declarations.
  const unmatchedMarkup = /<(?:[!?]|\/?[a-z])/i;
  let scannedThrough = 0;
  let completeTable = false;
  for (const match of html.matchAll(tokens)) {
    if (unmatchedMarkup.test(html.slice(scannedThrough, match.index))) return [];
    scannedThrough = match.index + match[0].length;
    // The fallback is not an HTML5 parser. Do not interpret inert/raw-text
    // contents as rows. Allow simple style/title wrappers outside tables,
    // but decline markup inside them or other unsupported parsing contexts.
    const header = /^<(\/?)(style|title)(?=[\s/>])/i.exec(match[0]);
    if (rawHeader !== null) {
      if (header?.[1] === "/" && header[2].toLowerCase() === rawHeader) {
        rawHeader = null;
        continue;
      }
      // Excel can wrap CSS in an HTML-style comment. Reject comments that
      // could conceal the raw-text closing tag from this simple tokenizer.
      if (match[0].startsWith("<!--") && !/<\/(?:style|title)(?=[\s/>])/i.test(match[0])) continue;
      return [];
    }
    if (header) {
      if (header[1] || inTable || row !== null) return [];
      rawHeader = header[2].toLowerCase();
      continue;
    }
    if (/^<\/?(?:template|script|textarea|xmp|iframe|noembed|noframes|noscript|plaintext)(?=[\s/>])/i.test(match[0])) return [];
    const structure = /^<(\/?)(table|tr|td|th)(?=[\s/>])/i.exec(match[0]);
    if (!structure) continue;
    const closing = structure[1] === "/";
    const name = structure[2].toLowerCase();
    if (name === "table") {
      // Nested or unbalanced tables cannot be flattened safely.
      if (row !== null || inTable === !closing) return [];
      inTable = !closing;
      // Match DOMParser's first-table boundary. Discard preceding orphan
      // rows and ignore everything after the first complete table (even
      // when it is empty). Preserve standalone row fragments only if no
      // explicit table was encountered, as supported by the legacy fallback.
      if (closing) {
        completeTable = true;
        break;
      }
      rows.length = 0;
    } else if (name === "tr") {
      if (!closing) {
        if (row !== null) return [];
        row = [];
      } else {
        if (row === null || cell !== null) return [];
        if (row.length > 0) rows.push(row);
        row = null;
      }
    } else if (!closing) {
      if (row === null || cell !== null) return [];
      cell = { name, start: match.index + match[0].length };
    } else {
      if (row === null || cell === null || cell.name !== name) return [];
      row.push(stripHtmlTags(html.slice(cell.start, match.index)));
      cell = null;
    }
  }
  if (rawHeader !== null || inTable || row !== null || cell !== null) return [];
  if (!completeTable && unmatchedMarkup.test(html.slice(scannedThrough))) return [];
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * textContent omits <br> separators. Preserve explicit in-cell line breaks
 * without relying on innerText/layout in DOMParser-created documents.
 */
function readDomCellText(cell: Element): string {
  const pieces: string[] = [];
  const append = (node: Node): void => {
    if (node.nodeType === 3) {
      pieces.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    if ((node as Element).tagName.toLowerCase() === "br") {
      pieces.push("\n");
      return;
    }
    for (const child of Array.from(node.childNodes)) append(child);
  };
  for (const child of Array.from(cell.childNodes)) append(child);
  return pieces.join("").replace(/\u00a0/g, " ");
}

/** Excel / Sheets が付与する HTML 表をパース */
export function parseHtmlClipboardTable(html: string): string[][] {
  if (!html.trim()) return [];

  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const table = doc.querySelector("table");
      if (table) {
        // Do not flatten nested tables into extra pasted rows/columns.
        if (table.querySelector("table")) return [];
        const rows: string[][] = [];
        for (const tr of table.querySelectorAll("tr")) {
          const cells = [...tr.querySelectorAll("td, th")].map((el) => {
            return readDomCellText(el);
          });
          if (cells.length > 0) rows.push(cells);
        }
        const filtered = rows.filter(
          (r) => !(r.length === 1 && r[0].trim() === ""),
        );
        return filtered;
      }
      // A successful DOM parse is authoritative, including an empty result.
      return [];
    } catch {
      /* regex へ */
    }
  }

  return parseHtmlTableRegex(html);
}
