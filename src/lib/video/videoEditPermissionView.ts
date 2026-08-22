import type {
  CanEditVideoPrivilegeMode,
  VideoOwnership,
} from "@/lib/auth/ownershipCore";

export type VideoFieldPermissionSource =
  | "owner_general"
  | "event_staff"
  | "admin"
  | "none";

export type VideoFieldPermissionReason =
  | "allowed"
  | "owner_policy_denied"
  | "not_owner"
  | "collaborator_not_granted"
  | "event_permission_denied"
  | "admin_only";

export type VideoFieldPermission = {
  editable: boolean;
  source: VideoFieldPermissionSource;
  reason: VideoFieldPermissionReason;
  eventId?: string;
  eventTitle?: string;
  /** UI表示用ラベル（内部 key ではない） */
  label: string;
};

export type VideoEditPermissionViewModel = {
  privilegeMode: "normal" | "admin" | "event";
  ownership: {
    isOwner: boolean;
    isCreatorOwner: boolean;
    isCollaboratorOwner: boolean;
  };
  canOfferAdminMode: boolean;
  canOfferEventMode: boolean;
  identity: VideoFieldPermission;
  basics: VideoFieldPermission;
  youtube: VideoFieldPermission;
  credits: VideoFieldPermission;
  descriptions: VideoFieldPermission;
  members: VideoFieldPermission;
  memberChapters: VideoFieldPermission;
  primaryEvent: VideoFieldPermission;
  visibility: VideoFieldPermission;
  permissions: VideoFieldPermission;
};

export type VideoViewSectionKey =
  | "identity"
  | "basics"
  | "youtube"
  | "credits"
  | "descriptions"
  | "members"
  | "memberChapters"
  | "primaryEvent"
  | "visibility"
  | "permissions";

export const VIDEO_VIEW_SECTION_LABELS: Record<VideoViewSectionKey, string> = {
  identity: "提出者情報",
  basics: "作品タイトル・基本情報",
  youtube: "YouTube URL",
  credits: "楽曲・クレジット",
  descriptions: "紹介文・振り返り",
  members: "合作メンバー",
  memberChapters: "メンバーチャプター",
  primaryEvent: "所属イベント",
  visibility: "公開状態",
  permissions: "共同編集権限",
};

// Only control-plane fields are inherently administrator-only.  Identity
// snapshots, the YouTube URL, and event membership are covered by the
// canonical owner field registry, so a normal owner who is denied one of
// those fields must see the owner-policy reason rather than an inaccurate
// "admin only" label.
const DANGEROUS_VIEW_SECTIONS = new Set<VideoViewSectionKey>([
  "visibility",
  "permissions",
]);

export type BuildVideoFieldPermissionArgs = {
  editable: boolean;
  privilegeMode: CanEditVideoPrivilegeMode;
  ownership: VideoOwnership;
  sectionKey: VideoViewSectionKey;
  label: string;
  isDangerousAdminOnly?: boolean;
  membershipHint?: "none" | "member_no_edit" | "outsider";
  eventId?: string;
  eventTitle?: string;
};

export function buildVideoFieldPermission(
  args: BuildVideoFieldPermissionArgs,
): VideoFieldPermission {
  const {
    editable,
    privilegeMode,
    ownership,
    label,
    isDangerousAdminOnly,
    membershipHint,
    eventId,
    eventTitle,
  } = args;

  const eventMeta =
    eventId || eventTitle
      ? {
          ...(eventId ? { eventId } : {}),
          ...(eventTitle ? { eventTitle } : {}),
        }
      : {};

  if (editable) {
    const source: VideoFieldPermissionSource =
      privilegeMode === "admin"
        ? "admin"
        : privilegeMode === "event"
          ? "event_staff"
          : "owner_general";
    return {
      editable: true,
      source,
      reason: "allowed",
      label,
      ...eventMeta,
    };
  }

  let reason: VideoFieldPermissionReason;
  if (privilegeMode === "admin") {
    reason = "admin_only";
  } else if (privilegeMode === "event") {
    reason = "event_permission_denied";
  } else if (!ownership.isOwner) {
    reason =
      membershipHint === "member_no_edit"
        ? "collaborator_not_granted"
        : "not_owner";
  } else if (isDangerousAdminOnly) {
    reason = "admin_only";
  } else {
    reason = "owner_policy_denied";
  }

  return {
    editable: false,
    source: "none",
    reason,
    label,
    ...eventMeta,
  };
}

export function formatVideoFieldPermissionReason(
  permission: VideoFieldPermission,
): string {
  switch (permission.reason) {
    case "allowed":
      return "";
    case "owner_policy_denied":
      return "この項目は、現在の一般作品権限では編集できません。";
    case "not_owner":
      return "この作品の所有者ではないため編集できません。";
    case "collaborator_not_granted":
      return "合作メンバーとして登録されていますが、作品編集権限が付与されていません。";
    case "event_permission_denied": {
      const base =
        "この操作に必要なイベント運営権限が付与されていません。";
      if (permission.label) {
        return `${base}必要な権限: ${permission.label}`;
      }
      return base;
    }
    case "admin_only":
      return "この項目は管理者権限でのみ変更できます。";
    default:
      return "";
  }
}

export type PermissionBadge = {
  kind: "editable" | "owner-denied" | "event" | "admin" | "locked";
  text: string;
};

export function formatPermissionBadge(
  permission: VideoFieldPermission,
): PermissionBadge {
  switch (permission.reason) {
    case "allowed":
      return { kind: "editable", text: "編集可能" };
    case "owner_policy_denied":
      return { kind: "owner-denied", text: "所有者権限では編集不可" };
    case "event_permission_denied":
      return { kind: "event", text: "運営権限が必要" };
    case "admin_only":
      return { kind: "admin", text: "管理者限定" };
    case "not_owner":
    case "collaborator_not_granted":
      return { kind: "locked", text: "編集不可" };
    default:
      return { kind: "locked", text: "編集不可" };
  }
}

const VIEW_MODEL_SECTION_KEYS: VideoViewSectionKey[] = [
  "identity",
  "basics",
  "youtube",
  "credits",
  "descriptions",
  "members",
  "memberChapters",
  "primaryEvent",
  "visibility",
  "permissions",
];

export function buildPermissionSummaryLists(
  vm: VideoEditPermissionViewModel,
): { editableLabels: string[]; lockedLabels: string[] } {
  const editableLabels: string[] = [];
  const lockedLabels: string[] = [];

  for (const key of VIEW_MODEL_SECTION_KEYS) {
    const field = vm[key];
    if (field.editable) {
      editableLabels.push(field.label);
    } else {
      lockedLabels.push(field.label);
    }
  }

  return { editableLabels, lockedLabels };
}

export type BuildVideoEditPermissionViewModelArgs = {
  privilegeMode: CanEditVideoPrivilegeMode;
  ownership: VideoOwnership;
  canOfferAdminMode: boolean;
  canOfferEventMode: boolean;
  sections: Record<VideoViewSectionKey, boolean>;
  membershipHint?: "none" | "member_no_edit" | "outsider";
  eventId?: string;
  eventTitle?: string;
  /** セクションごとの権限元イベント（event モード用）。無い場合は共通 eventId/Title を使う。 */
  sectionEventSources?: Partial<
    Record<VideoViewSectionKey, { eventId?: string; eventTitle?: string }>
  >;
};

function buildSectionPermission(
  args: BuildVideoEditPermissionViewModelArgs,
  sectionKey: VideoViewSectionKey,
): VideoFieldPermission {
  const sectionSource = args.sectionEventSources?.[sectionKey];
  return buildVideoFieldPermission({
    editable: args.sections[sectionKey],
    privilegeMode: args.privilegeMode,
    ownership: args.ownership,
    sectionKey,
    label: VIDEO_VIEW_SECTION_LABELS[sectionKey],
    isDangerousAdminOnly: DANGEROUS_VIEW_SECTIONS.has(sectionKey),
    membershipHint: args.membershipHint,
    eventId: sectionSource?.eventId ?? args.eventId,
    eventTitle: sectionSource?.eventTitle ?? args.eventTitle,
  });
}

export function buildVideoEditPermissionViewModel(
  args: BuildVideoEditPermissionViewModelArgs,
): VideoEditPermissionViewModel {
  const sectionPermissions = Object.fromEntries(
    VIEW_MODEL_SECTION_KEYS.map((key) => [
      key,
      buildSectionPermission(args, key),
    ]),
  ) as Record<VideoViewSectionKey, VideoFieldPermission>;

  return {
    privilegeMode: args.privilegeMode,
    ownership: {
      isOwner: args.ownership.isOwner,
      isCreatorOwner: args.ownership.isCreatorOwner,
      isCollaboratorOwner: args.ownership.isCollaboratorOwner,
    },
    canOfferAdminMode: args.canOfferAdminMode,
    canOfferEventMode: args.canOfferEventMode,
    identity: sectionPermissions.identity,
    basics: sectionPermissions.basics,
    youtube: sectionPermissions.youtube,
    credits: sectionPermissions.credits,
    descriptions: sectionPermissions.descriptions,
    members: sectionPermissions.members,
    memberChapters: sectionPermissions.memberChapters,
    primaryEvent: sectionPermissions.primaryEvent,
    visibility: sectionPermissions.visibility,
    permissions: sectionPermissions.permissions,
  };
}
