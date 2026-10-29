/** CURRENT packages/domain/src/admin/costGuard.ts — contract-first copy, test guards drift until MIG-0637. */
export const WRITE_FEATURE_KEYS=[
"post_video_unslotted","post_video_slotted","edit_video","like_or_bookmark","chapter_comment","reserve_slot","release_slot","xid_links",
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
