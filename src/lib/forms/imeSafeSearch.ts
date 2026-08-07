/**
 * 公開検索フォームの IME / Enter 判定（DOM 非依存）。
 */

/** ImeSafeGetForm が composition 中に form へ付与する属性名 */
export const IME_COMPOSING_FORM_ATTR = "data-fn-ime-composing";

export function isImeComposingForm(form: {
  hasAttribute(name: string): boolean;
}): boolean {
  return form.hasAttribute(IME_COMPOSING_FORM_ATTR);
}

export type SearchKeyGuardInput = {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  /** Windows IME 変換中の補助（Enter 確定キーが 229 になる場合） */
  keyCode?: number;
  /** compositionstart〜compositionend(+microtask) 中 */
  isCompositionSession?: boolean;
};

/** 変換中の Enter / Shift+Enter は検索せず、IME 確定を優先する。 */
export function shouldBlockSearchKeySubmit(input: SearchKeyGuardInput): boolean {
  if (input.key !== "Enter") return false;
  if (input.isCompositionSession) return true;
  if (input.isComposing) return true;
  if (input.keyCode === 229) return true;
  return false;
}

/** submit イベント時点で composition session が残っていれば検索を抑止。 */
export function shouldBlockSearchFormSubmit(input: {
  isCompositionSession?: boolean;
}): boolean {
  return Boolean(input.isCompositionSession);
}
