import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeResolvedPermissionIntents } from "../src/video/permissionCanonicalize.ts";
import { prepareCollaboratorPermissionIntents } from "@flamenode/domain/video";

const intent = (x_user_id, value = "on") => ({
  x_user_id, display_name: x_user_id, intent: value,
});

test("SA-084 canonical X ID resolution rewrites aliases while retaining the input order", () => {
  const output = canonicalizeResolvedPermissionIntents(
    [intent("@ALIAS"), intent("bob", "off")],
    new Map([
      ["alias", { reason: "resolved_alias", value: "alice" }],
      ["bob", { reason: "resolved_canonical", value: "bob" }],
    ]),
  );
  assert.deepEqual(output.map(v => [v.x_user_id, v.intent]), [
    ["alice", "on"], ["bob", "off"],
  ]);
});

test("SA-084 unresolved unknown ID preserves pending-creation behavior", () => {
  const input = [intent(" @new_user ")];
  const result = canonicalizeResolvedPermissionIntents(input, new Map([
    ["new_user", { reason: "not_found", value: null }],
  ]));
  assert.equal(result[0].x_user_id, "new_user");
  assert.equal(input[0].x_user_id, " @new_user ");
});

test("SA-084 rejected direct ID, malformed and ambiguous aliases fail closed", () => {
  for (const reason of [
    "rejected_or_invalid", "invalid_alias_target",
    "ambiguous_alias", "canonical_alias_collision",
  ]) {
    assert.throws(
      () => canonicalizeResolvedPermissionIntents(
        [intent("alice")],
        new Map([["alice", { value: null, reason }]]),
      ),
      /video_permission_x_user_resolution_invalid:alice/,
      reason,
    );
  }
});

test("SA-084 aliases colliding with canonical IDs are rejected downstream, never silently overwritten", () => {
  const resolved = canonicalizeResolvedPermissionIntents(
    [intent("alias"), intent("alice", "off")],
    new Map([
      ["alias", { reason: "resolved_alias", value: "alice" }],
      ["alice", { reason: "resolved_canonical", value: "alice" }],
    ]),
  );
  const prepared = prepareCollaboratorPermissionIntents(resolved);
  assert.equal(prepared.ok, false);
  if (!prepared.ok) assert.match(prepared.message, /同じ X ID の権限指定が重複しています/);
});

test("SA-084 empty input and unresolved empty X ID remain caller-validation concerns", () => {
  assert.deepEqual(canonicalizeResolvedPermissionIntents([], new Map()), []);
  const result = canonicalizeResolvedPermissionIntents([intent(" @ ")], new Map());
  assert.equal(result[0].x_user_id, "");
  const prepared = prepareCollaboratorPermissionIntents(result);
  assert.equal(prepared.ok, false);
});
