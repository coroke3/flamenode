import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./xIconResolution.ts", import.meta.url),
  "utf8",
);

test("resolveXUserIconはx_users.icon_urlのみを返す", () => {
  const fnBody = source.slice(
    source.indexOf("export async function resolveXUserIcon"),
    source.indexOf("export async function resolveMemberIcons"),
  );
  assert.doesNotMatch(fnBody, /fetchLatestCreatorSnapshots/);
  assert.match(fnBody, /return xRow\?\.icon_url/);
});

test("resolveMemberIconsは過去作品から補完しない", () => {
  const fnBody = source.slice(
    source.indexOf("export async function resolveMemberIcons"),
    source.indexOf("export async function getXIconCandidates"),
  );
  assert.match(fnBody, /return members/);
  assert.doesNotMatch(fnBody, /fetchLatestCreatorSnapshots/);
});

test("getXIconCandidatesは公開作品のみを候補にする", () => {
  const fnBody = source.slice(
    source.indexOf("export async function getXIconCandidates"),
    source.indexOf("export async function resolveMemberNames"),
  );
  assert.match(fnBody, /eq\(videos\.visibility_status, ["']public["']\)/);
});

test("resolveMemberNamesはx_usersとvideo_membersのみを使う", () => {
  const fnBody = source.slice(
    source.indexOf("export async function resolveMemberNames"),
  );
  assert.doesNotMatch(fnBody, /fetchLatestCreatorSnapshots/);
  assert.match(fnBody, /member\.name/);
});

test("メンバー配列はmapで同じ順序のまま返す", () => {
  const functionBody = source.slice(
    source.indexOf("export async function resolveMemberIcons"),
    source.indexOf("export async function getXIconCandidates"),
  );
  assert.match(functionBody, /return members/);
  assert.doesNotMatch(functionBody, /\.sort\(/);
});
