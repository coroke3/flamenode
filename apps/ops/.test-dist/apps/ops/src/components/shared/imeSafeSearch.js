// Port of CURRENT src/lib/forms/imeSafeSearch.ts (MIG-0707 U05, D-17-6). Same output.
/**
 * 公開検索フォームの IME / Enter 判定（DOM 非依存）。
 */
/** ImeSafeGetForm が composition 中に form へ付与する属性名 */
export const IME_COMPOSING_FORM_ATTR = "data-fn-ime-composing";
export function isImeComposingForm(form) {
    return form.hasAttribute(IME_COMPOSING_FORM_ATTR);
}
/** 変換中の Enter / Shift+Enter は検索せず、IME 確定を優先する。 */
export function shouldBlockSearchKeySubmit(input) {
    if (input.key !== "Enter")
        return false;
    if (input.isCompositionSession)
        return true;
    if (input.isComposing)
        return true;
    if (input.keyCode === 229)
        return true;
    return false;
}
/** submit イベント時点で composition session が残っていれば検索を抑止。 */
export function shouldBlockSearchFormSubmit(input) {
    return Boolean(input.isCompositionSession);
}
