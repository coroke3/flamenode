import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const signOutButton = await readFile(
  new URL("../../components/auth/SignOutButton.tsx", import.meta.url),
  "utf8",
);

test("SignOutButtonはuseState pendingと二重送信防止、成功時hard navigateする", () => {
  assert.match(signOutButton, /"use client"/);
  assert.match(signOutButton, /useState\(false\)/);
  assert.doesNotMatch(signOutButton, /useTransition/);
  assert.match(signOutButton, /if \(pending\) return/);
  assert.match(signOutButton, /setPending\(true\)/);
  assert.match(signOutButton, /disabled=\{pending\}/);
  assert.match(signOutButton, /aria-busy=\{pending\}/);
  assert.match(signOutButton, /signOutViaAuthRoute/);
  assert.doesNotMatch(signOutButton, /@\/lib\/actions\/authSignOut/);
  assert.match(signOutButton, /window\.location\.replace\("\/"\)/);
  assert.doesNotMatch(signOutButton, /router\.push/);
  assert.doesNotMatch(signOutButton, /useRouter/);
});

test("SignOutButtonはpending中にログアウト中文言を表示し、メニュー閉鎖コールバックを呼ばない", () => {
  assert.match(signOutButton, /pending \? "ログアウト中…"/);
  assert.doesNotMatch(signOutButton, /onBeforeSignOut/);
});

test("SignOutButtonは失敗時にrole=alertで再試行可能", () => {
  assert.match(signOutButton, /role="alert"/);
  assert.match(signOutButton, /setError\(result\.message\)/);
  assert.match(signOutButton, /setPending\(false\)/);
  assert.match(signOutButton, /type="button"/);
});

test("SignOutButtonはGETログアウトや直リンクを使わない", () => {
  assert.doesNotMatch(signOutButton, /href=.*\/api\/auth\/signout/);
  assert.doesNotMatch(signOutButton, /\/api\/auth\/signout/);
  assert.doesNotMatch(signOutButton, /<form/);
});
