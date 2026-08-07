import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReleaseGroupDecisions } from "./userSlotCore.ts";

const row = (id, group = "group-1") => ({
  id,
  reservation_group_id: group,
});

test("単枠解放は対象だけをavailable向けにgroup解除する", () => {
  assert.deepEqual(buildReleaseGroupDecisions([row("a", null)], "a"), [
    { id: "a", release: true, reservation_group_id: null },
  ]);
});

test("2枠groupのedge解放は残りも単枠へ戻す", () => {
  assert.deepEqual(buildReleaseGroupDecisions([row("a"), row("b")], "a"), [
    { id: "a", release: true, reservation_group_id: null },
    { id: "b", release: false, reservation_group_id: null },
  ]);
});

test("3枠groupのedge解放は残り2枠のgroupを維持する", () => {
  assert.deepEqual(
    buildReleaseGroupDecisions([row("a"), row("b"), row("c")], "a"),
    [
      { id: "a", release: true, reservation_group_id: null },
      { id: "b", release: false, reservation_group_id: "group-1" },
      { id: "c", release: false, reservation_group_id: "group-1" },
    ],
  );
});

test("3枠groupの中央解放は左右をそれぞれ単枠へ戻す", () => {
  assert.deepEqual(
    buildReleaseGroupDecisions([row("a"), row("b"), row("c")], "b"),
    [
      { id: "a", release: false, reservation_group_id: null },
      { id: "b", release: true, reservation_group_id: null },
      { id: "c", release: false, reservation_group_id: null },
    ],
  );
});

const groupRows = (count) =>
  Array.from({ length: count }, (_, index) =>
    row(String.fromCharCode(97 + index)),
  );

test("5枠groupのedge解放は残り4枠のgroupを維持する", () => {
  const rows = groupRows(5);
  const result = buildReleaseGroupDecisions(rows, "a");
  assert.equal(result[0].release, true);
  assert.equal(result[0].reservation_group_id, null);
  for (const decision of result.slice(1)) {
    assert.equal(decision.release, false);
    assert.equal(decision.reservation_group_id, "group-1");
  }
});

test("5枠groupの中央解放は左2枠維持・右2枠はnewGroupId", () => {
  const rows = groupRows(5);
  const result = buildReleaseGroupDecisions(rows, "c", {
    newGroupId: "group-2",
  });
  assert.deepEqual(result, [
    { id: "a", release: false, reservation_group_id: "group-1" },
    { id: "b", release: false, reservation_group_id: "group-1" },
    { id: "c", release: true, reservation_group_id: null },
    { id: "d", release: false, reservation_group_id: "group-2" },
    { id: "e", release: false, reservation_group_id: "group-2" },
  ]);
});

test("5枠groupの中央解放でnewGroupIdが無いと拒否する", () => {
  const rows = groupRows(5);
  assert.throws(
    () => buildReleaseGroupDecisions(rows, "c"),
    /missing_new_group_id/,
  );
});

test("10枠groupのedge解放は残り9枠のgroupを維持する", () => {
  const rows = groupRows(10);
  const result = buildReleaseGroupDecisions(rows, "a");
  assert.equal(result.length, 10);
  assert.equal(result[0].release, true);
  for (const decision of result.slice(1)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }
});

test("10枠groupの中央解放は左右それぞれ5枠に分割する", () => {
  const rows = groupRows(10);
  const result = buildReleaseGroupDecisions(rows, "e", {
    newGroupId: "group-right",
  });
  assert.equal(result.length, 10);
  assert.equal(result[4].release, true);
  for (const decision of result.slice(0, 4)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }
  for (const decision of result.slice(5)) {
    assert.equal(decision.reservation_group_id, "group-right");
  }
});

test("20枠groupのedge解放は残り19枠のgroupを維持する", () => {
  const rows = groupRows(20);
  const result = buildReleaseGroupDecisions(rows, "a");
  assert.equal(result.length, 20);
  assert.equal(result[0].release, true);
  for (const decision of result.slice(1)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }
});

test("20枠groupの中央解放は左右それぞれ10枠に分割する", () => {
  const rows = groupRows(20);
  const result = buildReleaseGroupDecisions(rows, "j", {
    newGroupId: "group-right",
  });
  assert.equal(result.length, 20);
  assert.equal(result[9].release, true);
  for (const decision of result.slice(0, 9)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }
  for (const decision of result.slice(10)) {
    assert.equal(decision.reservation_group_id, "group-right");
  }
});

test("21枠以上はinvalid_release_group_size", () => {
  const rows = groupRows(21);
  assert.throws(
    () => buildReleaseGroupDecisions(rows, "a"),
    /invalid_release_group_size/,
  );
});
