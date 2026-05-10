import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "メンテナンス中" };

export default function MaintenancePage(): React.ReactElement {
  return (
    <div
      style={{
        width: "min(96%, 720px)",
        margin: "60px auto",
        padding: "48px 28px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        textAlign: "center",
      }}
    >
      <Icon name="warning" size={36} className="fn-warning" aria-hidden />
      <h1
        style={{
          marginTop: 14,
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        メンテナンス中
      </h1>
      <p style={{ marginTop: 12, color: "var(--text-secondary)", fontSize: 14 }}>
        FlameNode は現在メンテナンスを実施しています。
        <br />
        ご迷惑をおかけしますが、しばらくお待ちください。
      </p>
      <p style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 12 }}>
        Cloudflare コストガード機能により、書き込み操作が一時的に停止される場合があります。
        閲覧のみは静的 JSON で継続提供します。
      </p>
      <div style={{ marginTop: 24 }}>
        <Link href="/" className="fn-btn fn-btn-primary">
          トップへ戻る
        </Link>
      </div>
    </div>
  );
}
