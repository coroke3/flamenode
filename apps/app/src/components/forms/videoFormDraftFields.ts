// MIG-0714 part A: CURRENT VideoForm draft field permissions (UI only).
// Ported without changing field keys or defaults; server authorization remains independent.
/** section key が disabledSections に含まれているか確認する小関数。 */
export function isSectionDisabled(
  disabledSections: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledSections) && disabledSections.includes(key);
}

export function isFieldDisabled(
  disabledFields: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledFields) && disabledFields.includes(key);
}

export function canRestoreDraftField(
  name: string,
  disabledSections: string[] | undefined,
  disabledFields: string[] | undefined,
): boolean {
  const permissionByName: Record<string, { section?: string; field?: string }> = {
    display_name: { section: "submitter", field: "submitter.display_name" },
    profile_text: { section: "submitter", field: "submitter.profile_text" },
    icon_url: { section: "submitter", field: "submitter.icon_url" },
    youtube_channel_url: {
      section: "submitter",
      field: "submitter.youtube_channel_url",
    },
    other_social_links: {
      section: "submitter",
      field: "submitter.other_social_links",
    },
    title: { section: "video", field: "video.title" },
    scheduled_time: { section: "video", field: "video.scheduled_time" },
    music: { section: "video", field: "video.music" },
    music_reference_url: { section: "video", field: "video.music_reference_url" },
    credit: { section: "video", field: "video.credit" },
    youtube_url: { section: "video", field: "video.youtube_url" },
    part: { section: "video", field: "video.part" },
    intro_comment: { section: "descriptions", field: "descriptions.intro_comment" },
    highlights: { section: "descriptions", field: "descriptions.highlights" },
    production_story: {
      section: "descriptions",
      field: "descriptions.production_story",
    },
    used_software: { section: "descriptions", field: "descriptions.used_software" },
    closing_comment: { section: "descriptions", field: "descriptions.closing_comment" },
    event_ids: { field: "event_ids" },
    is_collab: { section: "members", field: "members.is_collab" },
    members: { section: "members", field: "members" },
    chapters: { section: "members", field: "chapters" },
    custom_answers: { section: "descriptions", field: "descriptions.custom_answers" },
    stage_permission: {
      section: "descriptions",
      field: "descriptions.stage_permission",
    },
  };
  const permission = permissionByName[name];
  if (!permission) return true;
  return !(
    (permission.section && isSectionDisabled(disabledSections, permission.section)) ||
    (permission.field && isFieldDisabled(disabledFields, permission.field))
  );
}
