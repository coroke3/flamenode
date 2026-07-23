"use client";

import * as React from "react";
import Link from "next/link";

export default function RulesError({
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
        <span className="fn-eyebrow">RULES</span>
        <h1 className="fn-page-title">利用規約画面で問題が発生しました</h1>
      </header>
      <section className="fn-entry-status fn-entry-status--warn" role="alert">
        <div>
          <p className="fn-jp fn-entry-status-lead">
            同意の保存が完了している可能性があります。再読み込みで状態を確認してください。
            未保存なら、もう一度同意ボタンからやり直せます。
          </p>
          <p className="fn-mono fn-text-muted-sm">trace: {shortTrace}</p>
          <div className="fn-panel-actions" style={{ marginTop: 12 }}>
            <button type="button" className="fn-btn fn-btn-primary" onClick={reset}>
              再読み込み
            </button>
            <Link href="/rules" className="fn-btn">
              利用規約へ戻る
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
