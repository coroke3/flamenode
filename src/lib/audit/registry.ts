import {
  RESTORE_ADAPTERS,
  type RegisteredRestoreTableName,
} from "./adapters";
import type {
  RestoreAdapter,
  RestoreStrategy,
} from "./types";

export type RestoreAdapterRegistration = {
  tableName: RegisteredRestoreTableName;
  adapter: RestoreAdapter;
  supportedStrategies: readonly RestoreStrategy[];
  requiredBeforeFields: readonly string[];
  requiredAfterFields: readonly string[];
};

const REGISTRATIONS = {
  events: {
    tableName: "events",
    adapter: RESTORE_ADAPTERS.events,
    supportedStrategies: ["update_before"],
    requiredBeforeFields: ["id"],
    requiredAfterFields: ["id"],
  },
  videos: {
    tableName: "videos",
    adapter: RESTORE_ADAPTERS.videos,
    supportedStrategies: ["update_before"],
    requiredBeforeFields: ["id"],
    requiredAfterFields: ["id"],
  },
  slots: {
    tableName: "slots",
    adapter: RESTORE_ADAPTERS.slots,
    supportedStrategies: [
      "update_before",
      "recreate_deleted",
    ],
    requiredBeforeFields: ["id", "event_id", "version"],
    requiredAfterFields: ["id", "event_id", "version"],
  },
  announcements: {
    tableName: "announcements",
    adapter: RESTORE_ADAPTERS.announcements,
    supportedStrategies: [
      "update_before",
      "recreate_deleted",
    ],
    requiredBeforeFields: ["id"],
    requiredAfterFields: ["id"],
  },
  event_groups: {
    tableName: "event_groups",
    adapter: RESTORE_ADAPTERS.event_groups,
    supportedStrategies: [
      "update_before",
      "recreate_deleted",
    ],
    requiredBeforeFields: ["id"],
    requiredAfterFields: ["id"],
  },
  event_staff: {
    tableName: "event_staff",
    adapter: RESTORE_ADAPTERS.event_staff,
    supportedStrategies: [
      "delete_created",
      "update_before",
      "recreate_deleted",
    ],
    requiredBeforeFields: [
      "id",
      "event_id",
      "permission_preset",
    ],
    requiredAfterFields: [
      "id",
      "event_id",
      "permission_preset",
    ],
  },
  x_identity_requests: {
    tableName: "x_identity_requests",
    adapter: RESTORE_ADAPTERS.x_identity_requests,
    supportedStrategies: [
      "update_before",
      "recreate_deleted",
    ],
    requiredBeforeFields: ["id"],
    requiredAfterFields: ["id"],
  },
  video_members_set: {
    tableName: "video_members_set",
    adapter: RESTORE_ADAPTERS.video_members_set,
    supportedStrategies: ["custom_adapter"],
    requiredBeforeFields: ["id", "rows"],
    requiredAfterFields: ["id", "rows"],
  },
} as const satisfies Record<
  RegisteredRestoreTableName,
  RestoreAdapterRegistration
>;

export function getRestoreRegistration(
  tableName: string,
): RestoreAdapterRegistration | null {
  return Object.prototype.hasOwnProperty.call(
    REGISTRATIONS,
    tableName,
  )
    ? REGISTRATIONS[
        tableName as RegisteredRestoreTableName
      ]
    : null;
}

export function isRegisteredRestoreTable(
  tableName: string,
): tableName is RegisteredRestoreTableName {
  return getRestoreRegistration(tableName) !== null;
}