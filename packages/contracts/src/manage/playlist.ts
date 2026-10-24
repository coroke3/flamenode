import { z } from "zod";

// CURRENT: app/(manage)/manage/events/[id]/youtube-playlist/page.tsx

export const ManagePlaylistResponseSchema = z.object({
  isAdmin: z.boolean(),
  event: z.object({ id: z.string(), title: z.string(), accent_color: z.string().nullable() }),
  pendingCount: z.number(),
  /** event.publish */
  canEdit: z.boolean(),
  activeXUserId: z.string().nullable(),
  manageStaffXUserIds: z.array(z.string()),
  /** The rendered columns of event_youtube_playlist_sync; null when no config row exists. */
  config: z
    .object({
      playlist_id: z.string().nullable(),
      enabled: z.number(),
      sync_mode: z.string().nullable(),
      sync_interval_minutes: z.number().nullable(),
      sync_status: z.string().nullable(),
      next_sync_at: z.number().nullable(),
      last_synced_at: z.number().nullable(),
      last_full_scan_at: z.number().nullable(),
      last_error: z.string().nullable(),
    })
    .nullable(),
  counts: z.object({ linked: z.number(), eligible: z.number(), synced: z.number() }),
  syncHealth: z.object({ level: z.string(), reason: z.string(), priority: z.number() }),
});

export type ManagePlaylistResponse = z.infer<typeof ManagePlaylistResponseSchema>;
