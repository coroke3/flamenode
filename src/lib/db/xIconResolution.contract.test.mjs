import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./xIconResolution.ts", import.meta.url),
  "utf8",
);

test("アイコン補完はXユーザー既定値を最優先する", () => {
  const xUserLookup = source.indexOf("if (xRow?.icon_url) return xRow.icon_url");
  const fallbackLookup = source.indexOf("fetchLatestCreatorSnapshots(db, [xId])");
  assert.ok(xUserLookup >= 0);
  assert.ok(fallbackLookup > xUserLookup);
});

test("個人作を合作より優先する", () => {
  assert.match(
    source,
    /maps\.individualIcons\.get\([^)]*\)\s*\?\?\s*maps\.collabIcons\.get/s,
  );
  assert.match(
    source,
    /maps\.individualNames\.get\([^)]*\)\s*\?\?\s*maps\.collabNames\.get/s,
  );
});

test("最新の非NULLアイコンと表示名を独立して選ぶ", () => {
  assert.match(source, /PARTITION BY[\s\S]*creator_x_user_id[\s\S]*collaboration_type/);
  assert.match(
    source,
    /CASE WHEN[\s\S]*creator_icon_url[\s\S]*IS NULL THEN 1 ELSE 0 END[\s\S]*created_at[\s\S]*DESC/,
  );
  assert.match(
    source,
    /CASE WHEN[\s\S]*creator_display_name[\s\S]*IS NULL THEN 1 ELSE 0 END[\s\S]*created_at[\s\S]*DESC/,
  );
  assert.match(source, /icon_rank === 1/);
  assert.match(source, /name_rank === 1/);
});

test("voidedを補完元から除外する", () => {
  assert.match(
    source,
    /ne\(videos\.visibility_status, ["']voided["']\)/,
  );
});

test("getXIconCandidates は public な作品アイコンのみ候補にする", () => {
  const functionBody = source.slice(
    source.indexOf("export async function getXIconCandidates"),
    source.indexOf("export async function resolveMemberNames"),
  );
  assert.match(functionBody, /eq\(videos\.visibility_status, ["']public["']\)/);
});

test("メンバー配列はmapで同じ順序のまま返す", () => {
  const functionBody = source.slice(
    source.indexOf("export async function resolveMemberIcons"),
    source.indexOf("export async function getXIconCandidates"),
  );
  assert.match(functionBody, /return members\.map\(/);
  assert.doesNotMatch(functionBody, /\.sort\(/);
});
