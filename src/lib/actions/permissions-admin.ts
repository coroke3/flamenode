"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";

export interface PermissionAdminResult {
  ok: boolean;
  message?: string;
}

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

function cleanFields(values: FormDataEntryValue[]): string {
  return Array.from(
    new Set(
      values
        .map((value) => String(value))
        .filter((value) => ALLOWED_VIDEO_FIELDS.has(value)),
    ),
  ).join(",");
}

export async function updateGlobalEditableFields(
  formData: FormData,
): Promise<PermissionAdminResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const id = "global";
  const defaultFields = cleanFields(formData.getAll("default_editable_fields"));
  const upcomingFields = cleanFields(formData.getAll("upcoming_editable_fields"));
  const before = (
    await db.select().from(systemSettings).where(eq(systemSettings.id, id)).limit(1)
  )[0];
  const now = Math.floor(Date.now() / 1000);

  if (before) {
    await db
      .update(systemSettings)
      .set({
        default_editable_fields: defaultFields,
        upcoming_editable_fields: upcomingFields,
      })
      .where(eq(systemSettings.id, id));
  } else {
    await db.insert(systemSettings).values({
      id,
      default_editable_fields: defaultFields,
      upcoming_editable_fields: upcomingFields,
    });
  }

  await auditAction(db, {
    table_name: "system_settings",
    record_id: id,
    action: before ? "UPDATE" : "CREATE",
    before_data: before
      ? {
          default_editable_fields: before.default_editable_fields,
          upcoming_editable_fields: before.upcoming_editable_fields,
        }
      : null,
    after_data: {
      default_editable_fields: defaultFields,
      upcoming_editable_fields: upcomingFields,
    },
    operator_discord_id: u.id,
    retention_class: "long_audit",
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "一般作品権限を保存しました。" };
}
