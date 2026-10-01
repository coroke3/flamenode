"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { publicVisibilityFences } from "@/lib/db/schema";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  releaseBlockedEntityInManifest,
  type PublicVisibilityFenceEntityType,
} from "@/lib/publicData/publicVisibilityManifestCore";
import { normalizeXId } from "@/lib/utils/xid";

const ENTITY_TYPES = new Set<PublicVisibilityFenceEntityType>([
  "video",
  "event",
  "x_user",
  "event_group",
]);

function redirectWithResult(result: string): never {
  const query = new URLSearchParams({ visibility_repair: result });
  redirect(`/admin/static-builds?${query.toString()}`);
}

function parseRepairTarget(formData: FormData): {
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  fenceToken: string;
} | null {
  const entityType = String(formData.get("entity_type") ?? "");
  const rawEntityId = String(formData.get("entity_id") ?? "").trim();
  const fenceToken = String(formData.get("fence_token") ?? "").trim();
  if (!ENTITY_TYPES.has(entityType as PublicVisibilityFenceEntityType)) return null;
  const entityId = entityType === "x_user"
    ? normalizeXId(rawEntityId)
    : rawEntityId;
  if (!entityId || entityId.length > 128 || !fenceToken || fenceToken.length > 160) {
    return null;
  }
  return {
    entityType: entityType as PublicVisibilityFenceEntityType,
    entityId,
    fenceToken,
  };
}

/**
 * Admin-only remediation for an R2 visibility block which has outlived its
 * D1 fence. It removes only the exact stale token; a current D1 fence or an
 * R2 CAS/token conflict is left untouched and must be investigated instead.
 */
export async function repairDanglingPublicVisibilityManifestEntry(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild");
  if (!guard.ok) redirectWithResult("forbidden");

  const target = parseRepairTarget(formData);
  if (!target) redirectWithResult("invalid_input");

  let result: string;
  try {
    const currentFence = (
      await guard.db
        .select({
          fence_token: publicVisibilityFences.fence_token,
          state: publicVisibilityFences.state,
        })
        .from(publicVisibilityFences)
        .where(
          and(
            eq(publicVisibilityFences.entity_type, target.entityType),
            eq(publicVisibilityFences.entity_id, target.entityId),
          )!,
        )
        .limit(1)
    )[0];
    // Never use this repair action to release a live D1 fence. A `released`
    // row is historical bookkeeping, however, and is precisely the state in
    // which a failed R2 release leaves a repairable manifest-only block. It
    // is safe only when it still has the exact token submitted by the admin.
    if (
      currentFence &&
      (
        currentFence.state !== "released" ||
        currentFence.fence_token !== target.fenceToken
      )
    ) {
      result = "d1_fence_present";
    } else {
      const { manifest, etag } =
        await readPublicVisibilityBlockedEntitiesManifest();
      const released = releaseBlockedEntityInManifest(
        manifest,
        target.entityType,
        target.entityId,
        target.fenceToken,
        Math.floor(Date.now() / 1000),
      );
      if (!released) {
        result = "manifest_token_not_found";
      } else {
        await writePublicVisibilityBlockedEntitiesManifest(released, {
          ifMatchEtag: etag,
          mutateOnConflict: (latest) => {
            // A newer R2 transition must win; do not remove an entry after its
            // token changes during this repair attempt.
            const retry = releaseBlockedEntityInManifest(
              latest,
              target.entityType,
              target.entityId,
              target.fenceToken,
              Math.floor(Date.now() / 1000),
            );
            if (!retry) throw new Error("public_visibility_repair_token_conflict");
            return retry;
          },
        });
        console.warn(
          JSON.stringify({
            service: "visibility_fence",
            flow: "admin_visibility_repair",
            result: "released_dangling_manifest_entry",
            entity_type: target.entityType,
            entity_id: target.entityId,
            fence_token: target.fenceToken,
            actor_user_id: guard.user.id,
          }),
        );
        result = "repaired";
      }
    }
  } catch {
    // The form includes a fence token.  Keep failure telemetry structured, but
    // do not accidentally serialize that token or an SDK error payload.
    console.error(
      JSON.stringify({
        service: "visibility_fence",
        flow: "admin_visibility_repair",
        result: "failed",
        entity_type: target.entityType,
        entity_id: target.entityId,
        error_code: "public_visibility_repair_failed",
      }),
    );
    result = "failed";
  }
  if (result === "repaired") revalidatePath("/admin/static-builds");
  redirectWithResult(result);
}
