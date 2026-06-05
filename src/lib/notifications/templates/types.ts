export type DiscordNotificationPayload = {
  content: string;
  embeds?: Array<Record<string, unknown>>;
  video_id?: string;
  event_id?: string;
  url?: string;
};
