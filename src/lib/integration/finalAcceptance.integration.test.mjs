import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return readFile(
    new URL(`../../../${path}`, import.meta.url),
    "utf8",
  );
}

test("X ID統合はevent_staff行監査を作成する", async () => {
  const text = await source(
    "src/lib/xid/merge.ts",
  );
  const core = await source(
    "src/lib/actions/merge-adminCore.ts",
  );

  assert.match(text, /buildEventStaffMergeAudits/);
  assert.match(
    core,
    /restore_strategy:\s*"recreate_deleted"/,
  );
  assert.match(
    core,
    /restore_strategy:\s*"update_before"/,
  );
});

test("イベント検索は公開運営者名を対象に含める", async () => {
  const text = await source(
    "app/(public)/event/page.tsx",
  );

  assert.match(text, /public_operator_names/);
  assert.match(text, /hasActiveFilter/);
  assert.match(text, /検索結果/);
});

test("合作メンバー判定は現在値を使う", async () => {
  const text = await source(
    "src/components/forms/VideoForm.tsx",
  );

  assert.match(
    text,
    /const \[members, setMembers\] = React\.useState/,
  );
  assert.match(
    text,
    /const memberCount = members\.filter/,
  );
  assert.match(
    text,
    /onChange=\{setMembers\}/,
  );
  assert.doesNotMatch(
    text,
    /ok=\{!isCollab \|\| Boolean\(initial\.members/,
  );
});

test("静的再生成は無料枠向け上限を持つ", async () => {
  const text = await source(
    "workers/json-generator/queuePolicy.ts",
  );

  assert.match(
    text,
    /MAX_QUEUE_ITEMS_PER_RUN\s*=\s*1/,
  );
  assert.match(
    text,
    /MAX_QUEUE_ITEMS_ECONOMY\s*=\s*1/,
  );
});

test("YouTube同期は共通timeoutとRetry-Afterを処理する", async () => {
  const youtube = await source(
    "workers/youtube-sync/index.ts",
  );
  const externalApi = await source(
    "workers/shared/externalApi.ts",
  );

  assert.match(youtube, /fetchWithTimeout/);
  assert.match(youtube, /parseSharedRetryAfterMs/);
  assert.match(youtube, /\b429\b/);
  assert.match(externalApi, /AbortController/);
  assert.match(externalApi, /retryAfterMs/);
});

test("READMEに未実装DOと旧権限正本を残さない", async () => {
  const text = await source("README.md");

  assert.doesNotMatch(
    text,
    /Durable Objects?/i,
  );
  assert.doesNotMatch(
    text,
    /permission_mask/i,
  );
});
