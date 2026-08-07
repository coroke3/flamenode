"use client";

import * as React from "react";
import Link from "next/link";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  const shortTrace = (error.digest ?? "unknown").slice(0, 12);
  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <span className="fn-eyebrow">error</span>
        <h1 className="fn-display fn-page-title">画面の表示中に問題が発生しました</h1>
      </header>
      <section className="fn-entry-status fn-entry-status--warn" role="alert">
        <div>
          <p className="fn-jp fn-entry-status-lead">
            表示前の取得に失敗したか、保存後の画面描画で失敗した可能性があります。
            再送しても安全な操作もあります。まず再読み込みしてください。
          </p>
          <p className="fn-mono fn-text-muted-sm">trace: {shortTrace}</p>
          <div className="fn-panel-actions" style={{ marginTop: 12 }}>
            <button type="button" className="fn-btn fn-btn-primary" onClick={reset}>
              再読み込み
            </button>
            <Link href="/entry" className="fn-btn">
              ログイン画面
            </Link>
            <Link href="/onboarding" className="fn-btn">
              オンボーディング
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
