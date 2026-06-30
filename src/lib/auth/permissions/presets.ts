import type { PermissionKey } from "./keys";

export type EventStaffPreset =
  | "representative"
  | "editor"
  | "reviewer"
  | "slot_manager"
  | "staff_display_only"
  | "custom";

export type PresetDefinition = {
  label: string;
  description: string;
  permissions: readonly PermissionKey[];
};

export const PRESET_DEFINITIONS: Record<EventStaffPreset, PresetDefinition> = {
  representative: {
    label: "代表",
    description: "イベント全体を管理できます。スタッフ管理や公開APIなどの重要操作を含みます。",
    permissions: [
      "event.basic",
      "event.slots",
      "event.members",
      "event.questions",
      "event.review",
      "event.notifications",
      "event.public_api",
      "event.static_rebuild",
      "xid.link_requests",
      "video.basics",
      "video.descriptions",
      "video.credits",
      "video.members",
      "video.member_chapters",
      "video.status",
      "video.primary_event",
    ],
  },
  editor: {
    label: "運営",
    description: "通常のイベント運営向けです。枠管理、投稿確認、作品情報の修正ができます。スタッフ管理や危険操作は含みません。",
    permissions: [
      "event.basic",
      "event.slots",
      "event.questions",
      "event.review",
      "event.notifications",
      "video.basics",
      "video.descriptions",
      "video.credits",
      "video.members",
      "video.member_chapters",
    ],
  },
  reviewer: {
    label: "レビュー担当",
    description: "投稿内容の確認向けです。イベント設定やスタッフ管理はできません。",
    permissions: [
      "event.review",
      "video.descriptions",
      "video.credits",
    ],
  },
  slot_manager: {
    label: "枠管理担当",
    description: "枠作成・変更を担当します。作品本文やスタッフ管理はできません。",
    permissions: [
      "event.slots",
      "event.review",
    ],
  },
  staff_display_only: {
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

export function getPresetPermissions(preset: EventStaffPreset): PermissionKey[] {
  return [...PRESET_DEFINITIONS[preset].permissions];
}
