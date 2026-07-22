export const X_ID_LINK_REQUEST_TYPES = ["new_link", "existing_link"] as const;
export const X_ID_PENDING_REQUEST_LIMIT = 5;

export type XIdLinkRequestType = (typeof X_ID_LINK_REQUEST_TYPES)[number];
export type XIdRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "done"
  | "cancelled";

export function isXIdLinkRequestType(value: string): value is XIdLinkRequestType {
  return value === "new_link" || value === "existing_link";
}

function errorChainSome(
  error: unknown,
  predicate: (value: { code?: unknown; message?: unknown; name?: unknown }) => boolean,
): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current !== "object") break;
    const value = current as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      cause?: unknown;
    };
    if (predicate(value)) return true;
    current = value.cause;
  }
  return false;
}

/**
 * D1 batchのCAS、並行INSERT、一時障害は、同じrequest ID/条件で一度だけ再計画できる。
 * schema不一致や入力不正は再試行しても直らないため対象にしない。
 */
export function isRetryableXIdMutationError(error: unknown): boolean {
  return errorChainSome(error, ({ code, message }) => {
    const text = typeof message === "string" ? message : "";
    return (
      code === "SQLITE_BUSY" ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      /SQLITE_(?:BUSY|CONSTRAINT)|database is locked|constraint failed|malformed json|D1_ERROR.*(?:internal error|constraint)|fetch failed|UND_ERR_SOCKET|socket hang up|Failed to parse body as JSON.*internal error/i.test(
        text,
      )
    );
  });
}

export type PendingRequestReconciliation =
  | { outcome: "accepted"; requestId: string }
  | { outcome: "limit" }
  | { outcome: "retry" };

/** DBエラー文字列ではなく、失敗後に読み直した正本状態で申請結果を確定する。 */
export function reconcilePendingXIdRequest(input: {
  matchingPendingRequestId: string | null;
  pendingCount: number;
}): PendingRequestReconciliation {
  if (input.matchingPendingRequestId) {
    return { outcome: "accepted", requestId: input.matchingPendingRequestId };
  }
  if (input.pendingCount >= X_ID_PENDING_REQUEST_LIMIT) {
    return { outcome: "limit" };
  }
  return { outcome: "retry" };
}

export function processedXIdRequestMessage(
  status: XIdRequestStatus,
  operation: "approve" | "reject" | "cancel",
): { ok: boolean; message: string } {
  if (operation === "approve" && (status === "approved" || status === "done")) {
    return { ok: true, message: "この申請はすでに承認済みです。" };
  }
  if (operation === "reject" && status === "rejected") {
    return { ok: true, message: "この申請はすでに却下済みです。" };
  }
  if (operation === "cancel" && status === "cancelled") {
    return { ok: true, message: "この申請はすでに取り下げ済みです。" };
  }

  const labels: Record<XIdRequestStatus, string> = {
    pending: "申請中",
    approved: "承認済み",
    rejected: "却下済み",
    done: "完了",
    cancelled: "取消済み",
  };
  return {
    ok: false,
    message: `この申請はすでに${labels[status]}のため処理できません。`,
  };
}
