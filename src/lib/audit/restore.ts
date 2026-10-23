// Compatibility bridge (MIG-0616, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import { invalidateEventExportCache } from "@/lib/api/eventExportCache";
import type { DB } from "@/lib/db/client";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import { nextVisibilityManifestHost } from "@/lib/publicData/visibilityManifestHost";
import { nextVideoPublicCacheKeyHost } from "@/lib/video/videoVisibilityTransition";
import {
  restoreAuditLog as restoreAuditLogCore,
  type AuditRestoreHost,
} from "@flamenode/server-core/audit/restore";
import type { RestoreOptions, RestoreResult } from "./types";

/** Same lazy loader as ./mutate: nextPorts is not evaluated until a Queue wake is due after commit. */
const auditRestoreHost: AuditRestoreHost = {
  manifest: nextVisibilityManifestHost,
  publicCacheKeys: nextVideoPublicCacheKeyHost,
  deletePublicJsonCaches,
  invalidateEventExportCache,
  loadQueueWakeHost: async () => (await import("@/lib/serverCore/nextPorts")).nextQueueWakeHost,
};

export function restoreAuditLog(db: DB, options: RestoreOptions): Promise<RestoreResult> {
  return restoreAuditLogCore(db, options, auditRestoreHost);
}
