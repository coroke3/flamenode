/** CURRENT packages/domain/src/admin/costGuard.ts — a test guards drift against the domain list. */
export const WRITE_FEATURE_KEYS=[
"post_video_unslotted","post_video_slotted","edit_video","like_or_bookmark","chapter_comment","reserve_slot","release_slot","xid_links","personal_terms_accept",
"split_slot_group","extend_slot_group","merge_slot_groups","admin_user_role","admin_user_ban","admin_user_notifications",
"admin_user_event_create","admin_event_create","admin_x_icon_refresh","admin_terms_create","admin_terms_update","admin_terms_publish","admin_terms_archive",
"admin_terms_broadcast","admin_moderation_create","admin_moderation_update","admin_announcement_broadcast",
"admin_video_status","admin_api_endpoints","admin_event_templates","admin_permissions","admin_youtube_sync","admin_notifications",
"admin_static_rebuild","admin_video_collab_permissions","admin_legacy_import","admin_spreadsheet","manage_event_update","manage_event_archive",
"manage_slot_create","manage_slot_update","manage_slot_delete","manage_event_staff","manage_video_status",
] as const;
export function parseCostFeatures(raw:string|null):{features:string[];malformed:boolean}{
  if(!raw)return {features:[],malformed:false};
  try{
    const value:unknown=JSON.parse(raw);
    if(!Array.isArray(value)||value.length>100||!value.every(v=>typeof v==="string"&&WRITE_FEATURE_KEYS.some(k=>k===v)))
      return {features:[],malformed:true};
    return {features:[...new Set(value as string[])],malformed:false};
  }catch{return {features:[],malformed:true};}
}

export type WriteFeatureKey=typeof WRITE_FEATURE_KEYS[number];

/** CURRENT src/components/admin/CostGuardDisabledFeaturesForm.tsx FEATURE_LABELS (partial by design). */
export const FEATURE_LABELS: Partial<Record<WriteFeatureKey, string>> = {
  post_video_unslotted: "枠なし作品の投稿",
  post_video_slotted: "枠付き作品の投稿",
  edit_video: "作品の編集",
  like_or_bookmark: "いいね・ブックマーク",
  chapter_comment: "チャプターコメント",
  reserve_slot: "枠の確保",
  release_slot: "枠の解放",
  xid_links: "X ID連携",
  split_slot_group: "連続枠の分割",
  extend_slot_group: "連続枠の拡張",
  merge_slot_groups: "連続枠の結合",
  admin_user_role: "ユーザー権限管理",
  admin_user_ban: "ユーザー停止",
  admin_user_notifications: "通知管理",
  admin_user_event_create: "ユーザーのイベント作成",
  admin_event_create: "イベント作成",
  admin_x_icon_refresh: "Xアイコン再計算",
  admin_terms_create: "規約作成",
  admin_terms_update: "規約更新",
  admin_terms_publish: "規約公開",
  admin_terms_archive: "規約アーカイブ",
  admin_terms_broadcast: "規約通知",
  admin_moderation_create: "モデレーション作成",
  admin_moderation_update: "モデレーション更新",
  admin_announcement_broadcast: "お知らせ配信",
  admin_video_status: "作品ステータス管理",
  admin_api_endpoints: "APIエンドポイント管理",
  admin_event_templates: "イベントテンプレート管理",
  admin_permissions: "権限管理",
  admin_youtube_sync: "YouTube同期",
  admin_notifications: "通知管理（管理者）",
  admin_static_rebuild: "静的データ再生成",
  admin_video_collab_permissions: "合作編集権限",
  admin_legacy_import: "legacy import",
  admin_spreadsheet: "管理スプレッドシート",
  manage_event_update: "イベント更新",
  manage_event_archive: "イベントアーカイブ",
  manage_slot_create: "枠作成",
  manage_slot_update: "枠更新",
  manage_slot_delete: "枠削除",
  manage_event_staff: "イベントスタッフ管理",
  manage_video_status: "作品ステータス（運営）",
};
