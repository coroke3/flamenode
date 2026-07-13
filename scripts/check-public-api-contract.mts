import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FORBIDDEN_PUBLIC_KEYS,
  PUBLIC_EVENT_KEYS,
  PUBLIC_VIDEO_KEYS,
} from "../src/lib/api/publicDto.ts";

function assertWhitelist(
  label: string,
  keys: readonly string[],
): void {
  assert.ok(keys.length > 0, `${label}: whitelistが空です`);
  assert.equal(
    new Set(keys).size,
    keys.length,
    `${label}: whitelistに重複キーがあります`,
  );
  for (const key of keys) {
    assert.ok(
      !FORBIDDEN_PUBLIC_KEYS.has(key),
      `${label}: 禁止キー ${key} がwhitelistに含まれています`,
    );
  }
}

async function readSource(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), "utf8");
}

function assertRouteBoundary(
  path: string,
  source: string,
  keyConstant: "PUBLIC_VIDEO_KEYS" | "PUBLIC_EVENT_KEYS",
): void {
  assert.match(
    source,
    new RegExp(`\\b${keyConstant}\\b`),
    `${path}: ${keyConstant}を使用していません`,
  );
  assert.match(
    source,
    /\bpickKeys\s*\(/,
    `${path}: pickKeysによるwhitelist適用がありません`,
  );
  assert.match(
    source,
    /\bassertNoForbiddenKeys\s*\(/,
    `${path}: 最終payloadの禁止キー検査がありません`,
  );
  assert.match(
    source,
    /publicServiceUnavailableResponse\s*\(\s*["']database_unavailable["']\s*\)/,
    `${path}: DB未接続を空配列200ではなく503として処理してください`,
  );
  assert.doesNotMatch(
    source,
    /if\s*\(\s*!db\s*\)[\s\S]{0,180}items\s*:\s*\[\s*\]/,
    `${path}: DB未接続時に空配列を正常応答として返しています`,
  );
}

assertWhitelist("PUBLIC_VIDEO_KEYS", PUBLIC_VIDEO_KEYS);
assertWhitelist("PUBLIC_EVENT_KEYS", PUBLIC_EVENT_KEYS);

const [videosRoute, eventsRoute] = await Promise.all([
  readSource("app/api/videos/route.ts"),
  readSource("app/api/events/route.ts"),
]);

assertRouteBoundary(
  "app/api/videos/route.ts",
  videosRoute,
  "PUBLIC_VIDEO_KEYS",
);
assertRouteBoundary(
  "app/api/events/route.ts",
  eventsRoute,
  "PUBLIC_EVENT_KEYS",
);

console.log(
  `[check:public-api-contract] OK: videos=${PUBLIC_VIDEO_KEYS.length}, events=${PUBLIC_EVENT_KEYS.length}, forbidden=${FORBIDDEN_PUBLIC_KEYS.size}`,
);
