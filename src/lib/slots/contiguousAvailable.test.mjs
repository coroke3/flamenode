import assert from "node:assert/strict";
import { test } from "node:test";
import { countContiguousAvailableForward } from "./contiguousAvailable.ts";

const GAP = 15 * 60;

const slot = (id, status, start_time, sort_order = 0) => ({
  id,
  status,
  start_time,
  sort_order,
});

test("anchorがavailableでない場合は0", () => {
  const slots = [
    slot("s1", "reserved", 100, 0),
    slot("s2", "available", 200, 1),
  ];
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 10,
      gapSec: GAP,
    }),
    0,
  );
});

test("anchorのみavailableなら1", () => {
  const slots = [
    slot("s1", "available", 100, 0),
    slot("s2", "reserved", 200, 1),
  ];
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 10,
      gapSec: GAP,
    }),
    1,
  );
});

test("reservedが4番目で割り込むと3枠まで", () => {
  const slots = [
    slot("s1", "available", 100, 0),
    slot("s2", "available", 200, 1),
    slot("s3", "available", 300, 2),
    slot("s4", "reserved", 400, 3),
    slot("s5", "available", 500, 4),
  ];
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 10,
      gapSec: GAP,
    }),
    3,
  );
});

test("eventMaxで上限を切る", () => {
  const slots = Array.from({ length: 10 }, (_, index) =>
    slot(`s${index + 1}`, "available", 100 + index * 100, index),
  );
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 5,
      gapSec: GAP,
    }),
    5,
  );
});

test("部境界を越えるとそこで止まる", () => {
  const may18LateJst = Math.floor(Date.UTC(2026, 4, 18, 14, 55) / 1000);
  const may19StartJst = Math.floor(Date.UTC(2026, 4, 18, 15, 0) / 1000);
  const slots = [
    slot("s1", "available", may18LateJst, 0),
    slot("s2", "available", may19StartJst, 1),
  ];
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 10,
      gapSec: 30 * 60,
    }),
    1,
  );
});

test("件数枠は連続sort_orderのみカウントする", () => {
  const slots = [
    slot("s1", "available", null, 1),
    slot("s2", "available", null, 2),
    slot("s3", "available", null, 4),
  ];
  assert.equal(
    countContiguousAvailableForward({
      slots,
      anchorId: "s1",
      eventMax: 10,
      gapSec: GAP,
    }),
    2,
  );
});
