import { youtubeThumbUrl } from "@/lib/youtube/id";

export type HomeFeatureVideo = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url?: string | null;
  creator_id?: string | null;
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

export function uniqueHomeVideos(items: HomeFeatureVideo[]): HomeFeatureVideo[] {
  const seen = new Set<string>();
  const videos: HomeFeatureVideo[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    videos.push(item);
  }

  return videos;
}

export function videoHref(video?: HomeFeatureVideo): string {
  if (!video) return "/recommend";
  return `/${video.youtube_video_id ?? video.id}`;
}

export function videoThumb(video?: HomeFeatureVideo): string | null {
  if (!video?.youtube_video_id) return null;
  return youtubeThumbUrl(video.youtube_video_id, "hqdefault");
}
