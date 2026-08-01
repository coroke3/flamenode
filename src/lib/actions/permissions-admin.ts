"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { AuditMutationError, mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import {
  normalizeGeneralEditableFields,
  serializeGeneralEditableFields,
} from "@/lib/video/generalEditPermissions";

export interface PermissionAdminResult {
  ok: boolean;
  message?: string;
  settings?: {
    default_editable_fields: string | null;
    upcoming_editable_fields: string | null;
  };
}

type PermissionSettingsRow = {
  id: string;
  default_editable_fields: string | null;
  upcoming_editable_fields: string | null;
};

const PERMISSION_SETTINGS_COLUMNS = {
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

function snapshotPermissionSettings(
  row: PermissionSettingsRow,
): PermissionSettingsRow {
  return {
    id: row.id,
    default_editable_fields: row.default_editable_fields,
    upcoming_editable_fields: row.upcoming_editable_fields,
  };
}

export async function updateGlobalEditableFields(
  formData: FormData,
): Promise<PermissionAdminResult> {
  const guard = await requireAdminWrite("admin_permissions");
  if (!guard.ok) return { ok: false, message: guard.message };
  const { db } = guard;

  const before = (
    await db
      .select(PERMISSION_SETTINGS_COLUMNS)
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];
  if (!before) {
    return {
      ok: false,
      message:
        "一般作品権限の設定行が見つかりません。DBマイグレーションの適用状態を確認してください。",
    };
  }

  const beforeSnapshot = snapshotPermissionSettings(before);
  const patch = {
    default_editable_fields: serializeGeneralEditableFields(
      normalizeGeneralEditableFields(formData.getAll("default_editable_fields")),
    ),
    upcoming_editable_fields: serializeGeneralEditableFields(
      normalizeGeneralEditableFields(formData.getAll("upcoming_editable_fields")),
    ),
  };
  const norm = (v: string | null | undefined) => v || "";

  if (
    norm(beforeSnapshot.default_editable_fields) === patch.default_editable_fields &&
    norm(beforeSnapshot.upcoming_editable_fields) === patch.upcoming_editable_fields
  ) {
    return {
      ok: true,
      message: "一般作品権限に変更はありません。",
      settings: patch,
    };
  }

  const afterSnapshot = { ...beforeSnapshot, ...patch };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(systemSettings)
          .set(patch)
          .where(
            and(
              eq(systemSettings.id, "default"),
              expectedRowCondition({ expectedCurrent: beforeSnapshot }),
            )!,
          ),
      ],
      expectedMutationChanges: 1,
      audits: [
        {
          table_name: "system_settings",
          target_id: "default",
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
    if (error instanceof AuditMutationError) {
      return {
        ok: false,
        message:
          "別の管理者が一般作品権限を更新しました。ページを再読み込みして、現在の設定を確認してください。",
      };
    }
    console.error("[permissions-admin] atomic mutation failed", error);
    return {
      ok: false,
      message: "一般作品権限の保存に失敗しました。時間をおいて再度お試しください。",
    };
  }

  await revalidatePermissionsAdminPathsBestEffort();
  return {
    ok: true,
    message: "一般作品権限を保存しました。",
    settings: patch,
  };
}
