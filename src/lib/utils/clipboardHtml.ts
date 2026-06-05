function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtmlTags(fragment: string): string {
  return decodeHtmlEntities(
    fragment.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).replace(/\u00a0/g, " ");
}

/** DOM なし環境向けの簡易 HTML 表パース */
function parseHtmlTableRegex(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const rowHtml = trMatch[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtmlTags(cellMatch[1] ?? "").trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Excel / Sheets が付与する HTML 表をパース */
export function parseHtmlClipboardTable(html: string): string[][] {
  if (!html.trim()) return [];

  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const table = doc.querySelector("table");
      if (table) {
        const rows: string[][] = [];
        for (const tr of table.querySelectorAll("tr")) {
          const cells = [...tr.querySelectorAll("td, th")].map((el) => {
            const t = el.textContent ?? "";
            return t.replace(/\u00a0/g, " ");
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
