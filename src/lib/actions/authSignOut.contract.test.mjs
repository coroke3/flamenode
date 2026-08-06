import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const authSignOut = await readFile(
  new URL("./authSignOut.ts", import.meta.url),
  "utf8",
);

test("authSignOutはredirect:falseで成功結果を返す", () => {
  assert.match(authSignOut, /signOut\(\{ redirect: false \}\)/);
  assert.match(authSignOut, /return \{ ok: true \}/);
  assert.match(authSignOut, /AuthSignOutResult/);
  assert.match(authSignOut, /ok: false/);
  assert.match(authSignOut, /unstable_rethrow\(error\)/);
  assert.doesNotMatch(authSignOut, /redirectTo/);
});

test("authSignOutは通常例外を結果返却しNext制御例外はrethrowする", () => {
  assert.match(authSignOut, /catch \(error\)/);
  assert.match(authSignOut, /unstable_rethrow\(error\)/);
  assert.match(authSignOut, /console\.error\("\[authSignOut\] failed"/);
  assert.match(
    authSignOut,
    /message: "ログアウトに失敗しました。再読み込みしてもう一度お試しください。"/,
  );
});
