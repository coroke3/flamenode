import { expandPermissionAliases } from "../auth/permissions/aliases.js";
const SECTION_KEYS = {
    basic: "event.basic",
    publish: "event.publish",
    questions: "event.questions",
    slots: "event.slots",
};
function sectionAllowed(permissions, requiredKey) {
    return expandPermissionAliases(requiredKey).some((key) => permissions.has(key));
}
/** Site admins edit every event section without a staff assignment. */
export function adminEventEditPermissions() {
    return { basic: true, publish: true, questions: true, slots: true };
}
/**
 * Event staff (manage) edit only the sections their granted permission keys
 * cover, including legacy aliases of each section key.
 */
export function delegatedEventEditPermissions(grantedPermissionKeys) {
    return {
        basic: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.basic),
        publish: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.publish),
        questions: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.questions),
        slots: sectionAllowed(grantedPermissionKeys, SECTION_KEYS.slots),
    };
}
export function hasAnyEventEditPermission(permissions) {
    return (permissions.basic ||
        permissions.publish ||
        permissions.questions ||
        permissions.slots);
}
//# sourceMappingURL=editPermissions.js.map