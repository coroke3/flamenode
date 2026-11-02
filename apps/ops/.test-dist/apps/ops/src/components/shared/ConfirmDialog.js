import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Port of CURRENT src/components/ui/ConfirmDialog.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";
export function ConfirmDialog({ open, title, message, expectedText, inputLabel = "確認のため次の文字列を入力してください", confirmLabel = "確認", cancelLabel = "キャンセル", tone = "default", busy = false, onConfirm, onCancel, }) {
    const [input, setInput] = React.useState("");
    const titleId = React.useId();
    const messageId = React.useId();
    const requiresText = expectedText !== undefined;
    const canConfirm = !requiresText || input.trim() === expectedText;
    React.useEffect(() => {
        if (open)
            setInput("");
    }, [open, expectedText]);
    React.useEffect(() => {
        if (!open)
            return;
        const handleKeyDown = (event) => {
            if (event.key === "Escape" && !busy) {
                onCancel();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [busy, onCancel, open]);
    if (!open)
        return null;
    const confirmClassName = tone === "danger" ? "fn-btn fn-btn-danger" : "fn-btn fn-btn-primary";
    return (_jsx("div", { className: "confirm-backdrop", role: "presentation", onClick: (event) => {
            if (!busy && event.target === event.currentTarget) {
                onCancel();
            }
        }, children: _jsxs("div", { className: "confirm-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": message ? messageId : undefined, children: [_jsxs("div", { className: "confirm-body", children: [_jsx("p", { id: titleId, className: "confirm-title", children: title }), message ? (_jsx("div", { id: messageId, className: "confirm-message", children: message })) : null, requiresText ? (_jsxs("label", { className: "confirm-confirmation", children: [_jsxs("span", { className: "confirm-confirmationLabel", children: [inputLabel, ": ", _jsx("code", { children: expectedText })] }), _jsx("input", { type: "text", className: "fn-input", value: input, onChange: (event) => setInput(event.target.value), placeholder: expectedText, autoComplete: "off", spellCheck: false, disabled: busy, 
                                    // eslint-disable-next-line jsx-a11y/no-autofocus
                                    autoFocus: true, onKeyDown: (event) => {
                                        if (event.key === "Enter" && canConfirm && !busy) {
                                            event.preventDefault();
                                            onConfirm();
                                        }
                                    } })] })) : null] }), _jsxs("div", { className: "confirm-footer", children: [_jsx("button", { type: "button", className: "fn-btn fn-btn-ghost", onClick: onCancel, disabled: busy, children: cancelLabel }), _jsx("button", { type: "button", className: confirmClassName, onClick: onConfirm, disabled: busy || !canConfirm, autoFocus: !requiresText, children: busy ? "処理中…" : confirmLabel })] })] }) }));
}
