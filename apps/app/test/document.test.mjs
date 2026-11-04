// MIG-0701 U05 (D-13-8): read-only Personal SPA root document parity.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mount, uniformApi } from "./helpers.mjs";

const root = new URL("../../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");

const parse = (source) => {
  const rules = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), cache: null });
    else {
      const match = /^Cache-Control:\s*(.+)$/i.exec(line.trim());
      if (match) rules.at(-1).cache = match[1];
    }
  }
  return rules;
};
const cache = (rules, path) => {
  let result = null;
  for (const rule of rules) {
    const match = new RegExp("^" + rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    if (match.test(path)) result = result === null ? rule.cache : result + ", " + rule.cache;
  }
  return result;
};

test("MIG-0701 U05 T01: noindex / viewport / CURRENT theme bootstrap exact match", async () => {
  const [html, current] = await Promise.all([read("apps/app/index.html"), read("app/layout.tsx")]);
  const code = /const themeBootstrapCode = `([^`]*)`;/s.exec(current)?.[1];
  assert.ok(code);
  assert.ok(html.includes(`<script>${code}</script>`));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.ok(html.includes('width=device-width, initial-scale=1, viewport-fit=cover'));
  assert.ok(html.includes('name="theme-color"'));
});

test("MIG-0701 U05 T02: private route HTML no-store; hashed assets immutable", async () => {
  const rules = parse(await read("apps/app/public/_headers"));
  for (const p of ["/dashboard", "/dashboard/library", "/dashboard/settings", "/dashboard/youtube-playlists", "/onboarding"]) {
    assert.equal(cache(rules, p), "private, no-cache, no-store, max-age=0, must-revalidate", p);
  }
  assert.equal(cache(rules, "/_personal_assets/index-AbC123.js"), "public, max-age=31536000, immutable");
  assert.equal(cache(rules, "/"), null);
  assert.equal(cache(rules, "/index.html"), null);
});

test("MIG-0701 U05 T03: all Personal routes have CURRENT shell and main", async () => {
  for (const path of ["/dashboard", "/dashboard/library", "/dashboard/settings", "/dashboard/youtube-playlists", "/onboarding"]) {
    const m = await mount(path, uniformApi("anonymous"));
    assert.ok(m.container.querySelector('[data-fn-surface="personal"].fn-personal-shell.fn-app > main.fn-main'), path);
    await m.unmount();
  }
});

test("MIG-0701 U05 T04: failure view stays within private main shell", async () => {
  const m = await mount("/dashboard/settings", uniformApi("unavailable"));
  const main = m.container.querySelector('[data-fn-surface="personal"] > main.fn-main');
  assert.ok(main);
  assert.match(main.textContent, /画面の表示中に問題が発生しました/);
  await m.unmount();
});
