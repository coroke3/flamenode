import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const component = read("./VideoForm.tsx");
const css = read("./VideoForm.module.css");

test("VideoFormが参照するCSS module classはすべて定義されている", () => {
  const classNames = new Set(
    [...component.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]),
  );

  assert.ok(classNames.size > 0);
  for (const className of classNames) {
    assert.match(
      css,
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`),
      `VideoForm.module.css に .${className} がありません`,
    );
  }
});

test("投稿フォームは空の右カラムを作らない", () => {
  assert.match(
    css,
    /\.form\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  );
  assert.doesNotMatch(
    css,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(/,
  );
});

test("スマホでも唯一の投稿操作を固定表示する", () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.actions\s*\{[\s\S]*?position:\s*fixed;/,
  );
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:[^)]+\)[\s\S]*?\.actions\s*\{[^}]*display:\s*none;/,
  );
});
