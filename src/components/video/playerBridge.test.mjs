import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildYoutubePlayerCommand,
  seekYoutubeIframe,
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
