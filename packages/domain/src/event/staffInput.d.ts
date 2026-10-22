/**
 * Parses the comma-separated custom permission keys of an event staff form.
 * Unknown keys reject the whole input (no silent drop); duplicates collapse.
 * Admin-only key filtering happens later, with the actor's role.
 */
export declare function parseEventStaffPermissionKeys(raw: string | null | undefined): string[];
//# sourceMappingURL=staffInput.d.ts.map