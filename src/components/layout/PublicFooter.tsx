import * as React from "react";
import styles from "./PublicFooter.module.css";
import { Logo } from "@/components/ui/Logo";

export function PublicFooter(): React.ReactElement {
  return (
    <footer className="fn-footer">
      <div className={`fn-public-container fn-footer-top ${styles.main}`}>
        <div className={`fn-footer-brand ${styles.brand}`}>
          <div className="fn-footer-logo-row">
            <Logo showSub />
          </div>
          <p className={`fn-footer-tag fn-jp ${styles.tagline}`}>
            映像（フレーム）の結節点（ノード）。YouTube 埋め込みを利用した動画プラットフォーム。
            イベント参加手続きと第三者イベント開催を一体で扱います。
          </p>
        </div>

        <div className="fn-footer-cols">
        <FooterColumn
          title="Explore"
          items={[
            { label: "作品一覧", href: "/list" },
            { label: "おすすめ", href: "/recommend" },
            { label: "クリエイター", href: "/user" },
            { label: "FlameNode について", href: "/about" },
          ]}
        />
        <FooterColumn
          title="Event"
          items={[
            { label: "イベント一覧", href: "/event" },
            { label: "投稿する", href: "/entry" },
            { label: "ダッシュボード", href: "/dashboard" },
          ]}
        />
        <FooterColumn
          title="Guide"
          items={[
            { label: "利用規約", href: "/rules" },
            { label: "イベント開催相談", href: "/rules#event-host" },
            { label: "ログイン / 新規登録", href: "/entry" },
            { label: "問い合わせ", href: "/rules#contact" },
          ]}
        />
        </div>
      </div>

      <div className="fn-footer-bottom">
        <div className={`fn-public-container ${styles.legalInner}`}>
          <span>© {new Date().getFullYear()} FlameNode</span>
          <span>Built on Cloudflare D1 / R2 / KV / Workers</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}): React.ReactElement {
  return (
    <div className={styles.column}>
      <h3 className={styles.columnTitle}>{title}</h3>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
