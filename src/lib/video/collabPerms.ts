import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { isMissingDbObjectError } from "@/lib/db/optionalObjects";
import { videoMembers, xUsers } from "@/lib/db/schema";
import type { VideoCollabSubject } from "@/components/admin/VideoCollabPermsManager";

type AnyDb = LibSQLDatabase<any>;

export async function loadVideoCollabSubjects(
  db: AnyDb,
  videoId: string,
): Promise<{ subjects: VideoCollabSubject[]; tableAvailable: boolean }> {
  try {
    const rows = await db
      .select({
        x_user_id: videoMembers.x_user_id,
        discord_user_id: videoMembers.discord_user_id,
        display_name: videoMembers.name,
        can_edit: videoMembers.can_edit,
        is_public_member: videoMembers.is_public_member,
        linked_discord_user_id: xUsers.linked_discord_user_id,
      })
      .from(videoMembers)
      .leftJoin(xUsers, eq(videoMembers.x_user_id, xUsers.id))
      .where(eq(videoMembers.video_id, videoId));

    return {
      tableAvailable: true,
      subjects: rows
        .filter((row) => row.can_edit === 1 || row.is_public_member === 0)
        .map((row) => ({
          x_user_id: row.x_user_id,
          discord_user_id: row.discord_user_id,
          display_name: row.display_name,
          can_edit: row.can_edit,
          is_public_member: row.is_public_member,
          has_discord_link: Boolean(
            row.discord_user_id?.trim() || row.linked_discord_user_id?.trim(),
          ),
        })),
    };
  } catch (error) {
    if (isMissingDbObjectError(error, "video_members")) {
      return { subjects: [], tableAvailable: false };
    }
    throw error;
  }
}

export type EditPermissionWarningTone = "warning" | "info";

export interface EditPermissionWarning {
  tone: EditPermissionWarningTone;
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

function editorHasDiscord(s: VideoCollabSubject): boolean {
  return Boolean(s.discord_user_id?.trim() || s.has_discord_link);
}

export function computeEditPermissionSummary(
  subjects: VideoCollabSubject[],
  options?: {
    viewerDiscordId?: string | null;
    ownerDiscordId?: string | null;
  },
): EditPermissionSummary {
  const editors = subjects.filter((s) => s.can_edit === 1);
  const unlinkedEditors = editors.filter((s) => !editorHasDiscord(s));
  const notifiableEditors = editors.filter((s) => editorHasDiscord(s));
  const cannotNotify = editors.filter(
    (s) => s.x_user_id?.trim() && !editorHasDiscord(s),
  );

  const names = editors.map((s) => s.display_name).filter(Boolean);
  let displayNames = "";
  if (names.length === 0) {
    displayNames = "";
  } else if (names.length <= 3) {
    displayNames = `${names.join("、")} が編集できます。`;
  } else {
    displayNames = `${names.slice(0, 3).join("、")}、ほか${names.length - 3}人`;
  }

  const warnings: EditPermissionWarning[] = [];
  if (unlinkedEditors.length > 0) {
    warnings.push({
      tone: "warning",
      title: "未連携の編集者がいます。",
      detail: "Discord連携が完了すると編集できるようになります。",
    });
  }
  if (cannotNotify.length > 0 && unlinkedEditors.length === 0) {
    warnings.push({
      tone: "warning",
      title: "通知できない編集者がいます。",
      detail: "Discord 連携後に編集権通知を送れます。",
    });
  }
  const viewer = options?.viewerDiscordId?.trim();
  const owner = options?.ownerDiscordId?.trim();
  const otherEditors = editors.filter((s) => {
    const discord = s.discord_user_id?.trim();
    if (viewer && discord === viewer) return false;
    if (owner && discord === owner) return false;
    return true;
  });
  if (otherEditors.length > 0 && editors.length > 0) {
    warnings.push({
      tone: "info",
      title: "他のメンバーにも編集権があります。",
    });
  }

  return {
    editorCount: editors.length,
    unlinkedEditorCount: unlinkedEditors.length,
    notifiableEditorCount: notifiableEditors.length,
    displayNames,
    warnings,
  };
}
