import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisibleRelatedVideos } from "./visibleRelatedVideos.ts";

const base = (id) => ({
  id,
  title: id,
  youtube_video_id: null,
  display_name: "creator",
  icon_url: null,
  primary_event_id: null,
  scheduled_time: null,
});

test("blockedな第1random枠だけをrandom_reserveで置換する", () => {
  const semantic = Array.from({ length: 24 }, (_, index) =>
    base(`s${index}`),
  );
  const selected = resolveVisibleRelatedVideos({
    primary: [
      ...semantic.slice(0, 7),
      base("r1"),
      ...semantic.slice(7, 20),
      base("r2"),
      ...semantic.slice(20),
    ],
    randomIds: ["r1", "r2"],
    reserve: [],
    randomReserve: [base("rr1")],
    blockedIds: new Set(["r1"]),
    currentVideoId: "self",
    seed: "seed",
    minTarget: 15,
    maxTarget: 30,
  });

  assert.equal(selected[7]?.id, "rr1");
  assert.equal(selected[21]?.id, "r2");
  assert.deepEqual(
    selected.filter((item) => item.id.startsWith("s")).map((item) => item.id),
    semantic.map((item) => item.id),
  );
});

test("blocklist対象は全補完経路から除外する", () => {
  const blockedIds = new Set([
    "random-blocked",
    "primary-blocked",
    "random-reserve-blocked",
    "reserve-blocked",
    "fallback-blocked",
  ]);
  const selected = resolveVisibleRelatedVideos({
    primary: [
      base("semantic"),
      base("random-blocked"),
      base("primary-blocked"),
    ],
    randomIds: ["random-blocked"],
    reserve: [base("reserve-blocked"), base("reserve")],
    randomReserve: [
      base("random-reserve-blocked"),
      base("random-repair"),
    ],
    fallbackPool: [
      base("fallback-blocked"),
      base("fallback-1"),
      base("fallback-2"),
    ],
    blockedIds,
    currentVideoId: "self",
    seed: "seed",
    minTarget: 5,
    maxTarget: 10,
  });

  assert.equal(selected.length, 5);
  assert.ok(selected.every((item) => !blockedIds.has(item.id)));
  assert.ok(selected.some((item) => item.id === "random-repair"));
});

test("random_reserveとfallbackPoolの同一IDを別枠へ重複採用しない", () => {
  const selected = resolveVisibleRelatedVideos({
    primary: [
      ...Array.from({ length: 24 }, (_, index) => base(`s${index}`)),
      base("r1"),
      base("r2"),
    ],
    randomIds: ["r1", "r2"],
    reserve: [],
    randomReserve: [base("repair")],
    fallbackPool: [base("repair"), base("fallback-repair")],
    blockedIds: new Set(["r1", "r2"]),
    currentVideoId: "self",
    seed: "seed",
    minTarget: 15,
    maxTarget: 30,
  });

  assert.equal(selected[7]?.id, "repair");
  assert.equal(selected[21]?.id, "fallback-repair");
  assert.equal(selected.filter((item) => item.id === "repair").length, 1);
  assert.equal(new Set(selected.map((item) => item.id)).size, selected.length);
});

test("同一seedでは順序が安定する", () => {
  const args = {
    primary: [base("a"), base("b"), base("c")],
    randomIds: [],
    reserve: [],
    randomReserve: [],
    fallbackPool: [base("f2"), base("f1"), base("f3")],
    blockedIds: new Set(),
    currentVideoId: "self",
    seed: "gen:video",
    minTarget: 5,
    maxTarget: 30,
  };
  assert.deepEqual(
    resolveVisibleRelatedVideos(args).map((item) => item.id),
    resolveVisibleRelatedVideos(args).map((item) => item.id),
  );
});
