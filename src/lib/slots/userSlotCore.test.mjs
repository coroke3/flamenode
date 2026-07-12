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
