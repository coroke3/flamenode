import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRevertDeadlineOpen,
  toPublicXIdentityRequestDto,
  validateXIdentityRequestShape,
} from "./xIdentityRequestCore.ts";

const complete = {
  id: "req_1",
  request_type: "revert_merge",
  requested_by_auth_user_id: "auth-secret",
  requested_x_id: null,
  source_x_user_id: null,
  target_x_user_id: null,
  parent_request_id: "merge_1",
  restore_snapshot_json: '{"private":true}',
  revert_deadline_at: 200,
  status: "pending",
  requested_at: 100,
  updated_at: 100,
};

test("request_typeごとの必須項目を検証する", () => {
  assert.match(
    validateXIdentityRequestShape({ requestType: "new_link" }),
    /requested_x_id/,
  );
  assert.match(
    validateXIdentityRequestShape({
      requestType: "alias",
      requestedXId: "alias_id",
    }),
    /target_x_user_id/,
  );
  assert.match(
    validateXIdentityRequestShape({
      requestType: "merge",
      sourceXUserId: "same",
      targetXUserId: "same",
    }),
    /別の X ID/,
  );
  assert.match(
    validateXIdentityRequestShape({
      requestType: "revert_merge",
      parentRequestId: "merge_1",
    }),
    /restore_snapshot_json/,
  );
  assert.equal(
    validateXIdentityRequestShape({
      requestType: "revert_merge",
      parentRequestId: "merge_1",
      restoreSnapshotJson: "{}",
      revertDeadlineAt: 200,
    }),
    null,
  );
});

test("統合差し戻し期限を境界値込みで検証する", () => {
  assert.equal(isRevertDeadlineOpen(200, 200), true);
  assert.equal(isRevertDeadlineOpen(199, 200), false);
  assert.equal(isRevertDeadlineOpen(null, 200), false);
});

test("公開DTOは内部申請情報を含めない", () => {
  const dto = toPublicXIdentityRequestDto(complete);
  assert.equal("requested_by_auth_user_id" in dto, false);
  assert.equal("parent_request_id" in dto, false);
  assert.equal("restore_snapshot_json" in dto, false);
  assert.equal("revert_deadline_at" in dto, false);
  assert.deepEqual(dto, {
    id: "req_1",
    request_type: "revert_merge",
    requested_x_id: null,
    source_x_user_id: null,
    target_x_user_id: null,
    status: "pending",
    requested_at: 100,
    updated_at: 100,
  });
});
