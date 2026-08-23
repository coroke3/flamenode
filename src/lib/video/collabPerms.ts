import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  users,
  videoMembers,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import type { VideoCollabSubject } from "@/components/admin/VideoCollabPermsManager";
import { normalizeXId } from "@/lib/utils/xid";

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
type VideoCollabSubjectWithDelivery = VideoCollabSubject & {
  can_notify?: boolean;
};

export async function loadVideoCollabSubjects(
  db: AnyDb,
  videoId: string,
): Promise<{ subjects: VideoCollabSubjectWithDelivery[]; tableAvailable: boolean }> {
  try {
    const rows = await db
      .select({
        x_user_id: videoMembers.x_user_id,
        display_name: videoMembers.name,
        can_edit: videoMembers.can_edit,
        is_public_member: videoMembers.is_public_member,
        // 実際のownership判定と同じく、承認済みX IDとaccount linkが
        // 両方存在するときだけ「編集可能」と表示する。
        has_account_link: sql<number>`EXISTS (
          SELECT 1
          FROM ${xUserAccountLinks} link
          INNER JOIN ${xUsers} xu ON xu.id = link.x_user_id
          WHERE lower(link.x_user_id) = lower(${videoMembers.x_user_id})
            AND xu.approval_status = 'approved'
        )`,
        // 通知可能はownershipとは別条件。承認済みlinkに加え、少なくとも1つの
        // Auth userが通知ONである場合だけtrueにする。
        has_notifiable_link: sql<number>`EXISTS (
          SELECT 1
          FROM ${xUserAccountLinks} link
          INNER JOIN ${xUsers} xu ON xu.id = link.x_user_id
          INNER JOIN ${users} auth_user ON auth_user.id = link.auth_user_id
          WHERE lower(link.x_user_id) = lower(${videoMembers.x_user_id})
            AND xu.approval_status = 'approved'
            AND auth_user.is_notification_enabled = 1
        )`,
      })
      .from(videoMembers)
      .where(eq(videoMembers.video_id, videoId));

    // 公開メンバーはcan_edit=0でも「付与候補」として権限UIへ必要。
    // hidden rowは編集者専用なのでcan_edit=1だけを残す。旧条件はこれを逆に判定し、
    // 未付与の公開メンバーを消す一方でcan_edit=0のhidden行を残していた。
    // legacyデータにpublic/hidden重複行が残っていても、権限UIは1 X ID = 1 subjectにする。
    const byXId = new Map<string, VideoCollabSubjectWithDelivery>();
    for (const row of rows) {
      if (row.is_public_member !== 1 && row.can_edit !== 1) continue;
      const xid = normalizeXId(row.x_user_id);
      // X IDなしの旧hidden行は実際のownership主体になれずUIからも操作不能なので除外する。
      if (!xid) continue;

      const existing = byXId.get(xid);
      const next: VideoCollabSubjectWithDelivery = {
        x_user_id: xid,
        // 権限正本はX ID。Auth.js user IDを表示DTOへ混ぜない。
        user_id: null,
        display_name:
          existing && existing.is_public_member === 1 && row.is_public_member === 0
            ? existing.display_name
            : row.display_name,
        can_edit: existing?.can_edit === 1 || row.can_edit === 1 ? 1 : 0,
        is_public_member:
          existing?.is_public_member === 1 || row.is_public_member === 1 ? 1 : 0,
        // legacy field name。意味はDiscord直結ではなく
        // 「承認済みX IDがAuth userへ連携済み」。
        has_discord_link:
          Boolean(existing?.has_discord_link) || row.has_account_link === 1,
        can_notify: Boolean(existing?.can_notify) || row.has_notifiable_link === 1,
      };
      byXId.set(xid, next);
    }

    return {
      tableAvailable: true,
      subjects: Array.from(byXId.values()),
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
  return Boolean(subject.has_discord_link);
}

export function computeEditPermissionSummary(
  subjects: VideoCollabSubjectWithDelivery[],
  _legacyOptions?: {
    /** @deprecated 権限正本はX ID。比較用Auth/Discord IDをDTOへ戻さない。 */
    viewerDiscordId?: string | null;
    /** @deprecated 権限正本はX ID。比較用Auth/Discord IDをDTOへ戻さない。 */
    ownerDiscordId?: string | null;
  },
): EditPermissionSummary {
  const editors = subjects.filter((subject) => subject.can_edit === 1);
  const names: string[] = [];
  let unlinkedEditorCount = 0;
  let notifiableEditorCount = 0;
  for (const editor of editors) {
    if (editor.display_name) names.push(editor.display_name);
    if (!editorHasAccountLink(editor)) unlinkedEditorCount += 1;
    if (editor.can_notify) notifiableEditorCount += 1;
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

  // loaderは意図的にAuth.js user IDを返さないため、旧viewer/owner IDとの比較から
  // 「他のメンバー」と推測してはいけない。対象者はdisplayNames/権限管理一覧で明示する。

  return {
    editorCount: editors.length,
    unlinkedEditorCount,
    notifiableEditorCount,
    displayNames,
    warnings,
  };
}
