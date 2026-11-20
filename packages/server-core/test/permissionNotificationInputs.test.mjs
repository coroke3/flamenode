import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPermissionGrantNotificationInputs } from "../src/video/permissionNotificationInputs.ts";

const make = (links, eventId = "event-1") => {
  const calls = [];
  const result = buildPermissionGrantNotificationInputs({
    links, actorUserId: "actor", videoId: "v1", videoTitle: "Title",
    eventId, buildPayload: (args) => {
      calls.push(args);
      return { content: "approved " + args.videoTitle, video_id: args.videoId };
    },
  });
  return { result, calls };
};

test("SA-082: grants preserve the CURRENT outbox type, event ID and recipient dedupe key", () => {
  const { result, calls } = make([{ x_user_id: "alice", auth_user_id: "recipient" }]);
  assert.deepEqual(result, [{
    recipientUserId: "recipient",
    dedupeKey: "video_edit_permission_granted:v1:x:alice:user:recipient",
    type: "video_edit_permission_granted",
    payload: { content: "approved Title", video_id: "v1" },
    eventId: "event-1",
  }]);
  assert.deepEqual(calls, [{ videoId: "v1", videoTitle: "Title" }]);
});

test("SA-084: actor/self link excluded, duplicate link suppressed, distinct recipients retained", () => {
  const { result, calls } = make([
    { x_user_id: "alice", auth_user_id: "actor" },
    { x_user_id: "alice", auth_user_id: "u1" },
    { x_user_id: "alice", auth_user_id: "u1" },
    { x_user_id: "bob", auth_user_id: "u2" },
  ]);
  assert.deepEqual(result.map(x => x.recipientUserId), ["u1", "u2"]);
  assert.equal(calls.length, 2);
});

test("SA-084: no recipients creates no payload and null event is passed unchanged", () => {
  const { result, calls } = make([], null);
  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
  const single = make([{ x_user_id: "alice", auth_user_id: "u" }], null);
  assert.equal(single.result[0].eventId, null);
});

test("SA-084: a bad host template fails closed rather than creating incomplete outbox inputs", () => {
  assert.throws(() => buildPermissionGrantNotificationInputs({
    links: [{ x_user_id: "alice", auth_user_id: "recipient" }],
    actorUserId: "actor", videoId: "v1", videoTitle: "Title",
    eventId: null, buildPayload: () => { throw new Error("invalid_site_origin"); },
  }), /invalid_site_origin/);
});
