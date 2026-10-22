export type EventStaffPreset = "owner" | "manager" | "slot_manager" | "content_editor" | "reviewer" | "xid_reviewer" | "public_staff" | "custom";
export type EventStaffOwnershipRow = {
    id: string;
    event_id: string;
    x_user_id: string;
    permission_preset: string | null;
};
export declare const LAST_OWNER_ERROR = "\u30A4\u30D9\u30F3\u30C8\u306B\u306F\u6700\u4F4E1\u4EBA\u306E\u4EE3\u8868\u8005\u304C\u5FC5\u8981\u3067\u3059\u3002\u5148\u306B\u5225\u306E\u30B9\u30BF\u30C3\u30D5\u3078\u4EE3\u8868\u6A29\u9650\u3092\u79FB\u8B72\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
export declare function isEventOwner(row: Pick<EventStaffOwnershipRow, "permission_preset">): boolean;
export declare function validateEventStaffSubject(input: {
    xUserId: string | null | undefined;
}): void;
export declare function validateEventStaffUniqueness(input: {
    rows: readonly EventStaffOwnershipRow[];
    candidate: Pick<EventStaffOwnershipRow, "id" | "event_id" | "x_user_id">;
}): void;
export declare function assertEventWillRetainOwner(input: {
    owners: readonly EventStaffOwnershipRow[];
    target: EventStaffOwnershipRow;
    nextPreset: EventStaffPreset | null;
}): void;
/**
 * X ID 統合で同一イベントのスタッフ主体が衝突した場合に、source owner の権限を
 * target 行へ移して最後の owner を失わないための計画を返す。
 */
export declare function planXIdMergeEventStaffOwnerProtection(input: {
    rows: readonly EventStaffOwnershipRow[];
    fromXUserId: string;
    toXUserId: string;
}): {
    collidedSourceStaffIds: readonly string[];
    promotedTargetStaffIds: readonly string[];
};
export declare function isActorTargetingSelf(input: {
    target: Pick<EventStaffOwnershipRow, "x_user_id">;
    linkedXIds: readonly string[];
}): boolean;
export declare function assertSelfChangeConfirmation(input: {
    eventId: string;
    isSelfTarget: boolean;
    removesMembership: boolean;
    losesMemberPermission: boolean;
    confirmText: string | null | undefined;
    reason: string | null | undefined;
}): void;
export declare function assertOwnershipTransferInput(input: {
    eventId: string;
    from: EventStaffOwnershipRow | null;
    to: EventStaffOwnershipRow | null;
    confirmText: string | null | undefined;
    reason: string | null | undefined;
}): void;
//# sourceMappingURL=ownership.d.ts.map