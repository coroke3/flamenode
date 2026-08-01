import type { DB } from "@/lib/db/client";
import type { videos } from "@/lib/db/schema";
import { canEditVideo, type CanEditVideoPrivilegeMode } from "@/lib/auth/ownership";
import {
  loadGeneralEditableFieldSet,
  type GeneralEditableFieldKey,
} from "@/lib/video/generalEditPermissions";

export type VideoEditSectionKey =
  | "identity"
  | "basics"
  | "youtube"
  | "credits"
  | "descriptions"
  | "members"
  | "primary_event";

export interface AllowedVideoEditSections {
  identity: boolean;
  basics: boolean;
  youtube: boolean;
  credits: boolean;
  descriptions: boolean;
  members: boolean;
  primary_event: boolean;
}

const SECTION_KEYS: Array<{ section: VideoEditSectionKey; key: Parameters<typeof canEditVideo>[0]["requiredKey"] }> = [
  { section: "identity", key: "video.identity" },
  { section: "basics", key: "video.basics" },
  { section: "youtube", key: "video.youtube_id" },
  { section: "credits", key: "video.credits" },
  { section: "descriptions", key: "video.descriptions" },
  { section: "members", key: "video.members" },
  { section: "primary_event", key: "video.primary_event" },
];

export async function computeAllowedVideoEditSections(args: {
  db: DB;
  user: { id: string; role?: string | null };
  video: typeof videos.$inferSelect;
  privilegeMode: CanEditVideoPrivilegeMode;
  generalFields?: Set<GeneralEditableFieldKey>;
}): Promise<AllowedVideoEditSections> {
  const generalFields =
    args.privilegeMode === "normal"
      ? (args.generalFields ??
        (await loadGeneralEditableFieldSet(args.db, args.video)))
      : undefined;
  const results = await Promise.all(
    SECTION_KEYS.map(async ({ section, key }) => ({
      section,
      allowed: await canEditVideo({
        db: args.db,
        user: args.user,
        video: args.video,
        requiredKey: key,
        privilegeMode: args.privilegeMode,
        ...(generalFields !== undefined ? { generalFields } : {}),
      }),
    })),
  );
  const out: AllowedVideoEditSections = {
    identity: false,
    basics: false,
    youtube: false,
    credits: false,
    descriptions: false,
    members: false,
    primary_event: false,
  };
  for (const { section, allowed } of results) {
    out[section] = allowed;
  }
  return out;
}

export function hasAnyVideoEditSection(sections: AllowedVideoEditSections): boolean {
  return Object.values(sections).some(Boolean);
}
