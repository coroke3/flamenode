import * as React from "react";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div data-fn-surface="public" className="fn-public-shell fn-app">
      <PublicHeader />
      <main className="fn-main flex-1 w-full">{children}</main>
      <PublicFooter />
    </div>
  );
}
