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
  getEffectiveEventEnd,
  getEffectiveEventStart,
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

test("isAcceptingEntries: entry 期間未設定なら false", () => {
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

test("isAcceptingEntries: published + entry 期間内なら true", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 0,
        start_time: null,
        end_time: null,
        entry_start_time: T0 - 100,
        entry_end_time: T0 + 100,
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

// --- 点のイベント (start_time のみ / end_time のみ) ---

test("getEffectiveEventEnd: end_time のみなら end_time", () => {
  assert.equal(
    getEffectiveEventEnd({
      is_active: 1,
      is_archived: 0,
      start_time: null,
      end_time: T0 + 100,
    }),
    T0 + 100,
  );
});

test("getEffectiveEventEnd: start_time のみなら start_time", () => {
  assert.equal(
    getEffectiveEventEnd({
      is_active: 1,
      is_archived: 0,
      start_time: T0 + 100,
      end_time: null,
    }),
    T0 + 100,
  );
});

test("getEffectiveEventStart: start_time のみなら start_time", () => {
  assert.equal(
    getEffectiveEventStart({
      is_active: 1,
      is_archived: 0,
      start_time: T0 + 100,
      end_time: null,
    }),
    T0 + 100,
  );
});

test("getEffectiveEventStart: end_time のみなら end_time を開始扱い", () => {
  assert.equal(
    getEffectiveEventStart({
      is_active: 1,
      is_archived: 0,
      start_time: null,
      end_time: T0 + 100,
    }),
    T0 + 100,
  );
});

test("computeEventStatus: start_time のみ・過去なら ended (= 点のイベントが過ぎた)", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: T0 - 100, end_time: null },
      T0,
    ),
    "ended",
  );
});

test("computeEventStatus: end_time のみ・過去なら ended", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: null, end_time: T0 - 100 },
      T0,
    ),
    "ended",
  );
});

test("computeEventStatus: end_time のみ・未来なら scheduled", () => {
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: null, end_time: T0 + 100 },
      T0,
    ),
    "scheduled",
  );
});

test("computeEventStatus: 募集終了と開始が同時刻でも矛盾しない (active)", () => {
  // start_time === entry_end_time === now のケースで status は active のまま、
  // entry は entry_end_time 後判定で false になる。
  assert.equal(
    computeEventStatus(
      { is_active: 1, is_archived: 0, start_time: T0, end_time: T0 + 1000 },
      T0,
    ),
    "active",
  );
});

test("isAcceptingEntries: start_time のみ・過去はもう受付終了", () => {
  assert.equal(
    isAcceptingEntries(
      {
        is_active: 1,
        is_archived: 0,
        is_entry_open: 1,
        start_time: T0 - 100,
        end_time: null,
      },
      T0,
    ),
    false,
  );
});
