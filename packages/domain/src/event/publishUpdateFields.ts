/**
 * MIG-0652 U01: pure projection of CURRENT event "publish" section fields.
 * The CURRENT adapter resolves submitted visibility before this core call;
 * final form validation, section access and DB visibility fencing stay there.
 */
import { parseDateInput } from "./dateValidation.ts";

export type PublishEventUpdateInput = {
  entry_start_time?: string | null;
  entry_end_time?: string | null;
  allow_user_video_event_links: number;
  allow_unslotted_posts: number;
};

export function buildPublishEventUpdateFields(input: {
  data: PublishEventUpdateInput;
  visibilityStatus: "private" | "public";
}) {
  return {
    visibility_status: input.visibilityStatus,
    entry_start_time: parseDateInput(input.data.entry_start_time),
    entry_end_time: parseDateInput(input.data.entry_end_time),
    allow_user_video_event_links: input.data.allow_user_video_event_links,
    allow_unslotted_posts: input.data.allow_unslotted_posts,
  };
}
