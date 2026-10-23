export interface VideoAuditSnapshot {
  title: string | null;
  youtube_video_id: string | null;
  creator_x_user_id: string | null;
  display_name: string | null;
  icon_url: string | null;
  music: string | null;
  music_reference_url: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  used_software: string | null;
  closing_comment: string | null;
  collaboration_type: string | null;
  part: string | null;
}

export interface VideoAuditSource {
  title: string | null;
  youtube_video_id: string | null;
  creator_x_user_id: string | null;
  creator_display_name: string | null;
  creator_icon_url: string | null;
  music: string | null;
  music_reference_url: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  closing_comment: string | null;
  collaboration_type: string | null;
  part: string | null;
}

/** DB 非依存の監査スナップショット生成。 */
export function buildVideoAuditSnapshot(
  video: VideoAuditSource,
  overrides?: Partial<VideoAuditSnapshot> & { used_software?: string | null },
  fallbackSoftwareLabel?: string | null,
): VideoAuditSnapshot {
  const merged = overrides ? { ...video, ...overrides } : video;
  return {
    title: merged.title,
    youtube_video_id: merged.youtube_video_id,
    creator_x_user_id: merged.creator_x_user_id,
    display_name: merged.creator_display_name,
    icon_url: merged.creator_icon_url,
    music: merged.music,
    music_reference_url: merged.music_reference_url,
    credit: merged.credit,
    intro_comment: merged.intro_comment,
    highlights: merged.highlights,
    production_story: merged.production_story,
    used_software: overrides?.used_software ?? fallbackSoftwareLabel ?? null,
    closing_comment: merged.closing_comment,
    collaboration_type: merged.collaboration_type,
    part: merged.part,
  };
}
