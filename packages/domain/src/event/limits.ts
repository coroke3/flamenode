/** 1作品あたりの連続枠（予約グループ）の業務上限。 */
export const MAX_SLOTS_PER_VIDEO = 3;

/** ステージ・権利確認質問の最大件数。 */
export const MAX_STAGE_PERMISSION_QUESTIONS = 4;

/**
 * 一般カスタム質問の新規追加上限。
 * 投稿保存の `MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS` と揃える。
 * 既存件数がこれを超えるイベントは全件表示し、追加だけ不可にする。
 */
export const MAX_GENERAL_CUSTOM_QUESTIONS = 4;
