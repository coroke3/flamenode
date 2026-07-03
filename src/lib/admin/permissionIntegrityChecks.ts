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
  keysToPermissionMask,
  resolveStaffPermissionKeys,
  safeParseCustomPermissionKeys,
} from "@/lib/auth/permissions/mask";
import { makeCheck, type IntegrityCheckResult, type IntegrityIssue } from "./integrityChecks";

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
  return {
    id,
    title,
    area: "event_staff",
    severity,
    description,
    count: issues.length,
    issues,
    moreCount: 0,
    recommendation,
  };
}

function knownMaskMax(): number {
  return keysToPermissionMask(getPresetPermissions("owner"), {
    allowAdminOnly: true,
  });
}

const KNOWN_MASK_MAX = knownMaskMax();

function maskUnknownBits(mask: number): number {
  const numeric = Number(mask ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric & ~KNOWN_MASK_MAX;
}

export async function buildPermissionIntegrityChecks(
  db: DB,
): Promise<IntegrityCheckResult[]> {
  const sqlChecks = await Promise.all([
    makeCheck({
      db,
      id: "staff_public_staff_with_mask",
      area: "event_staff",
      title: "public_staff なのに permission_mask が 0 以外",
      severity: "warning",
      description: "表示専用スタッフに内部操作権限ビットが付いています。",
      from: sql`event_staff`,
      where: sql`permission_preset = 'public_staff' AND permission_mask <> 0`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        x_user_id: sql<string>`x_user_id`,
        permission_mask: sql<number>`permission_mask`,
      },
      recommendation:
        "permission_mask を 0 に戻すか、必要ならプリセットを変更してください。",
      mapIssue: (row) => ({
        id: text(row.id),
        title: `@${text(row.x_user_id) || "—"}`,
        description: `event:${text(row.event_id)} mask=${text(row.permission_mask)}`,
        adminHref: staffHref(text(row.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "staff_representative_public_staff",
      area: "event_staff",
      title: "representative なのに public_staff プリセット",
      severity: "warning",
      description: "代表ロールと表示専用プリセットが矛盾しています。",
      from: sql`event_staff`,
      where: sql`role = 'representative' AND permission_preset = 'public_staff'`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        x_user_id: sql<string>`x_user_id`,
      },
      recommendation: "代表には owner プリセットを設定してください。",
      mapIssue: (row) => ({
        id: text(row.id),
        title: `@${text(row.x_user_id) || "—"}`,
        description: `event:${text(row.event_id)}`,
        adminHref: staffHref(text(row.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "staff_missing_subject_ids",
      area: "event_staff",
      title: "X ID / Discord ID が両方空",
      severity: "danger",
      description: "スタッフ行に紐づくユーザー識別子がありません。",
      from: sql`event_staff`,
      where: sql`(x_user_id IS NULL OR trim(x_user_id) = '') AND (discord_user_id IS NULL OR trim(discord_user_id) = '')`,
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
  ]);

  const duplicateX = await db
    .select({
      event_id: sql<string>`event_id`,
      x_user_id: sql<string>`x_user_id`,
      c: sql<number>`COUNT(*)`,
    })
    .from(sql`event_staff`)
    .where(
      sql`x_user_id IS NOT NULL AND trim(x_user_id) <> ''`,
    )
    .groupBy(sql`event_id`, sql`x_user_id`)
    .having(sql`COUNT(*) > 1`)
    .limit(50);

  const duplicateDiscord = await db
    .select({
      event_id: sql<string>`event_id`,
      discord_user_id: sql<string>`discord_user_id`,
      c: sql<number>`COUNT(*)`,
    })
    .from(sql`event_staff`)
    .where(sql`discord_user_id IS NOT NULL AND trim(discord_user_id) <> ''`)
    .groupBy(sql`event_id`, sql`discord_user_id`)
    .having(sql`COUNT(*) > 1`)
    .limit(50);

  const staffRows = await db
    .select({
      id: sql<string>`id`,
      event_id: sql<string>`event_id`,
      x_user_id: sql<string>`x_user_id`,
      permission_preset: sql<string>`permission_preset`,
      permission_mask: sql<number>`permission_mask`,
      custom_permission_keys_json: sql<string | null>`custom_permission_keys_json`,
    })
    .from(sql`event_staff`)
    .limit(500);

  const ownerIssues: IntegrityIssue[] = [];
  const managerIssues: IntegrityIssue[] = [];
  const unknownBitIssues: IntegrityIssue[] = [];
  const invalidCustomIssues: IntegrityIssue[] = [];

  for (const row of staffRows) {
    const id = text(row.id);
    const eventId = text(row.event_id);
    const preset = text(row.permission_preset) as EventStaffPreset;
    const mask = Number(row.permission_mask ?? 0);
    const customJson = row.custom_permission_keys_json ?? null;

    const unknown = maskUnknownBits(mask);
    if (unknown > 0) {
      unknownBitIssues.push({
        id,
        title: `@${text(row.x_user_id) || "—"}`,
        description: `未知ビット ${unknown} (mask=${mask}) event:${eventId}`,
        adminHref: staffHref(eventId),
      });
    }

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
    }

    const resolved = resolveStaffPermissionKeys({
      permission_mask: mask,
      permission_preset: preset,
      custom_permission_keys_json: customJson,
    });

    if (preset === "owner") {
      const missing = getPresetPermissions("owner").filter(
        (key) => !resolved.has(key),
      );
      if (missing.length > 0) {
        ownerIssues.push({
          id,
          title: `@${text(row.x_user_id) || "—"}`,
          description: `不足: ${missing.join(", ")}`,
          adminHref: staffHref(eventId),
        });
      }
    }

    if (preset === "manager") {
      const dangerous = DANGEROUS_PERMISSION_KEYS.filter((key) =>
        resolved.has(key),
      );
      if (dangerous.length > 0) {
        managerIssues.push({
          id,
          title: `@${text(row.x_user_id) || "—"}`,
          description: `危険権限: ${dangerous.join(", ")}`,
          adminHref: staffHref(eventId),
        });
      }
    }
  }

  const jsChecks = [
    finalizeJsCheck(
      "staff_owner_missing_permissions",
      "owner なのに必要権限が不足",
      "danger",
      "owner プリセットに必要な権限キーが解決できません。",
      ownerIssues.slice(0, 50),
      "permission_mask を再設定してください。",
    ),
    finalizeJsCheck(
      "staff_manager_has_dangerous_permissions",
      "manager なのに危険権限あり",
      "warning",
      "manager に危険権限が含まれています。",
      managerIssues.slice(0, 50),
      "危険権限を外してください。",
    ),
    finalizeJsCheck(
      "staff_mask_unknown_bits",
      "permission_mask に未知ビット",
      "warning",
      "定義外ビットが立っています。",
      unknownBitIssues.slice(0, 50),
      "mask を再計算してください。",
    ),
    finalizeJsCheck(
      "staff_custom_json_invalid",
      "custom JSON がパース不能",
      "warning",
      "custom_permission_keys_json が壊れています。",
      invalidCustomIssues.slice(0, 50),
      "JSON を修正してください。",
    ),
    duplicateX.length > 0
      ? {
          id: "staff_duplicate_x_per_event",
          title: "同一イベント内で X ID が重複",
          area: "event_staff",
          severity: "danger" as const,
          description: "同じイベントに同一 X ID のスタッフ行が複数あります。",
          count: duplicateX.length,
          issues: duplicateX.map((row) => ({
            id: `${text(row.event_id)}:${text(row.x_user_id)}`,
            title: `@${text(row.x_user_id)}`,
            description: `event:${text(row.event_id)} × ${text(row.c)} 件`,
            adminHref: staffHref(text(row.event_id)),
          })),
          moreCount: 0,
          recommendation: "重複行を統合または削除してください。",
        }
      : null,
    duplicateDiscord.length > 0
      ? {
          id: "staff_duplicate_discord_per_event",
          title: "同一イベント内で Discord ID が重複",
          area: "event_staff",
          severity: "warning" as const,
          description: "同じイベントに同一 Discord ID のスタッフ行が複数あります。",
          count: duplicateDiscord.length,
          issues: duplicateDiscord.map((row) => ({
            id: `${text(row.event_id)}:${text(row.discord_user_id)}`,
            title: text(row.discord_user_id),
            description: `event:${text(row.event_id)} × ${text(row.c)} 件`,
            adminHref: staffHref(text(row.event_id)),
          })),
          moreCount: 0,
          recommendation: "重複行を統合または削除してください。",
        }
      : null,
  ].filter((check): check is IntegrityCheckResult => check !== null);

  return [...sqlChecks.filter((check) => check.count > 0), ...jsChecks];
}

export function formatPermissionKeyLabel(key: PermissionKey): string {
  return PERMISSION_DEFINITIONS[key]?.label ?? key;
}
