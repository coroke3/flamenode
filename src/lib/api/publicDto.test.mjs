/**
 * publicDto.ts の単体テスト。
 * pickKeys と assertNoForbiddenKeys の振る舞いを検証する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickKeys,
  assertNoForbiddenKeys,
  FORBIDDEN_PUBLIC_KEYS,
  PUBLIC_VIDEO_KEYS,
  PUBLIC_EVENT_KEYS,
} from "./publicDto.ts";

test("pickKeys: 指定キーだけ残す", () => {
  const src = { a: 1, b: 2, c: 3 };
  const out = pickKeys(src, ["a", "c"]);
  assert.deepEqual(out, { a: 1, c: 3 });
  assert.equal("b" in out, false);
});

test("pickKeys: ソースに存在しないキーは undefined", () => {
  const src = { a: 1 };
  const out = pickKeys(src, ["a", "b"]);
  assert.equal(out.a, 1);
  assert.equal(out.b, undefined);
});

test("assertNoForbiddenKeys: null/undefined/プリミティブは no-op", () => {
  assertNoForbiddenKeys(null);
  assertNoForbiddenKeys(undefined);
  assertNoForbiddenKeys(42);
  assertNoForbiddenKeys("hello");
  assert.ok(true); // 例外が出ないこと
});

test("assertNoForbiddenKeys: 安全なオブジェクトは通過", () => {
  assertNoForbiddenKeys({ id: "v1", title: "ok" });
  assertNoForbiddenKeys({ items: [{ id: "1" }, { id: "2" }] });
  assert.ok(true);
});

test("assertNoForbiddenKeys: トップレベルに禁止キーがあれば throw", () => {
  assert.throws(
    () => assertNoForbiddenKeys({ id: "v1", discord_id: "abc" }),
    /forbidden key "discord_id"/,
  );
});

test("assertNoForbiddenKeys: ネストでも検出", () => {
  assert.throws(
    () =>
      assertNoForbiddenKeys({
        items: [{ id: "1", role: "admin" }],
      }),
    /forbidden key "role"/,
  );
});

test("assertNoForbiddenKeys: 配列インデックスもパスに含まれる", () => {
  assert.throws(
    () => assertNoForbiddenKeys([{ access_token: "x" }]),
    /\[0\]/,
  );
});

test("FORBIDDEN_PUBLIC_KEYS: 主要な禁止キーが含まれている", () => {
  for (const k of [
    "submitted_by_discord_user_id",
    "discord_id",
    "access_token",
    "refresh_token",
    "email",
    "role",
    "is_banned",
    "internal_note",
  ]) {
    assert.equal(FORBIDDEN_PUBLIC_KEYS.has(k), true, `${k} should be forbidden`);
  }
});

test("FORBIDDEN_PUBLIC_KEYS: 安全なキーは含まれない", () => {
  for (const k of ["id", "title", "youtube_video_id", "scheduled_time", "is_active"]) {
    assert.equal(FORBIDDEN_PUBLIC_KEYS.has(k), false, `${k} should NOT be forbidden`);
  }
});

test("PUBLIC_VIDEO_KEYS と FORBIDDEN_PUBLIC_KEYS は重複しない", () => {
  for (const k of PUBLIC_VIDEO_KEYS) {
    assert.equal(
      FORBIDDEN_PUBLIC_KEYS.has(k),
      false,
      `PUBLIC_VIDEO_KEYS の "${k}" は禁止キー側にも含まれている`,
    );
  }
});

test("PUBLIC_EVENT_KEYS と FORBIDDEN_PUBLIC_KEYS は重複しない", () => {
  for (const k of PUBLIC_EVENT_KEYS) {
    assert.equal(
      FORBIDDEN_PUBLIC_KEYS.has(k),
      false,
      `PUBLIC_EVENT_KEYS の "${k}" は禁止キー側にも含まれている`,
    );
  }
});
