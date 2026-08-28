/**
 * 画面・ドメイン上の公開メンバー最大件数。
 *
 * D1のatomic query上限とは分離する。
 * メンバーはJSON1を利用した一括INSERTにより、人数分のqueryを生成しない。
 */
export const MAX_VIDEO_MEMBERS = 100;

/**
 * 作品ページに表示しない編集者専用行の上限。
 * 公開メンバー100人とは別枠にする。video_members共通テーブル上では
 * public 100 + hidden 100 を安全な最大集合として扱う。
 */
export const MAX_VIDEO_HIDDEN_EDITORS = 100;

/**
 * TSV権限列の一括反映は1リクエストあたりこの件数まで。
 * members_json経由ではなく専用batch Server Actionだけが権限を変更できる。
 * permission actionはJSON1 bulk mutationを使い、人数分のD1 statementを生成しない。
 */
export const MAX_COLLABORATOR_PERMISSION_BATCH = 100;

export const MAX_ATOMIC_VIDEO_SOFTWARES = 4;
export const MAX_ATOMIC_VIDEO_EVENTS = 4;
export const MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS = 4;
export { MAX_STAGE_PERMISSION_QUESTIONS } from "../event/eventLimits.ts";
