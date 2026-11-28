/** MIG-0657 U01f — shared membership checks for a bounded reservation group.
 * DB load, group ID lookup, sorting, status/CAS, audit and authorization
 * are deliberately outside this pure helper. Preserve CURRENT's error text.
 */
export function assertBoundedSlotGroupIntegrity<
  Row extends {
    id: string;
    event_id: string;
    reserved_by_user_id: string | null;
    reserved_x_id_snapshot: string | null;
  },
>(rows: readonly Row[], anchor: Row, maxRows: number): void {
  if (rows.length > maxRows) {
    throw new Error(
      `連続枠が上限 ${maxRows} 件を超えています。運営へ連絡してください。`,
    );
  }
  if (rows.length === 0 || !rows.some((row) => row.id === anchor.id)) {
    throw new Error("連続枠の完全な状態を確認できませんでした。");
  }
  if (
    rows.some(
      (row) =>
        row.event_id !== anchor.event_id ||
        row.reserved_by_user_id !== anchor.reserved_by_user_id ||
        row.reserved_x_id_snapshot !== anchor.reserved_x_id_snapshot,
    )
  ) {
    throw new Error("連続枠に別の利用者または状態が混在しています。");
  }
}
