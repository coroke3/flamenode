#!/usr/bin/env node
// tokens.json（登録済み mock のデザイントークン）から packages/ui の CSS 変数を作る。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const TOKENS_JSON = "docs/migration/mock/source/design-system/tokens.json";
export const TOKENS_CSS = "packages/ui/src/styles/tokens.css";

const cssValue = (value) => value.replace(/^\{(.+)\}$/, "var(--$1)");
const declaration = (name, value) => `  --${name}: ${cssValue(String(value))};`;

export function renderTokensCss(tokens) {
  const shared = [];
  const themed = { dark: [], light: [] };
  for (const token of [...tokens.color.tokens, ...tokens.shadow.tokens]) {
    if (typeof token.value === "string") shared.push(declaration(token.name, token.value));
    else for (const theme of ["dark", "light"]) themed[theme].push(declaration(token.name, token.value[theme]));
  }
  for (const token of [...tokens.spacing.tokens, ...tokens.radius.tokens]) shared.push(declaration(token.name, token.value));
  for (const [name, stack] of Object.entries(tokens.type.families)) shared.push(`  --font-${name}: ${stack};`);
  for (const group of tokens.type.groups) {
    for (const style of group.styles) {
      shared.push(`  --text-${style.name}-family: var(--font-${style.family ?? group.family});`);
      shared.push(declaration(`text-${style.name}-size`, style.fontSize));
      shared.push(declaration(`text-${style.name}-line-height`, style.lineHeight));
      shared.push(declaration(`text-${style.name}-weight`, style.fontWeight));
      if (style.letterSpacing) shared.push(declaration(`text-${style.name}-letter-spacing`, style.letterSpacing));
    }
  }
  return [
    `/* 生成元: ${TOKENS_JSON}（version ${tokens.version}）。手で編集しない。再生成: node scripts/generate-ui-tokens.mjs */`,
    ":root {", ...shared, "}", "",
    ":root,", '[data-theme="dark"] {', ...themed.dark, "}", "",
    '[data-theme="light"] {', ...themed.light, "}", "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_JSON, "utf8"));
  fs.mkdirSync("packages/ui/src/styles", { recursive: true });
  fs.writeFileSync(TOKENS_CSS, renderTokensCss(tokens));
}
