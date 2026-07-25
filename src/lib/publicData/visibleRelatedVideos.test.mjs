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

test("blockedなrandom枠はrandom_reserveで置換する", () => {
  const selected = resolveVisibleRelatedVideos({
    primary: [base("a"), base("r1"), base("b")],
    randomIds: ["r1"],
    reserve: [],
    randomReserve: [base("rr1")],
    blockedIds: new Set(["r1"]),
    currentVideoId: "self",
    seed: "seed",
    minTarget: 2,
    maxTarget: 30,
  });
  assert.deepEqual(
    selected.map((item) => item.id),
    ["a", "rr1", "b"],
  );
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
