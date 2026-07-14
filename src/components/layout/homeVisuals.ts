

export type HomeFeatureVideo = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url?: string | null;
  creator_x_user_id?: string | null;
  primary_event_id?: string | null;
  scheduled_time?: number | null;
  status?: string | null;
};

export type HomeStats = {
  publicVideos: number;
  activeEvents: number;
  creators: number;
};

export function formatHomeNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}