import assert from "node:assert/strict";
import test from "node:test";
import {
  VIEW_COOLDOWN_MS,
  VIEW_THRESHOLD_SECONDS,
  canSendByStorage,
  createVideoViewTrackerState,
  getViewStorageKey,
  markSent,
  onPlayerTimeTick,
} from "./videoViewTrackerCore.ts";

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    storage: {
      getItem(key) {
        return Object.hasOwn(data, key) ? data[key] : null;
      },
      setItem(key, value) {
        data[key] = value;
      },
    },
  };
}

function tick(state, seconds, options = {}) {
  const { storage } = createMemoryStorage();
  return onPlayerTimeTick(state, {
    seconds,
    nowMs: options.nowMs ?? 1_700_000_000_000,
    visibilityState: options.visibilityState ?? "visible",
    videoId: options.videoId ?? state.videoId,
    storage: options.storage ?? storage,
  });
}

function watchVisible(state, fromSeconds, toSeconds, step = 1) {
  let current = state;
  for (let seconds = fromSeconds; seconds <= toSeconds; seconds += step) {
    const result = tick(current, seconds);
    current = result.state;
  }
  return current;
}

test("VIEW_THRESHOLD_SECONDS は 10 秒", () => {
  assert.equal(VIEW_THRESHOLD_SECONDS, 10);
});

test("VIEW_COOLDOWN_MS は 6 時間", () => {
  assert.equal(VIEW_COOLDOWN_MS, 6 * 60 * 60 * 1000);
});

test("getViewStorageKey は fn:ga-view:<video_id> 形式", () => {
  assert.equal(getViewStorageKey("vid-1"), "fn:ga-view:vid-1");
});

test("累積 10 秒で 1 回だけ発火候補になる", () => {
  let state = createVideoViewTrackerState("v1");
  let shouldSend = false;

  for (let seconds = 0; seconds <= 10; seconds += 1) {
    const result = tick(state, seconds);
    state = result.state;
    if (result.shouldSend) {
      shouldSend = true;
    }
  }

  assert.equal(shouldSend, true);
  assert.equal(state.accumulatedSeconds, 10);

  const afterThreshold = tick(state, 11);
  assert.equal(afterThreshold.shouldSend, false);
  assert.equal(afterThreshold.state.thresholdEvaluated, true);
});

test("delta は visible かつ 0.1〜1.5 秒のみ加算する", () => {
  let state = createVideoViewTrackerState("v1");

  const first = tick(state, 0);
  state = first.state;

  const tiny = tick(state, 0.05);
  assert.equal(tiny.state.accumulatedSeconds, 0);

  const valid = tick(tiny.state, 1.05);
  assert.equal(valid.state.accumulatedSeconds, 1);

  const largeJump = tick(valid.state, 5);
  assert.equal(largeJump.state.accumulatedSeconds, 1);

  const validAgain = tick(largeJump.state, 6);
  assert.equal(validAgain.state.accumulatedSeconds, 2);
});

test("非表示時は prev time をリセットし、delta を加算しない", () => {
  let state = createVideoViewTrackerState("v1");
  state = tick(state, 0).state;
  state = tick(state, 1).state;
  assert.equal(state.accumulatedSeconds, 1);

  const hidden = tick(state, 2, { visibilityState: "hidden" });
  assert.equal(hidden.state.prevSeconds, null);
  assert.equal(hidden.state.accumulatedSeconds, 1);

  const visibleAgain = tick(hidden.state, 3);
  assert.equal(visibleAgain.state.prevSeconds, 3);
  assert.equal(visibleAgain.state.accumulatedSeconds, 1);

  const resumed = tick(visibleAgain.state, 4);
  assert.equal(resumed.state.accumulatedSeconds, 2);
});

test("video_id 変更で状態がリセットされる", () => {
  let state = watchVisible(createVideoViewTrackerState("v1"), 0, 8);
  assert.equal(state.accumulatedSeconds, 8);

  const switched = tick(state, 9, { videoId: "v2" });
  assert.equal(switched.state.videoId, "v2");
  assert.equal(switched.state.accumulatedSeconds, 0);
  assert.equal(switched.state.prevSeconds, 9);
  assert.equal(switched.state.thresholdEvaluated, false);
});

test("canSendByStorage は cooldown 中は false", () => {
  const nowMs = 1_700_000_000_000;
  const { storage } = createMemoryStorage({
    [getViewStorageKey("v1")]: String(nowMs + 1_000),
  });

  assert.equal(canSendByStorage("v1", nowMs, storage), false);
  assert.equal(canSendByStorage("v1", nowMs + 1_000, storage), true);
});

test("markSent は cooldown 期限を localStorage に書き込む", () => {
  const nowMs = 1_700_000_000_000;
  const { storage, data } = createMemoryStorage();
  const state = createVideoViewTrackerState("v1");

  const next = markSent(state, nowMs, storage);
  assert.equal(next.sentInMount, true);
  assert.equal(data[getViewStorageKey("v1")], String(nowMs + VIEW_COOLDOWN_MS));
});

test("localStorage 例外でもクラッシュしない", () => {
  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(canSendByStorage("v1", 1, throwingStorage), true);
  assert.doesNotThrow(() => {
    markSent(createVideoViewTrackerState("v1"), 1, throwingStorage);
  });
});

test("同一マウント内は 1 回まで送信候補にできる", () => {
  let state = createVideoViewTrackerState("v1");
  let sendCount = 0;

  for (let seconds = 0; seconds <= 20; seconds += 1) {
    const result = tick(state, seconds);
    state = result.state;
    if (result.shouldSend) sendCount += 1;
    if (result.shouldSend) {
      state = markSent(state, 1_700_000_000_000, createMemoryStorage().storage);
    }
  }

  assert.equal(sendCount, 1);
  assert.equal(state.sentInMount, true);
});

test("cooldown 中は累積 10 秒到達しても shouldSend は false", () => {
  const nowMs = 1_700_000_000_000;
  const { storage } = createMemoryStorage({
    [getViewStorageKey("v1")]: String(nowMs + VIEW_COOLDOWN_MS),
  });

  let state = createVideoViewTrackerState("v1");
  let shouldSend = false;

  for (let seconds = 0; seconds <= 10; seconds += 1) {
    const result = tick(state, seconds, { nowMs, storage });
    state = result.state;
    if (result.shouldSend) shouldSend = true;
  }

  assert.equal(shouldSend, false);
  assert.equal(state.thresholdEvaluated, true);
});

test("markSent 後は追加 tick でも shouldSend にならない", () => {
  let state = watchVisible(createVideoViewTrackerState("v1"), 0, 10);
  const { storage } = createMemoryStorage();
  state = markSent(state, 1_700_000_000_000, storage);

  const after = tick(state, 20);
  assert.equal(after.shouldSend, false);
});
