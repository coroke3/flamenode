import { jsx as _jsx } from "react/jsx-runtime";
import { isImeComposingForm } from "./imeSafeSearch.js";
import { submitFormCompat } from "./submitFormCompat.js";
/** GET フォームをクエリ付き URL へ遷移（React 19 の form 検知を避ける） */
export function navigateGetForm(form) {
    const method = (form.getAttribute("method") ?? "get").toLowerCase();
    if (method !== "get") {
        submitFormCompat(form);
        return;
    }
    const action = form.getAttribute("action")?.trim();
    const url = new URL(action || window.location.pathname, window.location.origin);
    url.search = "";
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
        if (typeof value === "string") {
            url.searchParams.append(key, value);
        }
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
        window.location.assign(next);
    }
}
function submitParentForm(e) {
    const form = e.currentTarget.form;
    if (!form)
        return;
    if (isImeComposingForm(form))
        return;
    navigateGetForm(form);
}
/** GET フォーム内で選択変更時に即 submit する select */
export function AutoSubmitSelect({ children, onChange, ...props }) {
    return (_jsx("select", { ...props, onChange: (e) => {
            onChange?.(e);
            submitParentForm(e);
        }, children: children }));
}
/** GET フォーム内でチェック変更時に即 submit する checkbox */
export function AutoSubmitCheckbox({ onChange, ...props }) {
    return (_jsx("input", { type: "checkbox", ...props, onChange: (e) => {
            onChange?.(e);
            submitParentForm(e);
        } }));
}
