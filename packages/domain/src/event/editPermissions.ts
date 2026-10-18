import { expandPermissionAliases } from "../auth/permissions/aliases.ts";

export interface EventEditPermissions {
  basic: boolean;
  publish: boolean;
  questions: boolean;
  slots: boolean;
}

const SECTION_KEYS = {
  basic: "event.basic",
  publish: "event.publish",
  questions: "event.questions",
  slots: "event.slots",
} as const;

function sectionAllowed(
  permissions: ReadonlySet<string>,
  requiredKey: string,
): boolean {
  return expandPermissionAliases(requiredKey).some((key) => permissions.has(key));
}

/** Site admins edit every event section without a staff assignment. */
export function adminEventEditPermissions(): EventEditPermissions {
  return { basic: true, publish: true, questions: true, slots: true };
}

/**
 * Event staff (manage) edit only the sections their granted permission keys
 * cover, including legacy aliases of each section key.
 */
export function delegatedEventEditPermissions(
  grantedPermissionKeys: ReadonlySet<string>,
): EventEditPermissions {
  return {
    basic: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.basic),
    publish: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.publish),
    questions: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.questions),
    slots: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.slots),
  };
}

export function hasAnyEventEditPermission(permissions: EventEditPermissions): boolean {
  return (
    permissions.basic ||
    permissions.publish ||
    permissions.questions ||
    permissions.slots
  );
}
