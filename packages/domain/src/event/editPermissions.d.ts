export interface EventEditPermissions {
    basic: boolean;
    publish: boolean;
    questions: boolean;
    slots: boolean;
}
/** Site admins edit every event section without a staff assignment. */
export declare function adminEventEditPermissions(): EventEditPermissions;
/**
 * Event staff (manage) edit only the sections their granted permission keys
 * cover, including legacy aliases of each section key.
 */
export declare function delegatedEventEditPermissions(grantedPermissionKeys: ReadonlySet<string>): EventEditPermissions;
export declare function hasAnyEventEditPermission(permissions: EventEditPermissions): boolean;
//# sourceMappingURL=editPermissions.d.ts.map