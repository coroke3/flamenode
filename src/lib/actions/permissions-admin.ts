"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { systemSettings } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";

export interface PermissionAdminResult { ok: boolean; message?: string }
const ALLOWED_VIDEO_FIELDS = new Set(["title", "display_name", "icon_url", "music", "credit", "intro_comment", "used_software", "highlights", "production_story", "closing_comment", "members", "chapters"]);
function cleanFields(values: FormDataEntryValue[]): string {
  return Array.from(new Set(values.map(String).filter((value) => ALLOWED_VIDEO_FIELDS.has(value)))).join(",");
}

export async function updateGlobalEditableFields(formData: FormData): Promise<PermissionAdminResult> {
  const guard = await requireAdminWrite("admin_permissions");
  if (!guard.ok) return { ok: false, message: guard.message };
  const { db } = guard;
  const before = (await db.select().from(systemSettings).where(eq(systemSettings.id, "default")).limit(1))[0];
  if (!before) return { ok: false, message: "system_settingsが見つかりません。" };
  const patch = {
    default_editable_fields: cleanFields(formData.getAll("default_editable_fields")),
    upcoming_editable_fields: cleanFields(formData.getAll("upcoming_editable_fields")),
  };
  const after = { ...before, ...patch };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(systemSettings).set(patch).where(and(eq(systemSettings.id, "default"), expectedRowCondition({ expectedCurrent: { ...before } }))!)],
      expectedMutationChanges: 1,
      audits: [{ table_name: "system_settings", target_id: "default", operation: "UPDATE", before: { ...before }, after: { ...after }, actor_user_id: guard.user.id, context: "admin_permissions", reason: "一般作品権限を更新", retention_class: "long_audit", strict: true }],
    });
  } catch (error) {
    console.error("[permissions-admin] atomic mutation failed", error);
    return { ok: false, message: "更新が競合したか監査記録に失敗しました。" };
  }
  revalidatePath("/admin/users");
  return { ok: true, message: "一般作品権限を保存しました。" };
}
