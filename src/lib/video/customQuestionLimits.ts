export const MAX_EVENT_CUSTOM_QUESTIONS = 8;

/**
 * 1作品の投稿フォームに同時表示・保存できるカスタム質問数。
 *
 * event_custom_questions / video_custom_answers / 管理画面 / 投稿画面で
 * 同じ値を参照し、画面上限とD1原子保存上限の不一致を防ぐ。
 */
export const MAX_VIDEO_CUSTOM_QUESTIONS = MAX_EVENT_CUSTOM_QUESTIONS;

export const MAX_CUSTOM_QUESTION_OPTIONS = 50;
export const MAX_CUSTOM_QUESTION_LABEL_LENGTH = 120;
export const MAX_CUSTOM_QUESTION_DESCRIPTION_LENGTH = 1000;
export const MAX_CUSTOM_QUESTION_PLACEHOLDER_LENGTH = 500;
export const MAX_CUSTOM_QUESTION_TEXT_LENGTH = 200;
export const MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH = 1000;
