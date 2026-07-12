import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseLegalMarkdown } from "./legalMarkdown.ts";

test("利用規約Markdownを見出し・段落・連続リストへ変換する", () => {
  assert.deepEqual(
    parseLegalMarkdown("# 規約\n本文\n\n## 条件\n- 一つ\n* 二つ\n次の段落"),
    [
      { type: "heading2", text: "規約" },
      { type: "paragraph", text: "本文" },
      { type: "heading3", text: "条件" },
      { type: "list", items: ["一つ", "二つ"] },
      { type: "paragraph", text: "次の段落" },
    ],
  );
});

test("HTML・URL・属性らしい入力を解釈せず文字列として保持する", () => {
  const source = '<script>alert(1)</script> https://example.test <a href="x">link</a>';
  assert.deepEqual(parseLegalMarkdown(source), [{ type: "paragraph", text: source }]);
});

test("rules pageは生HTML挿入とregex sanitizerを使用しない", () => {
  const page = readFileSync(
    new URL("../../../app/(public)/rules/page.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|sanitizeUserHtml/);
  assert.match(page, /parseLegalMarkdown/);
});
