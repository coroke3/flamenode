import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "FlameNode について" };

const FEATURES = [
  {
    title: "作品とイベントを同じ文脈で見る",
    body: "投稿された作品、参加イベント、枠、メンバー、チャプターコメントをばらばらにせず、作品を中心にたどれるようにします。",
    icon: "grid" as const,
  },
  {
    title: "XIDを表の名前にする",
    body: "Discordはログインと権限確認の入口、XIDは公開プロフィールや作品の名義として扱います。連携前のデータも後から整理できます。",
    icon: "user" as const,
  },
  {
    title: "運営と投稿者の作業を軽くする",
    body: "枠確保、提出、CSVインポート、履歴確認、権限付与を同じ管理線上に置き、イベント後の確認まで迷いにくくします。",
    icon: "settings" as const,
  },
];

const FLOW = [
  "Discordでログイン",
  "XIDとプロフィールを確認",
  "イベント枠または通常投稿を選択",
  "作品・メンバー・SNS情報を提出",
  "公開後に再生リストや個人ページからたどる",
];

const LIST_HREF = "/list";

export default function AboutPage(): React.ReactElement {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.motionLines} aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.heroInner}>
          <Logo showText={false} className={styles.logo} />
          <p className={styles.kicker}>Creator archive and event workflow</p>
          <h1>FlameNode</h1>
          <p className={styles.lead}>
            FlameNodeは、YouTube作品、クリエイター名義、イベント参加、投稿枠、履歴をひとつの流れで扱うためのプラットフォームです。
            作品を見つける人にも、投稿する人にも、運営する人にも、同じ情報が同じ意味で届くことを目指しています。
          </p>
          <div className={styles.actions}>
            <a href={LIST_HREF} className="fn-btn fn-btn-primary">
              <Icon name="play" size={14} aria-hidden /> 作品を見る
            </a>
            <Link href="/entry" className="fn-btn fn-btn-ghost">
              <Icon name="calendar" size={14} aria-hidden /> 参加できるイベント
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.featureGrid} aria-label="FlameNode の特徴">
        {FEATURES.map((feature, index) => (
          <article
            key={feature.title}
            className={styles.feature}
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <span className={styles.featureIcon}>
              <Icon name={feature.icon} size={18} aria-hidden />
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.flow}>
        <div className={styles.flowHeader}>
          <p className={styles.kicker}>How it works</p>
          <h2>投稿から公開までの流れ</h2>
        </div>
        <ol className={styles.rail}>
          {FLOW.map((label, index) => (
            <li key={label} className={styles.step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
