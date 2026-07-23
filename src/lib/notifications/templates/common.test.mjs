/**
 * 通知テンプレート共通ユーティリティの契約テスト。
 * 実行: node --test --experimental-strip-types src/lib/notifications/templates/common.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const commonSource = await readFile(new URL("./common.ts", import.meta.url), "utf8");
const userSource = await readFile(new URL("./user.ts", import.meta.url), "utf8");
const errorsSource = await readFile(new URL("./errors.ts", import.meta.url), "utf8");

test("common.ts は日本時間・ステータス日本語化・メンション無効を持つ", () => {
  assert.match(commonSource, /Asia\/Tokyo/);
  assert.match(commonSource, /pending: "運営確認待ち"/);
  assert.match(commonSource, /voided: "無効"/);
  assert.match(commonSource, /public: "公開中"/);
  assert.match(commonSource, /parse: \[\]/);
  assert.match(commonSource, /escapeDiscordMention/);
  assert.match(commonSource, /buildAllowedMentions/);
  assert.match(commonSource, /videoId \?\? args\.video_id/);
});

test("welcome テンプレートはオンボーディング誘導を含む", () => {
  assert.match(userSource, /\/onboarding/);
  assert.match(userSource, /利用規約/);
  assert.match(userSource, /buildWelcomeAccountNotification/);
});

test("配送失敗テンプレートは @here と allowed_mentions を含む", () => {
  assert.match(errorsSource, /@here/);
  assert.match(errorsSource, /buildAllowedMentions\(\{ everyone: true \}\)/);
  assert.match(errorsSource, /buildDeliveryFailureOpsNotification/);
});
