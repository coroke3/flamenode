export type EventPermissionKey = "event.basic" | "event.publish" | "event.slots" | "event.members" | "event.questions" | "event.review" | "event.notifications" | "event.public_api" | "event.static_rebuild" | "xid.link_requests";
export type VideoPermissionKey = "video.basics" | "video.descriptions" | "video.credits" | "video.members" | "video.member_chapters" | "video.status" | "video.primary_event" | "video.youtube_id" | "video.identity" | "video.permissions";
export type PermissionKey = EventPermissionKey | VideoPermissionKey;
export type PermissionCategory = "event" | "video" | "xid" | "danger";
export type PermissionDefinition = {
    key: PermissionKey;
    label: string;
    description: string;
    category: PermissionCategory;
    dangerous?: boolean;
    adminOnly?: boolean;
};
export declare const EVENT_PERMISSION_KEYS: readonly EventPermissionKey[];
export declare const VIDEO_PERMISSION_KEYS: readonly VideoPermissionKey[];
export declare const ALL_PERMISSION_KEYS: readonly PermissionKey[];
export declare const DANGEROUS_PERMISSION_KEYS: readonly PermissionKey[];
export declare const PERMISSION_DEFINITIONS: Record<PermissionKey, PermissionDefinition>;
export declare function isDangerousKey(key: PermissionKey): boolean;
export declare function isAdminOnlyKey(key: PermissionKey): boolean;
export declare function isValidPermissionKey(key: string): key is PermissionKey;
//# sourceMappingURL=keys.d.ts.map