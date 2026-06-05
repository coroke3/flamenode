/**
 * Excel / Google スプレッドシートのクリップボード形式を表グリッドに変換。
 * text/plain (TSV) に加え text/html (<table>) をフォールバックで読む。
 */

export {
  parseClipboardContent,
  looksLikeTabularClipboard,
} from "@/lib/utils/clipboardParse";
export { parseHtmlClipboardTable } from "@/lib/utils/clipboardHtml";

import {
  parseClipboardContent,
} from "@/lib/utils/clipboardParse";

/** ClipboardEvent の DataTransfer からグリッド取得 */
export function readGridFromDataTransfer(dt: DataTransfer): {
  plain: string;
  html: string;
  grid: string[][];
} {
  const plain = dt.getData("text/plain") ?? "";
  const html = dt.getData("text/html") ?? "";
  const grid = parseClipboardContent(plain, html);
  return { plain, html, grid };
}

/** Async Clipboard API（Excel 向けに text/html も読む） */
export async function readGridFromClipboard(): Promise<{
  plain: string;
  html: string;
  grid: string[][];
} | null> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      let plain = "";
      let html = "";
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          plain = await (await item.getType("text/plain")).text();
        }
        if (item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
      }
      const grid = parseClipboardContent(plain, html);
      if (grid.length > 0 || plain.trim() || html.trim()) {
        return { plain, html, grid };
      }
    } catch {
      /* readText へフォールバック */
    }
  }

  try {
    const plain = await navigator.clipboard.readText();
    if (!plain.trim()) return null;
    const grid = parseClipboardContent(plain, "");
    return { plain, html: "", grid };
  } catch {
    return null;
  }
}
