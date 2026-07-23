import * as React from "react";

/**
 * OAuth完了ランディング専用。PublicHeader / Footer / CostGuard / onboarding強制を通さない。
 */
export default function AuthCompleteLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
