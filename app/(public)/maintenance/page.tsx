import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  path: "/maintenance",
  title: "メンテナンス中",
  noIndex: true,
});

export default function MaintenancePage(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-status-panel fn-status-panel--center">
        <Icon name="warning" size={36} className="fn-warning" aria-hidden />
        <h1 className="fn-status-panel-title">メンテナンス中</h1>
        <p className="fn-status-panel-lead">
          FlameNode は現在メンテナンスを実施しています。
          <br />
          ご迷惑をおかけしますが、しばらくお待ちください。
        </p>
        <p className="fn-status-panel-note">
          Cloudflare コストガード機能により、書き込み操作が一時的に停止される場合があります。
          閲覧のみは静的 JSON で継続提供します。
        </p>
        <div className="fn-panel-actions">
          <Link href="/" className="fn-btn fn-btn-primary">
            トップへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
