/**
 * eventStatusCore の単体テスト。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEventStatus,
  eventStatusLabel,
  eventStatusBadgeClass,
  isAcceptingEntries,
} from "./eventStatusCore.ts";

const T0 = 1700000000;

test("computeEventStatus: is_archived=1 → archived", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 1, start_time: null, end_time: null },
      T0,
    ),
    "archived",
  );
});

test("computeEventStatus: is_active=0 → draft", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 0, is_archived: 0, start_time: null, end_time: null },
      T0,
    ),
    "draft",
  );
});

test("computeEventStatus: end_time が過ぎていれば ended", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: T0 - 1000, end_time: T0 - 100 },
      T0,
    ),
    "ended",
  );
});

test("computeEventStatus: start_time が未来なら scheduled", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: T0 + 1000, end_time: null },
      T0,
    ),
    "scheduled",
  );
});

test("computeEventStatus: 開催中 → active", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: T0 - 100, end_time: T0 + 100 },
      T0,
    ),
    "active",
  );
});

test("computeEventStatus: 時刻なしの公開状態は published", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: null, end_time: null },
      T0,
    ),
    "published",
  );
});

test("eventStatusLabel: 各状態が日本語ラベル", () => {
  assert.equal(eventStatusLabel("draft"), "下書き");
  assert.equal(eventStatusLabel("published"), "公開");
  assert.equal(eventStatusLabel("scheduled"), "開始前");
  assert.equal(eventStatusLabel("active"), "開催中");
  assert.equal(eventStatusLabel("ended"), "終了済");
  assert.equal(eventStatusLabel("archived"), "アーカイブ");
});

test("eventStatusBadgeClass: 主要マッピング", () => {
  assert.equal(eventStatusBadgeClass("active"), "fn-badge-accent");
  assert.equal(eventStatusBadgeClass("scheduled"), "fn-badge-warning");
  assert.equal(eventStatusBadgeClass("ended"), "fn-badge-neutral");
  assert.equal(eventStatusBadgeClass("draft"), "fn-badge-soft");
});

test("isAcceptingEntries: is_entry_open=0 なら false", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 0,
        start_time: T0 - 100,
        end_time: T0 + 100,
      },
      T0,
    ),
    false,
  );
});

test("isAcceptingEntries: published + is_entry_open=1 で true", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: null,
        end_time: null,
      },
      T0,
    ),
    true,
  );
});

test("isAcceptingEntries: ended は false", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: T0 - 1000,
        end_time: T0 - 100,
      },
      T0,
    ),
    false,
  );
});

test("isAcceptingEntries: entry_start_time 前は false", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: T0,
        end_time: T0 + 10000,
        entry_start_time: T0 + 500,
      },
      T0,
    ),
    false,
  );
});

test("isAcceptingEntries: entry_end_time 後は false", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: T0 - 10000,
        end_time: T0 + 10000,
        entry_end_time: T0 - 100,
      },
      T0,
    ),
    false,
  );
});

test("isAcceptingEntries: entry 期間内は true", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: T0 - 100,
        end_time: T0 + 100,
        entry_start_time: T0 - 50,
        entry_end_time: T0 + 50,
      },
      T0,
    ),
    true,
  );
});
