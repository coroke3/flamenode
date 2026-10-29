// Compatibility bridge (MIG-0659 U01): retain CURRENT Server Action imports.
// The atomic SQL implementation is shared with Hono through server-core.
export {
  buildPendingXIdRequestInsert,
  buildPendingXIdMergeRevertInsert,
  type PendingXIdRequestRow,
} from "@flamenode/server-core";
