// Port of CURRENT src/components/ui/PublicReflectionDelayNotice.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";
// CURRENT src/lib/staticRebuild/publicReflectionNotice.ts; keep this text byte-identical.
const PUBLIC_REFLECTION_DELAY_MESSAGE =
  "公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。";

export function PublicReflectionDelayNotice({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <p
      className={className ?? "fn-muted fn-text-sm"}
      style={{ margin: 0 }}
    >
      {PUBLIC_REFLECTION_DELAY_MESSAGE}
    </p>
  );
}
