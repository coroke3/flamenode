/**
 * 画面・ドメイン上の最大件数。
 *
 * D1のatomic query上限とは分離する。
 * メンバーはJSON1を利用した一括INSERTにより、人数分のqueryを生成しない。
 */
export const MAX_VIDEO_MEMBERS = 100;

export const MAX_ATOMIC_VIDEO_SOFTWARES = 4;
export const MAX_ATOMIC_VIDEO_EVENTS = 4;
export const MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS = 4;
export const MAX_ATOMIC_SUBMITTED_SLOTS = 3;
