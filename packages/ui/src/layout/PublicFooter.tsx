import React from "react";
import { Link } from "../adapters/index.js";

export interface PublicFooterProps {
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function PublicFooter({
  className,
}: PublicFooterProps = {}): React.ReactElement {
  const currentYear = 2026;

  return (
    <footer className={cx("fn-footer", "fn-public-footer", className)} lang="ja">
      <div className="fn-footer-container">
        <div className="fn-footer-brand">
          <Link href="/" className="fn-footer-logo" aria-label="FlameNode トップ">
            <span>FlameNode</span>
          </Link>
          <span className="fn-footer-copy">© {currentYear} FlameNode</span>
        </div>

        <div className="fn-footer-nav-grid">
          <nav className="fn-footer-col" aria-label="見る">
            <Link href="/list" className="fn-footer-link">作品一覧</Link>
            <Link href="/recommend" className="fn-footer-link">おすすめ</Link>
            <Link href="/user" className="fn-footer-link">クリエイター</Link>
            <Link href="/event" className="fn-footer-link">イベント一覧</Link>
          </nav>

          <nav className="fn-footer-col" aria-label="参加する">
            <Link href="/entry" className="fn-footer-link">投稿する</Link>
            <Link href="/dashboard" className="fn-footer-link">ダッシュボード</Link>
            <Link href="/entry" className="fn-footer-link">ログイン / 新規登録</Link>
            <Link href="/rules#event-host" className="fn-footer-link">イベント開催相談</Link>
          </nav>

          <nav className="fn-footer-col" aria-label="FlameNode">
            <Link href="/about" className="fn-footer-link">FlameNode について</Link>
            <Link href="/rules" className="fn-footer-link">利用規約</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
