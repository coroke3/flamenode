import * as React from "react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page" style={{ paddingBlock: "48px 64px" }}>
      <EmptyState
        title="ページが見つかりません"
        description="URL を確認するか、トップページから再度お探しください。"
        iconName="info"
        tone="neutral"
        actions={[{ href: "/", label: "トップへ戻る", variant: "primary" }]}
      />
    </div>
  );
}
