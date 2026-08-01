"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";

export interface PermissionAdminResult {
  ok: boolean;
  message?: string;
}

const SETTINGS_ID = "default";
const ALLOWED_VIDEO_FIELDS = new Set([
  "title",
  "display_name",
  "icon_url",
  "music",
  "credit",
  "intro_comment",
  "used_software",
  "highlights",
  "production_story",
  "closing_comment",
  "members",
  "chapters",
]);

const permissionSettingsSelect = {
  id: systemSettings.id,
  default_editable_fields: systemSettings.default_editable_fields,
  upcoming_editable_fields: systemSettings.upcoming_editable_fields,
} as const;

async function revalidatePermissionsAdminPathsBestEffort(): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "admin_permissions", traceId: createTraceId() },
    [
      {
        name: "revalidate_permissions_admin_paths",
        run: async () => {
          revalidatePath("/admin/users");
        },
      },
    ],
  );
}

function cleanFields(values: FormDataEntryValue[]): string {
  return Array.from(
    new Set(
      values
        .map(String)
        .filter((value) => ALLOWED_VIDEO_FIELDS.has(value)),
    ),
  ).join(",");
}

export async function updateGlobalEditableFields(
  formData: FormData,
): Promise<PermissionAdminResult> {
  const guard = await requireAdminWrite("admin_permissions");
  if (!guard.ok) return { ok: false, message: guard.message };
  const { db } = guard;

  const before = (
    await db
      .select(permissionSettingsSelect)
      .from(systemSettings)
      .where(eq(systemSettings.id, SETTINGS_ID))
      .limit(1)
  )[0];
  if (!before) {
    return {
      ok: false,
      message:
        "一般作品権限の設定行が見つかりません。DBマイグレーションの適用状態を確認してください。",
    };
  }

  const patch = {
    default_editable_fields: cleanFields(
      formData.getAll("default_editable_fields"),
    ),
    upcoming_editable_fields: cleanFields(
      formData.getAll("upcoming_editable_fields"),
    ),
  };

  if (
    before.default_editable_fields === patch.default_editable_fields &&
    before.upcoming_editable_fields === patch.upcoming_editable_fields
  ) {
    return { ok: true, message: "一般作品権限に変更はありません。" };
  }

  const permissionCasSnapshot = {
    default_editable_fields: before.default_editable_fields,
    upcoming_editable_fields: before.upcoming_editable_fields,
  };
  const beforeSnapshot = { id: before.id, ...permissionCasSnapshot };
  const afterSnapshot = { ...beforeSnapshot, ...patch };

  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(systemSettings)
          .set(patch)
          .where(
            and(
              eq(systemSettings.id, SETTINGS_ID),
              expectedRowCondition({
                // 一般作品権限が所有する2列だけをCAS対象にする。
                // operation_mode・CostGuard・監査設定など、同じ行の無関係な更新で
                // 保存が失敗しないようにする。
                expectedCurrent: permissionCasSnapshot,
              }),
            )!,
          ),
      ],
      expectedMutationChanges: 1,
      audits: [
        {
          table_name: "system_settings",
          target_id: SETTINGS_ID,
          operation: "UPDATE",
          before: beforeSnapshot,
          after: afterSnapshot,
          actor_user_id: guard.user.id,
          context: "admin_permissions",
          reason: "一般作品権限を更新",
          retention_class: "long_audit",
          strict: true,
        },
      ],
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[permissions-admin] atomic mutation failed", error);
    return {
      ok: false,
      message:
        "一般作品権限の保存に失敗しました。別の管理者による更新がないか確認し、ページを再読み込みして再度お試しください。",
    };
  }

  await revalidatePermissionsAdminPathsBestEffort();
  return { ok: true, message: "一般作品権限を保存しました。" };
}
