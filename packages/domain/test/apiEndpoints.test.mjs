import assert from "node:assert/strict";
import test from "node:test";
import {
  validateApiEndpointEventId,
  validateEventForApiActivation,
} from "@flamenode/domain/apiEndpoints";

test("validateApiEndpointEventId accepts valid event IDs and rejects invalid", () => {
  assert.deepEqual(validateApiEndpointEventId("evt-123"), {
    ok: true,
    eventId: "evt-123",
  });
  assert.equal(validateApiEndpointEventId("").ok, false);
  assert.equal(validateApiEndpointEventId(null).ok, false);
  assert.equal(validateApiEndpointEventId("a".repeat(129)).ok, false);
});

test("validateEventForApiActivation rejects missing events", () => {
  const res = validateEventForApiActivation(null, 1);
  assert.equal(res.ok, false);
  assert.equal(res.message, "イベントが見つかりません。");
});

test("validateEventForApiActivation allows disabling on any event", () => {
  const res = validateEventForApiActivation({ visibility_status: "private" }, 0);
  assert.equal(res.ok, true);
});

test("validateEventForApiActivation rejects enabling on non-public event", () => {
  const res = validateEventForApiActivation({ visibility_status: "private" }, 1);
  assert.equal(res.ok, false);
  assert.equal(res.message, "公開イベントだけAPIを有効化できます。");
});

test("validateEventForApiActivation permits enabling on public event", () => {
  const res = validateEventForApiActivation({ visibility_status: "public" }, 1);
  assert.equal(res.ok, true);
});
