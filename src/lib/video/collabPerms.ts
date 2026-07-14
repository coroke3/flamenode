import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { videoMembers, xUsers } from "@/lib/db/schema";
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
        user_id: videoMembers.user_id,
        display_name: videoMembers.name,
        can_edit: videoMembers.can_edit,
        is_public_member: videoMembers.is_public_member,
        linked_user_id: xUsers.linked_user_id,
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
          user_id: row.user_id,
          display_name: row.display_name,
          can_edit: row.can_edit,
          is_public_member: row.is_public_member,
          has_discord_link: Boolean(
            row.user_id?.trim() || row.linked_user_id?.trim(),
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

function editorHasDiscord(subject: VideoCollabSubject): boolean {
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
    if (!editorHasDiscord(editor)) unlinkedEditorCount += 1;
  }

  const displayNames =
    names.length === 0
      ? ""
      : names.length <= 3
        ? `${names.join("、")} が編集できます。`
        : `${names.slice(0, 3).join("、")}、ほか${names.length - 3}人`;

  const warnings: EditPermissionWarning[] = [];
  if (unlinkedEditorCount > 0) {
    warnings.push({
      tone: "warning",
      title: "未連携の編集者がいます。",
      detail: "Discord連携が完了すると編集できるようになります。",
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
      title: "他のメンバーにも編集権があります。",
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
