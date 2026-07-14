import type { PermissionKey } from "./keys.ts";

export const EVENT_STAFF_PRESETS = [
  "owner",
  "manager",
  "slot_manager",
  "content_editor",
  "reviewer",
  "xid_reviewer",
  "public_staff",
  "custom",
] as const;

export type EventStaffPreset = (typeof EVENT_STAFF_PRESETS)[number];

export type PresetDefinition = {
  label: string;
  description: string;
  permissions: readonly PermissionKey[];
};

export const PRESET_DEFINITIONS: Record<EventStaffPreset, PresetDefinition> = {
  owner: {
    label: "代表",
    description: "イベント代表として、adminOnly 以外の主要な運営操作を管理できます。",
    permissions: [
      "event.basic",
      "event.publish",
      "event.slots",
      "event.members",
      "event.questions",
      "event.review",
      "event.notifications",
      "video.basics",
      "video.descriptions",
      "video.credits",
      "video.members",
      "video.member_chapters",
      "video.status",
    ],
  },
  manager: {
    label: "運営",
    description: "通常のイベント運営向けです。枠管理、投稿確認、作品情報の修正ができます。スタッフ管理や危険操作は含みません。",
    permissions: [
      "event.basic",
      "event.publish",
      "event.slots",
      "event.questions",
      "event.review",
      "event.notifications",
      "video.basics",
      "video.descriptions",
      "video.credits",
      "video.members",
      "video.member_chapters",
      "video.status",
    ],
  },
  reviewer: {
    label: "レビュー担当",
    description: "投稿内容の確認と公開状態の審査向けです。イベント設定やスタッフ管理はできません。",
    permissions: ["event.review", "video.status"],
  },
  slot_manager: {
    label: "枠管理担当",
    description: "枠作成・変更を担当します。作品本文やスタッフ管理はできません。",
    permissions: ["event.slots"],
  },
  content_editor: {
    label: "作品修正担当",
    description: "イベント所属作品の本文・クレジット・メンバー情報を修正できます。",
    permissions: [
      "video.basics",
      "video.descriptions",
      "video.credits",
      "video.members",
      "video.member_chapters",
    ],
  },
  xid_reviewer: {
    label: "X ID確認担当",
    description: "X ID連携申請を確認できます。site admin による明示付与専用です。",
    permissions: ["xid.link_requests"],
  },
  public_staff: {
    label: "表示のみスタッフ",
    description: "公開ページに掲載するためのスタッフです。内部操作権限はありません。",
    permissions: [],
  },
  custom: {
    label: "カスタム",
    description: "個別に権限を選択します。",
    permissions: [],
  },
};

export function isEventStaffPreset(value: unknown): value is EventStaffPreset {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PRESET_DEFINITIONS, value)
  );
}

export function getPresetPermissions(preset: EventStaffPreset): PermissionKey[] {
  return [...PRESET_DEFINITIONS[preset].permissions];
}

export function legacyRoleToPreset(
  role: "representative" | "editor" | "staff" | string | null | undefined,
): EventStaffPreset {
  if (role === "representative") return "owner";
  if (role === "editor") return "manager";
  return "public_staff";
}
