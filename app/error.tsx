"use client";

import * as React from "react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="fn-public-container fn-page" style={{ paddingBlock: "48px 64px" }}>
      <EmptyState
        title="問題が発生しました"
        description="読み込みに失敗しました。再試行するか、しばらくしてからお戻りください。"
        iconName="alert"
        tone="danger"
        actions={[{ href: "/", label: "トップへ戻る", variant: "ghost" }]}
      />
      <div style={{ marginTop: 16 }}>
        <button type="button" className="fn-btn fn-btn-primary" onClick={reset}>
          再試行
        </button>
      </div>
    </div>
  );
}
