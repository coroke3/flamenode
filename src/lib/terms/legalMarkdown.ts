export type LegalMarkdownBlock =
  | { type: "heading2"; text: string }
  | { type: "heading3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

/**
 * 利用規約で許可する最小Markdownを構造化する。
 * HTML、URL、属性、inline Markdownは解釈せず、Reactのtext nodeへ渡す文字列として保持する。
 */
export function parseLegalMarkdown(markdown: string): LegalMarkdownBlock[] {
  const blocks: LegalMarkdownBlock[] = [];
  let listItems: string[] = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      blocks.push({ type: "heading2", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      blocks.push({ type: "heading3", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("* ") || line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    blocks.push({ type: "paragraph", text: line });
  }
  flushList();
  return blocks;
}

