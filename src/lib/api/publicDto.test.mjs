/**
 * publicDto.ts の単体テスト。
 * pickKeys と公開禁止キー走査の振る舞いを検証する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickKeys,
  assertNoForbiddenKeys,
  findForbiddenPublicKeys,
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

test("findForbiddenPublicKeys: 全違反を走査順と完全なpath付きで返す", () => {
  assert.deepEqual(
    findForbiddenPublicKeys({
      items: [
        { id: "1", role: "admin" },
        { nested: { access_token: "secret" } },
      ],
      discord_id: "123",
    }),
    [
      { path: "$.items[0].role", key: "role" },
      { path: "$.items[1].nested.access_token", key: "access_token" },
      { path: "$.discord_id", key: "discord_id" },
    ],
  );
});

test("findForbiddenPublicKeys: 安全な値は空配列", () => {
  assert.deepEqual(findForbiddenPublicKeys({ items: [{ id: "1" }] }), []);
});

test("FORBIDDEN_PUBLIC_KEYS: 主要な禁止キーが含まれている", () => {
  for (const k of [
    "submitted_by_user_id",
    "creator_x_user_id",
    "actor_user_id",
    "operator_user_id",
    "recipient_user_id",
    "reserved_by_user_id",
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
  for (const k of ["id", "title", "youtube_video_id", "scheduled_time", "visibility_status"]) {
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

test("PUBLIC_EVENT_KEYS は canonical visibility と受付期間だけを公開する", () => {
  assert.deepEqual(PUBLIC_EVENT_KEYS, [
    "id",
    "title",
    "event_type",
    "explanation",
    "icon_url",
    "img_url",
    "accent_color",
    "visibility_status",
    "slot_type",
    "slot_visibility_mode",
    "start_time",
    "end_time",
    "entry_start_time",
    "entry_end_time",
    "max_slots_per_video",
  ]);
});
