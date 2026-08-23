import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    isRetryableXIdMutationError,
    processedXIdRequestMessage,
    reconcilePendingXIdRequest,
  } = await import("./xidRequestReliabilityCore.ts");

  test("一時的なD1/CAS障害はcause chainを含めて1回再試行対象にできる", () => {
    assert.equal(
      isRetryableXIdMutationError(
        new Error("outer", {
          cause: Object.assign(new Error("database is locked"), {
            code: "SQLITE_BUSY",
          }),
        }),
      ),
      true,
    );
    assert.equal(
      isRetryableXIdMutationError(
        new Error("D1_ERROR: constraint failed"),
      ),
      true,
    );
    for (const message of [
      "Network connection lost.",
      "storage caused object to be reset",
      "reset because its code was updated",
    ]) {
      assert.equal(isRetryableXIdMutationError(new Error(message)), true, message);
    }
    assert.equal(
      isRetryableXIdMutationError(new Error("invalid X ID request shape")),
      false,
    );
  });

  test("失敗後は正本のpendingと上限を読み直して結果を決める", () => {
    assert.deepEqual(
      reconcilePendingXIdRequest({
        matchingPendingRequestId: "xreq-existing",
        pendingCount: 5,
      }),
      { outcome: "accepted", requestId: "xreq-existing" },
    );
    assert.deepEqual(
      reconcilePendingXIdRequest({
        matchingPendingRequestId: null,
        pendingCount: 5,
      }),
      { outcome: "limit" },
    );
    assert.deepEqual(
      reconcilePendingXIdRequest({
        matchingPendingRequestId: null,
        pendingCount: 4,
      }),
      { outcome: "retry" },
    );
  });

  test("同じ承認・拒否・取消の再送は成功として収束する", () => {
    assert.equal(processedXIdRequestMessage("approved", "approve").ok, true);
    assert.equal(processedXIdRequestMessage("done", "approve").ok, true);
    assert.equal(processedXIdRequestMessage("rejected", "reject").ok, true);
    assert.equal(processedXIdRequestMessage("cancelled", "cancel").ok, true);
    assert.equal(processedXIdRequestMessage("rejected", "approve").ok, false);
    assert.equal(processedXIdRequestMessage("approved", "cancel").ok, false);
  });
}
