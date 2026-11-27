// MIG-0652 compatibility bridge: exact canonical event form parsing.
export {
  eventSchema,
  EVENT_ID_PATTERN,
  buildPartsJson,
  resolveSubmittedEventVisibility,
  buildVideoFormSettingsJson,
  parseEventForm,
} from "@flamenode/domain/event/form";
export type { EventFormData } from "@flamenode/domain/event/form";
