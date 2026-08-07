import {
  MAX_SLOTS_PER_VIDEO,
  MAX_STAGE_PERMISSION_QUESTIONS,
} from "../event/eventLimits.ts";

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
/** @deprecated 業務上限ではない。提出のグループ上限は `MAX_SLOTS_PER_VIDEO`。残置は互換用。 */
export const MAX_ATOMIC_SUBMITTED_SLOTS = 3;
export { MAX_STAGE_PERMISSION_QUESTIONS } from "../event/eventLimits.ts";
