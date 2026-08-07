/** D1 Free の bind/query 上限内で一操作を原子的に扱える最大 slot 行数（内部 chunk）。
 * 1作品の予約グループ上限ではない。業務上限は `limits.ts` の MAX_SLOTS_PER_VIDEO。 */
export const MAX_ATOMIC_SLOT_ROWS = 3;

/** 管理画面の枠一括生成で一度に要求できる最大件数（内部で chunk 実行）。 */
export const MAX_SLOT_BATCH_GENERATE_COUNT = 100;
