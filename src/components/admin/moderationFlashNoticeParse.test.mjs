import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModerationSaveNotice } from "./moderationFlashNoticeParse.ts";

test("valid moderation save notices preserve message and reflection flag", () => {
  assert.deepEqual(parseModerationSaveNotice('{"message":"保存しました"}'), { message: "保存しました" });
  assert.deepEqual(
    parseModerationSaveNotice('{"message":"保存しました","pendingPublicReflection":true}'),
    { message: "保存しました", pendingPublicReflection: true },
  );
});

test("malformed, oversized and non-object storage values never reach React", () => {
  for (const raw of [
    "", "{", "null", "false", "42", '"hello"', '["notice"]',
    " ".repeat(4097), '{"message":null}', '{"message":{}}',
    '{"message":["unexpected"]}', '{"message":"  "}',
    '{"message":"ok","pendingPublicReflection":"true"}',
    '{"message":"ok","pendingPublicReflection":1}',
  ]) {
    assert.equal(parseModerationSaveNotice(raw), null, raw.slice(0, 70));
  }
});

test("an untrusted object cannot inject other React props", () => {
  assert.deepEqual(
    parseModerationSaveNotice('{"message":"ok","pendingPublicReflection":false,"style":{"color":"red"}}'),
    { message: "ok", pendingPublicReflection: false },
  );
});
