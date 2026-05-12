import * as React from "react";
import Link from "next/link";
import styles from "./PublicFooter.module.css";
import { Logo } from "@/components/ui/Logo";

export function PublicFooter(): React.ReactElement {
  return (
    <footer className={styles.footer}>
      <div className={styles.main}>
        <div className={styles.brand}>
          <Logo />
          <p className={styles.tagline}>
            映像（フレーム）の結節点（ノード）。YouTube 埋め込みを利用した動画プラットフォーム。
            イベント参加手続きと第三者イベント開催を一体で扱います。
          </p>
        </div>

        <FooterColumn
          title="プラットフォーム"
          items={[
            { label: "作品一覧", href: "/list" },
            { label: "イベント", href: "/event" },
            { label: "クリエイター", href: "/recommend" },
            { label: "FlameNode について", href: "/about" },
          ]}
        />
        <FooterColumn
          title="アカウント"
          items={[
            {
              label: "ログイン / 新規登録",
              href: "/api/auth/signin/discord?callbackUrl=/dashboard",
            },
            { label: "ダッシュボード", href: "/dashboard" },
            { label: "X ID 連携", href: "/dashboard/settings" },
          ]}
        />
        <FooterColumn
          title="ガイド"
          items={[
            { label: "利用規約", href: "/rules" },
            { label: "イベント開催相談", href: "/rules#event-host" },
            { label: "問い合わせ", href: "/rules#contact" },
          ]}
        />
      </div>

      <div className={styles.legal}>
        <div className={styles.legalInner}>
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
            <Link href={item.href}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
