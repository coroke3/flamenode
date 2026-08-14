import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { manageEventAccentStyle } from "./eventAccent.ts";

test("event accent は対応するhexカラーだけCSS変数へ渡す", () => {
  assert.deepEqual(manageEventAccentStyle("  #B7FF00  "), {
    "--manage-event-accent": "#B7FF00",
  });
  assert.deepEqual(manageEventAccentStyle("#abcd"), {
    "--manage-event-accent": "#abcd",
  });
});

test("不正なevent accentは既定色へfail-closedする", () => {
  for (const value of [
    "",
    "red",
    "#12",
    "#12345",
    "rgb(0, 0, 0)",
    "#fff; color: red",
    "url(https://example.test/x)",
  ]) {
    assert.equal(manageEventAccentStyle(value), undefined, value);
  }
  assert.equal(manageEventAccentStyle(null), undefined);
});

test("accent_colorの画面埋め込みは共通の正規化関数を使う", async () => {
  const sources = await Promise.all([
    readFile(new URL("../../components/layout/ManageSidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/(auth)/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/(public)/event/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/admin/EventSettingsPreview.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    assert.match(source, /buildAccentVars\(/);
    assert.doesNotMatch(source, /--(?:event|accent-primary)[^\n]*event\.accent_color/);
  }
});
