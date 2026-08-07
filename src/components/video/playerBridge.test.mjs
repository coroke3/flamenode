import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_ENDED,
  PLAYER_TIME,
  YOUTUBE_PLAYER_IFRAME_ID,
  buildYoutubePlayerCommand,
  getYoutubePlayerListeningId,
  parseYoutubePlayerMessage,
  publishPlayerEnded,
  publishPlayerTime,
  requestYoutubeCurrentTime,
  seekYoutubeIframe,
  startYoutubePlayerListening,
} from "../../components/video/playerBridge.ts";

test("buildYoutubePlayerCommand: seekTo 命令を JSON 化する", () => {
  assert.equal(
    buildYoutubePlayerCommand("seekTo", [42, true]),
    JSON.stringify({ event: "command", func: "seekTo", args: [42, true] }),
  );
});

test("seekYoutubeIframe: iframe へ seekTo を postMessage する", () => {
  const messages = [];
  const iframe = {
    contentWindow: {
      postMessage(data, targetOrigin) {
        messages.push({ data, targetOrigin });
      },
    },
  };

  seekYoutubeIframe(iframe, 90.7);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].targetOrigin, "https://www.youtube.com");
  assert.deepEqual(JSON.parse(messages[0].data), {
    event: "command",
    func: "seekTo",
    args: [90, true],
  });
});

test("requestYoutubeCurrentTime: iframe へ getCurrentTime を postMessage する", () => {
  const messages = [];
  const iframe = {
    contentWindow: {
      postMessage(data, targetOrigin) {
        messages.push({ data, targetOrigin });
      },
    },
  };

  requestYoutubeCurrentTime(iframe);

  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0].data), {
    event: "command",
    func: "getCurrentTime",
    args: [],
  });
});

test("getYoutubePlayerListeningId: iframe.id を優先し、なければ既定 id を返す", () => {
  assert.equal(
    getYoutubePlayerListeningId({ id: "custom-player" }),
    "custom-player",
  );
  assert.equal(getYoutubePlayerListeningId({ id: "" }), YOUTUBE_PLAYER_IFRAME_ID);
  assert.equal(
    getYoutubePlayerListeningId({ id: undefined }),
    YOUTUBE_PLAYER_IFRAME_ID,
  );
});

test("startYoutubePlayerListening: listening と onStateChange 購読を送る", () => {
  const messages = [];
  const iframe = {
    id: "custom-player",
    contentWindow: {
      postMessage(data, targetOrigin) {
        messages.push({ data, targetOrigin });
      },
    },
  };

  startYoutubePlayerListening(iframe);

  assert.equal(messages.length, 2);
  assert.deepEqual(JSON.parse(messages[0].data), {
    event: "listening",
    id: "custom-player",
    channel: "widget",
  });
  assert.deepEqual(JSON.parse(messages[1].data), {
    event: "command",
    func: "addEventListener",
    args: ["onStateChange"],
  });
});

test("startYoutubePlayerListening: iframe.id がなければ既定 id を使う", () => {
  const messages = [];
  const iframe = {
    contentWindow: {
      postMessage(data, targetOrigin) {
        messages.push({ data, targetOrigin });
      },
    },
  };

  startYoutubePlayerListening(iframe);

  assert.equal(messages.length, 2);
  assert.deepEqual(JSON.parse(messages[0].data), {
    event: "listening",
    id: YOUTUBE_PLAYER_IFRAME_ID,
    channel: "widget",
  });
});

test("parseYoutubePlayerMessage: infoDelivery から currentTime を読む", () => {
  assert.deepEqual(
    parseYoutubePlayerMessage({
      event: "infoDelivery",
      info: { currentTime: 12.5 },
    }),
    { kind: "time", currentTime: 12.5 },
  );
  assert.deepEqual(parseYoutubePlayerMessage({ event: "onReady" }), {
    kind: "ready",
  });
  assert.equal(parseYoutubePlayerMessage("not-json"), null);
});

test("parseYoutubePlayerMessage: state 0 を ended として扱う", () => {
  assert.deepEqual(
    parseYoutubePlayerMessage({
      event: "onStateChange",
      info: 0,
    }),
    { kind: "ended" },
  );
  assert.deepEqual(
    parseYoutubePlayerMessage({
      event: "infoDelivery",
      info: { playerState: 0 },
    }),
    { kind: "ended" },
  );
  assert.deepEqual(
    parseYoutubePlayerMessage(
      JSON.stringify({
        event: "infoDelivery",
        info: { currentTime: 99, playerState: 0 },
      }),
    ),
    { kind: "state", playerState: 0, currentTime: 99 },
  );
});

test("parseYoutubePlayerMessage: state 1 は ended ではない", () => {
  assert.deepEqual(
    parseYoutubePlayerMessage({
      event: "onStateChange",
      info: 1,
    }),
    { kind: "state", playerState: 1 },
  );
  assert.deepEqual(
    parseYoutubePlayerMessage({
      event: "infoDelivery",
      info: { currentTime: 3, playerState: 1 },
    }),
    { kind: "state", playerState: 1, currentTime: 3 },
  );
});

test("parseYoutubePlayerMessage: malformed message は null", () => {
  assert.equal(parseYoutubePlayerMessage(null), null);
  assert.equal(parseYoutubePlayerMessage(42), null);
  assert.equal(parseYoutubePlayerMessage("{"), null);
  assert.equal(parseYoutubePlayerMessage({ event: "infoDelivery" }), null);
});

test("publishPlayerTime: PLAYER_TIME イベントを配信する", () => {
  const events = [];

  globalThis.window = {
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  publishPlayerTime(42.8);

  assert.equal(PLAYER_TIME, "flamenode:player-time");
  assert.deepEqual(events[0], {
    type: PLAYER_TIME,
    detail: { time: 42.8 },
  });
});

test("publishPlayerEnded: PLAYER_ENDED イベントを配信する", () => {
  const events = [];

  globalThis.window = {
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  publishPlayerEnded({ youtubeId: "abc123" });

  assert.equal(PLAYER_ENDED, "flamenode:video-ended");
  assert.deepEqual(events[0], {
    type: PLAYER_ENDED,
    detail: { youtubeId: "abc123" },
  });
});
