import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Port of CURRENT src/components/ui/TableScroll.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";
import { cn } from "./cn.js";
/**
 * 幅の広い表を横スクロールさせるラッパ。
 * 左右フェードはスクロール位置に応じて表示する（軽量な scroll / resize のみ）。
 */
export function TableScroll({ className, children, label = "横にスクロールして全体を表示できます", }) {
    const ref = React.useRef(null);
    const [canPrev, setCanPrev] = React.useState(false);
    const [canNext, setCanNext] = React.useState(false);
    const update = React.useCallback(() => {
        const el = ref.current;
        if (!el)
            return;
        const scrollable = el.scrollWidth > el.clientWidth + 2;
        setCanPrev(scrollable && el.scrollLeft > 2);
        setCanNext(scrollable && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    }, []);
    React.useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        update();
        el.addEventListener("scroll", update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => {
            el.removeEventListener("scroll", update);
            observer.disconnect();
        };
    }, [update]);
    return (_jsxs("div", { className: cn("fn-hscroll-surface", className), children: [_jsx("p", { className: "fn-sr-only", children: label }), _jsx("div", { ref: ref, className: cn("fn-table-scroll fn-scroll-affordance", canPrev && "is-scroll-back", canNext && "is-scroll-forward"), children: children }), _jsx("div", { "aria-hidden": true, className: cn("fn-hscroll-fade-left", canPrev && "is-visible") }), _jsx("div", { "aria-hidden": true, className: cn("fn-hscroll-fade-right", canNext && "is-visible") })] }));
}
