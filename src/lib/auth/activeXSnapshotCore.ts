import { normalizeXId } from "../utils/xid.ts";

const ACTIVE_X_SNAPSHOT_MISMATCH_MESSAGE =
  "投稿画面を開いた後にActive X IDが変更されました。最新の活動名義を確認してからもう一度投稿してください。";

export function validateActiveXSnapshot(input: {
  submittedSnapshot: string | null | undefined;
  currentActiveXId: string | null | undefined;
}): { ok: true } | { ok: false; message: string } {
  const submitted = normalizeXId(input.submittedSnapshot);
  const current = normalizeXId(input.currentActiveXId);

  if (!submitted || !current || submitted !== current) {
    return { ok: false, message: ACTIVE_X_SNAPSHOT_MISMATCH_MESSAGE };
  }

  return { ok: true };
}
