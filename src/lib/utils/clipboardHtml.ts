function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, raw: string) => {
      const point = /^x/i.test(raw)
        ? Number.parseInt(raw.slice(1), 16)
        : Number(raw);
      // Numeric HTML references denote Unicode scalar values, not UTF-16
      // code units. fromCharCode truncates emoji and may introduce NUL.
      if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff
        || (point >= 0xd800 && point <= 0xdfff)) return "\uFFFD";
      return String.fromCodePoint(point);
    })
    // Decode ampersands last. An escaped numeric reference such as
    // &amp;#128640; is literal text, not a second entity to evaluate.
    .replace(/&amp;/g, "&");
}

function stripHtmlTags(fragment: string): string {
  // Keep explicit BR separators separate from text whitespace trimming.
  const parts = fragment.split(/(<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>)/gi);
  const lines = [""];
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 0) lines[lines.length - 1] += part;
    else if (/^<br(?=[\s/>])/i.test(part)) lines.push("");
  }
  const decoded = lines.map((line) => decodeHtmlEntities(line).replace(/\u00a0/g, " "));
  decoded[0] = decoded[0].trimStart();
  decoded[decoded.length - 1] = decoded[decoded.length - 1].trimEnd();
  return decoded.join("\n");
}

/** DOM なし環境向けの簡易 HTML 表パース */
function parseHtmlTableRegex(html: string): string[][] {
  // Use the same quote/comment-aware tokens as cell text extraction. Never
  // search raw attributes or comments for row/cell delimiters.
  const tokens = /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  const rows: string[][] = [];
  let inTable = false;
  let row: string[] | null = null;
  let cell: { name: string; start: number } | null = null;
  for (const match of html.matchAll(tokens)) {
    const structure = /^<(\/?)(table|tr|td|th)(?=[\s/>])/i.exec(match[0]);
    if (!structure) continue;
    const closing = structure[1] === "/";
    const name = structure[2].toLowerCase();
    if (name === "table") {
      // Nested or unbalanced tables cannot be flattened safely.
      if (row !== null || inTable === !closing) return [];
      inTable = !closing;
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
  if (inTable || row !== null || cell !== null) return [];
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
        if (filtered.length > 0) return filtered;
      }
    } catch {
      /* regex へ */
    }
  }

  return parseHtmlTableRegex(html);
}
