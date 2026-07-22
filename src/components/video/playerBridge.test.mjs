import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_TIME,
  buildYoutubePlayerCommand,
  parseYoutubePlayerMessage,
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

test("startYoutubePlayerListening: listening イベントを送る", () => {
  const messages = [];
  const iframe = {
    contentWindow: {
      postMessage(data, targetOrigin) {
        messages.push({ data, targetOrigin });
      },
    },
  };

  startYoutubePlayerListening(iframe);

  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0].data), {
    event: "listening",
    id: 1,
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

test("publishPlayerTime: PLAYER_TIME イベントを配信する", () => {
  const events = [];

  globalThis.window = {
    dispatchEvent(event) {
      events.push(event.detail);
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  publishPlayerTime(42.8);

  assert.equal(PLAYER_TIME, "flamenode:player-time");
  assert.deepEqual(events[0], { time: 42.8 });
});
