import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { videoMembers, xUserAccountLinks, xUsers } from "@/lib/db/schema";
import type { VideoCollabSubject } from "@/components/admin/VideoCollabPermsManager";

function isMissingDbObjectError(
  error: unknown,
  objectName: string,
): boolean {
  const seen = new Set<unknown>();
  const collect = (value: unknown): string => {
    if (value == null || seen.has(value)) return "";
    seen.add(value);
    if (typeof value === "string") return value;
    if (value instanceof Error) {
      return `${value.name}\n${value.message}\n${value.stack ?? ""}\n${collect(value.cause)}`;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      return [
        typeof record.message === "string" ? record.message : "",
        typeof record.stack === "string" ? record.stack : "",
        collect(record.cause),
      ].filter(Boolean).join("\n");
    }
    return String(value);
  };

  const text = collect(error).toLowerCase();
  const object = objectName.toLowerCase();
  return (
    text.includes(`no such table: ${object}`) ||
    text.includes(`no such column: ${object}`) ||
    (text.includes("no such table") && text.includes(object)) ||
    (text.includes("no such column") && text.includes(object))
  );
}

type AnyDb = LibSQLDatabase<any>;

export async function loadVideoCollabSubjects(
  db: AnyDb,
  videoId: string,
): Promise<{ subjects: VideoCollabSubject[]; tableAvailable: boolean }> {
  try {
    const rows = await db
      .select({
        x_user_id: videoMembers.x_user_id,
        display_name: videoMembers.name,
        can_edit: videoMembers.can_edit,
        is_public_member: videoMembers.is_public_member,
        // 実際の所有者判定と同じく「承認済みX ID + account link」が揃った時だけ
        // 編集可能として表示する。link行だけ存在するpending/rejected Xは未連携扱い。
        has_account_link: sql<number>`EXISTS (
          SELECT 1
          FROM ${xUserAccountLinks} link
          INNER JOIN ${xUsers} xu ON xu.id = link.x_user_id
          WHERE link.x_user_id = ${videoMembers.x_user_id}
            AND xu.approval_status = 'approved'
        )`,
      })
      .from(videoMembers)
      .where(eq(videoMembers.video_id, videoId));

    return {
      tableAvailable: true,
      subjects: rows
        .filter((row) => row.can_edit === 1 || row.is_public_member === 0)
        .map((row) => ({
          x_user_id: row.x_user_id,
          user_id: null,
          display_name: row.display_name,
          can_edit: row.can_edit,
          is_public_member: row.is_public_member,
          // legacy field name。意味は Discord 直接紐付けではなく
          // 「承認済みX IDがAuth userへ連携済み」。UIではアカウント連携と表示する。
          has_discord_link: row.has_account_link === 1,
        })),
    };
  } catch (error) {
    if (isMissingDbObjectError(error, "video_members")) {
      return { subjects: [], tableAvailable: false };
    }
    throw error;
  }
}

interface EditPermissionWarning {
  tone: "warning" | "info";
  title: string;
  detail?: string;
}

export interface EditPermissionSummary {
  editorCount: number;
  unlinkedEditorCount: number;
  notifiableEditorCount: number;
  displayNames: string;
  warnings: EditPermissionWarning[];
}

function editorHasAccountLink(subject: VideoCollabSubject): boolean {
  return Boolean(subject.user_id?.trim() || subject.has_discord_link);
}

export function computeEditPermissionSummary(
  subjects: VideoCollabSubject[],
  options?: {
    viewerDiscordId?: string | null;
    ownerDiscordId?: string | null;
  },
): EditPermissionSummary {
  const editors = subjects.filter((subject) => subject.can_edit === 1);
  const names: string[] = [];
  let unlinkedEditorCount = 0;
  for (const editor of editors) {
    if (editor.display_name) names.push(editor.display_name);
    if (!editorHasAccountLink(editor)) unlinkedEditorCount += 1;
  }

  const displayNames =
    names.length === 0
      ? ""
      : names.length <= 3
        ? `${names.join("、")} に編集権限が付与されています。`
        : `${names.slice(0, 3).join("、")}、ほか${names.length - 3}人`;

  const warnings: EditPermissionWarning[] = [];
  if (unlinkedEditorCount > 0) {
    warnings.push({
      tone: "warning",
      title: "X ID連携待ちの編集者がいます。",
      detail:
        "権限自体は保存済みです。対象X IDとログインアカウントの連携が承認されると編集できるようになります。",
    });
  }

  const viewer = options?.viewerDiscordId?.trim();
  const owner = options?.ownerDiscordId?.trim();
  if (
    editors.some((editor) => {
      const discord = editor.user_id?.trim();
      return (!viewer || discord !== viewer) && (!owner || discord !== owner);
    })
  ) {
    warnings.push({
      tone: "info",
      title: "他のメンバーにも編集権限が設定されています。",
    });
  }

  return {
    editorCount: editors.length,
    unlinkedEditorCount,
    notifiableEditorCount: editors.length - unlinkedEditorCount,
    displayNames,
    warnings,
  };
}
