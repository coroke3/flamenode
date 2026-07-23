import "server-only";

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  DANGEROUS_PERMISSION_KEYS,
  PERMISSION_DEFINITIONS,
  type PermissionKey,
} from "@/lib/auth/permissions/keys";
import {
  getPresetPermissions,
  type EventStaffPreset,
} from "@/lib/auth/permissions/presets";
import {
  resolveStaffPermissionKeys,
  safeParseCustomPermissionKeys,
} from "@/lib/auth/permissions/permissionResolver";
import { makeCheck, type IntegrityCheckResult, type IntegrityIssue } from "./integrityChecks";

const DISPLAY_LIMIT = 50;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function staffHref(eventId: string): string {
  return `/manage/events/${encodeURIComponent(eventId)}/staff`;
}

function finalizeJsCheck(
  id: string,
  title: string,
  severity: IntegrityCheckResult["severity"],
  description: string,
  issues: IntegrityIssue[],
  recommendation: string,
): IntegrityCheckResult | null {
  if (issues.length === 0) return null;
  const visibleIssues = issues.slice(0, DISPLAY_LIMIT);
  return {
    id,
    title,
    area: "event_staff",
    severity,
    description,
    count: issues.length,
    issues: visibleIssues,
    moreCount: Math.max(0, issues.length - visibleIssues.length),
    recommendation,
  };
}

export async function buildPermissionIntegrityChecks(
  db: DB,
): Promise<IntegrityCheckResult[]> {
  const ownerResolved = resolveStaffPermissionKeys({
    permission_preset: "owner",
    custom_permission_keys_json: null,
  });
  const ownerMissingPermissions = getPresetPermissions("owner").filter(
    (key) => !ownerResolved.has(key),
  );
  const managerResolved = resolveStaffPermissionKeys({
    permission_preset: "manager",
    custom_permission_keys_json: null,
  });
  const managerDangerousPermissions = DANGEROUS_PERMISSION_KEYS.filter((key) =>
    managerResolved.has(key),
  );

  const [sqlChecks, duplicateX, staffRows] = await Promise.all([
    Promise.all([
      makeCheck({
        db,
        id: "staff_missing_subject_ids",
        area: "event_staff",
        title: "X ID が空",
        severity: "danger",
        description: "スタッフ行に紐づく X ID がありません。",
        from: sql`event_staff`,
        where: sql`x_user_id IS NULL OR trim(x_user_id) = ''`,
        sampleSelect: {
          id: sql<string>`id`,
          event_id: sql<string>`event_id`,
          display_name: sql<string>`display_name`,
        },
        recommendation: "スタッフ行を削除するか、識別子を設定してください。",
        mapIssue: (row) => ({
          id: text(row.id),
          title: text(row.display_name) || "未設定",
          description: `event:${text(row.event_id)}`,
          adminHref: staffHref(text(row.event_id)),
        }),
      }),
      makeCheck({
        db,
        id: "staff_custom_without_keys",
        area: "event_staff",
        title: "custom なのに custom_permission_keys_json が空",
        severity: "warning",
        description: "custom プリセットなのに追加キーがありません。",
        from: sql`event_staff`,
        where: sql`permission_preset = 'custom' AND (custom_permission_keys_json IS NULL OR trim(custom_permission_keys_json) = '' OR trim(custom_permission_keys_json) = '[]')`,
        sampleSelect: {
          id: sql<string>`id`,
          event_id: sql<string>`event_id`,
          x_user_id: sql<string>`x_user_id`,
        },
        recommendation: "custom_permission_keys_json を設定するかプリセットを変更してください。",
        mapIssue: (row) => ({
          id: text(row.id),
          title: `@${text(row.x_user_id) || "—"}`,
          description: `event:${text(row.event_id)}`,
          adminHref: staffHref(text(row.event_id)),
        }),
      }),
      makeCheck({
        db,
        id: "staff_non_custom_with_custom_json",
        area: "event_staff",
        title: "custom 以外なのに custom_permission_keys_json あり",
        severity: "info",
        description: "プリセットと custom JSON が併存しています。",
        from: sql`event_staff`,
        where: sql`permission_preset <> 'custom' AND custom_permission_keys_json IS NOT NULL AND trim(custom_permission_keys_json) <> '' AND trim(custom_permission_keys_json) <> '[]'`,
        sampleSelect: {
          id: sql<string>`id`,
          event_id: sql<string>`event_id`,
          x_user_id: sql<string>`x_user_id`,
          permission_preset: sql<string>`permission_preset`,
        },
        recommendation: "不要な custom_permission_keys_json を削除してください。",
        mapIssue: (row) => ({
          id: text(row.id),
          title: `@${text(row.x_user_id) || "—"}`,
          description: `${text(row.permission_preset)} / event:${text(row.event_id)}`,
          adminHref: staffHref(text(row.event_id)),
        }),
      }),
    ]),
    db
      .select({
        event_id: sql<string>`event_id`,
        x_user_id: sql<string>`x_user_id`,
        c: sql<number>`COUNT(*)`,
        total_count: sql<number>`COUNT(*) OVER()`,
      })
      .from(sql`event_staff`)
      .where(sql`x_user_id IS NOT NULL AND trim(x_user_id) <> ''`)
      .groupBy(sql`event_id`, sql`x_user_id`)
      .having(sql`COUNT(*) > 1`)
      .limit(DISPLAY_LIMIT),
    db
      .select({
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        x_user_id: sql<string>`x_user_id`,
        permission_preset: sql<string>`permission_preset`,
        custom_permission_keys_json: sql<string | null>`custom_permission_keys_json`,
      })
      .from(sql`event_staff`)
      .where(sql`permission_preset IN ('owner', 'manager', 'custom')`)
      .limit(500),
  ]);

  const ownerIssues: IntegrityIssue[] = [];
  const managerIssues: IntegrityIssue[] = [];
  const invalidCustomIssues: IntegrityIssue[] = [];

  for (const row of staffRows) {
    const id = text(row.id);
    const eventId = text(row.event_id);
    const preset = text(row.permission_preset) as EventStaffPreset;
    const customJson = row.custom_permission_keys_json ?? null;

    if (preset === "custom" && customJson && customJson.trim() !== "[]") {
      const parsed = safeParseCustomPermissionKeys(customJson, {
        allowAdminOnly: true,
      });
      if (parsed.length === 0) {
        invalidCustomIssues.push({
          id,
          title: `@${text(row.x_user_id) || "—"}`,
          description: `JSON 不正 event:${eventId}`,
          adminHref: staffHref(eventId),
        });
      }
      continue;
    }

    if (preset === "owner" && ownerMissingPermissions.length > 0) {
      ownerIssues.push({
        id,
        title: `@${text(row.x_user_id) || "—"}`,
        description: `不足: ${ownerMissingPermissions.join(", ")}`,
        adminHref: staffHref(eventId),
      });
      continue;
    }

    if (preset === "manager" && managerDangerousPermissions.length > 0) {
      managerIssues.push({
        id,
        title: `@${text(row.x_user_id) || "—"}`,
        description: `危険権限: ${managerDangerousPermissions.join(", ")}`,
        adminHref: staffHref(eventId),
      });
    }
  }

  const duplicateXCount = Number(duplicateX[0]?.total_count ?? 0);
  const jsChecks = [
    finalizeJsCheck(
      "staff_owner_missing_permissions",
      "owner なのに必要権限が不足",
      "danger",
      "owner プリセットに必要な権限キーが解決できません。",
      ownerIssues,
      "プリセット定義を確認してください。",
    ),
    finalizeJsCheck(
      "staff_manager_has_dangerous_permissions",
      "manager なのに危険権限あり",
      "warning",
      "manager に危険権限が含まれています。",
      managerIssues,
      "危険権限を外してください。",
    ),
    finalizeJsCheck(
      "staff_custom_json_invalid",
      "custom JSON がパース不能",
      "warning",
      "custom_permission_keys_json が壊れています。",
      invalidCustomIssues,
      "JSON を修正してください。",
    ),
    duplicateXCount > 0
      ? {
          id: "staff_duplicate_x_per_event",
          title: "同一イベント内で X ID が重複",
          area: "event_staff",
          severity: "danger" as const,
          description: "同じイベントに同一 X ID のスタッフ行が複数あります。",
          count: duplicateXCount,
          issues: duplicateX.map((row) => ({
            id: `${text(row.event_id)}:${text(row.x_user_id)}`,
            title: `@${text(row.x_user_id)}`,
            description: `event:${text(row.event_id)} × ${text(row.c)} 件`,
            adminHref: staffHref(text(row.event_id)),
          })),
          moreCount: Math.max(0, duplicateXCount - duplicateX.length),
          recommendation: "重複行を統合または削除してください。",
        }
      : null,
  ].filter((check): check is IntegrityCheckResult => check !== null);

  return [...sqlChecks.filter((check) => check.count > 0), ...jsChecks];
}

export function formatPermissionKeyLabel(key: PermissionKey): string {
  return PERMISSION_DEFINITIONS[key]?.label ?? key;
}
