import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [diagnostics, page, action] = await Promise.all([
  readFile(new URL("./staticSharedInputDiagnostics.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(admin)/admin/static-builds/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../actions/static-rebuild-admin.ts", import.meta.url), "utf8"),
]);

test("共有JSON診断はR2実体とロード状態を独立してfail-closedで返す", () => {
  assert.match(diagnostics, /await bucket\.head\(key\)/);
  assert.match(diagnostics, /return object \? "present" : "missing"/);
  assert.match(diagnostics, /catch \{\s*return "unavailable"/);
  assert.match(diagnostics, /loadYoutubeRelatedBlocklist\(\)/);
  assert.match(diagnostics, /loadRandomVideoPool\(\)/);
  assert.match(diagnostics, /loadStatus: blocklist\.status/);
  assert.match(diagnostics, /loadStatus: randomPool\.status/);
  assert.match(diagnostics, /blocklist\.value\.blockedIds\.size/);
  assert.match(diagnostics, /randomPool\.value\.items\.length/);
});

test("管理画面は共有JSON状態と権限付き再生成キュー導線を表示する", () => {
  assert.match(page, /関連動画の共有JSON診断/);
  assert.match(page, /diagnostic\.objectState/);
  assert.match(page, /diagnostic\.loadStatus/);
  assert.match(page, /diagnostic\.generatedAt/);
  assert.match(page, /diagnostic\.itemCount/);
  assert.match(page, /action=\{enqueueStaticRebuildAdmin\}/);
  assert.match(page, /name="target_id" value="global"/);
  assert.match(action, /requireAdminWrite\("admin_static_rebuild"\)/);
  assert.match(action, /loadRandomVideoPool\(\)/);
  assert.match(action, /randomPool\.status !== "unavailable"/);
});
