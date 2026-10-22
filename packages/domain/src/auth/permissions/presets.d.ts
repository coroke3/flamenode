import type { PermissionKey } from "./keys.ts";
export declare const EVENT_STAFF_PRESETS: readonly ["owner", "manager", "slot_manager", "content_editor", "reviewer", "xid_reviewer", "public_staff", "custom"];
export type EventStaffPreset = (typeof EVENT_STAFF_PRESETS)[number];
export type PresetDefinition = {
    label: string;
    description: string;
    permissions: readonly PermissionKey[];
};
export declare const PRESET_DEFINITIONS: Record<EventStaffPreset, PresetDefinition>;
export declare function isEventStaffPreset(value: unknown): value is EventStaffPreset;
export declare function getPresetPermissions(preset: EventStaffPreset): PermissionKey[];
//# sourceMappingURL=presets.d.ts.map