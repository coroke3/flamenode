/**
 * MIG-0652 U01 — pure CURRENT event "basic" section update projection.
 *
 * Extracted from src/lib/event/eventPayload.ts#buildEventUpdatePayload.
 * Keep the existing host Zod validation and FormData field-presence policy
 * without bringing Next, Drizzle or a D1 adapter into the domain module.
 */
import { parseDateInput } from "./dateValidation.ts";

export type BasicEventUpdateInput = {
  title: string;
  event_type: "event" | "collabo" | "type" | "other";
  explanation?: string | null;
  youtube_description_template?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
  accent_color?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

export function buildBasicEventUpdateFields(input: {
  data: BasicEventUpdateInput;
  previousYoutubeDescriptionTemplate: string | null;
  hasYoutubeDescriptionTemplateField: boolean;
}) {
  const { data } = input;
  return {
    title: data.title,
    event_type: data.event_type,
    explanation: data.explanation ?? null,
    youtube_description_template: input.hasYoutubeDescriptionTemplateField
      ? data.youtube_description_template ?? null
      : input.previousYoutubeDescriptionTemplate,
    icon_url: data.icon_url ?? null,
    img_url: data.img_url ?? null,
    accent_color: data.accent_color ?? null,
    start_time: parseDateInput(data.start_time),
    end_time: parseDateInput(data.end_time),
  };
}
