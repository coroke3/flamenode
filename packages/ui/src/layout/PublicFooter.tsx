import React from "react";
import { Link } from "../adapters/index.js";

/**
 * Public footer from the registered mock (`boards/PublicFooter.dc.html`, class `pub-foot`,
 * styles in `styles/layout.css`). Links are CURRENT `src/components/layout/PublicFooter.tsx`'s,
 * grouped as in the mock.
 */
export interface PublicFooterProps {
  className?: string;
  /** Copyright year; CURRENT uses the current year (`new Date().getFullYear()`). */
  year?: number;
}

const FOOTER_COLUMNS = [
  {
    label: "見る",
    links: [
      { href: "/list", label: "作品一覧" },
      { href: "/recommend", label: "おすすめ" },
      { href: "/user", label: "クリエイター" },
      { href: "/event", label: "イベント一覧" },
    ],
  },
  {
    label: "参加する",
    links: [
      { href: "/entry", label: "投稿する" },
      { href: "/dashboard", label: "ダッシュボード" },
      { href: "/entry", label: "ログイン / 新規登録" },
      { href: "/rules#event-host", label: "イベント開催相談" },
    ],
  },
  {
    label: "FlameNode",
    links: [
      { href: "/about", label: "FlameNode について" },
      { href: "/rules", label: "利用規約" },
    ],
  },
] as const;

export function PublicFooter({
  className,
  year = new Date().getFullYear(),
}: PublicFooterProps = {}): React.ReactElement {
  return (
    <footer className={["pub-foot", className].filter(Boolean).join(" ")} lang="ja">
      <div className="pub-foot-brand">
        <Link href="/" className="pub-foot-logo" aria-label="FlameNode トップへ">
          <span>FlameNode</span>
        </Link>
        <span className="pub-foot-copy">© {year} FlameNode</span>
      </div>
      {FOOTER_COLUMNS.map((column) => (
        <nav key={column.label} aria-label={column.label}>
          {column.links.map((link) => (
            <Link key={link.label} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      ))}
    </footer>
  );
}
