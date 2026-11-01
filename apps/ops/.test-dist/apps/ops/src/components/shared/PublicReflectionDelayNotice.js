import { jsx as _jsx } from "react/jsx-runtime";
// CURRENT src/lib/staticRebuild/publicReflectionNotice.ts; keep this text byte-identical.
const PUBLIC_REFLECTION_DELAY_MESSAGE = "公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。";
export function PublicReflectionDelayNotice({ className, }) {
    return (_jsx("p", { className: className ?? "fn-muted fn-text-sm", style: { margin: 0 }, children: PUBLIC_REFLECTION_DELAY_MESSAGE }));
}
