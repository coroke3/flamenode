import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { buildPageMetadata } from "@/lib/seo";
import { loadStaticTopPage } from "@/lib/publicData/loader";

export const metadata: Metadata = buildPageMetadata({
  path: "/about",
  title: "FlameNode について",
  description:
    "FlameNode は、個人制作映像のアーカイブとイベント参加・投稿・運営の記録をつなぐサイトです。",
});

type AboutStats = {
  publicVideos: number;
  creators: number;
  events: number;
};

const HERO_POINTS = [
  "作品",
  "作者名義",
  "イベント",
  "投稿枠",
] as const;

const FLOW_STEPS: Array<{
  label: string;
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    label: "Watch",
    title: "作品から入る",
    body: "サムネイル、作者、イベント、関連作品を同じ導線でたどれます。",
    icon: "play",
  },
  {
    label: "Submit",
    title: "投稿を整える",
    body: "通常投稿もイベント枠投稿も、作品ごとの名義やSNS情報までまとめます。",
    icon: "upload",
  },
  {
    label: "Operate",
    title: "開催後も残す",
    body: "枠、提出状況、公開作品、スタッフ権限、履歴をイベントの記録として扱います。",
    icon: "calendar",
  },
];

const AUDIENCE_PATHS: Array<{
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    title: "見る人へ",
    body: "新着、ピックアップ、作者、イベントから作品を探せます。作品ページでは、メンバー、チャプター、関連作品も合わせて見られます。",
    icon: "search",
  },
  {
    title: "投稿する人へ",
    body: "YouTube 作品を、表示名、アイコン、X ID、合作メンバー、イベント所属と一緒に登録できます。イベント枠に紐づく提出も同じ流れで扱います。",
    icon: "edit",
  },
  {
    title: "運営する人へ",
    body: "募集枠、提出状況、公開作品、スタッフ権限、通知、変更履歴をまとめて扱い、開催後のアーカイブにもつなげます。",
    icon: "settings",
  },
];

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: "作品を主役にする",
    body: "説明より先に、サムネイル、タイトル、作者、再生導線が見える密度を保ちます。",
  },
  {
    title: "名義を分けて守る",
    body: "Discord はログイン、X ID は公開名義として扱い、投稿主体と表示名義を混同しません。",
  },
  {
    title: "イベントを記録にする",
    body: "募集ページだけで終わらせず、投稿枠、公開作品、履歴まで同じイベントに残します。",
  },
];

const ENTRY_POINTS: Array<{
  label: string;
  href: string;
  description: string;
  icon: IconName;
}> = [
  {
    label: "作品を見る",
    href: "/list",
    description: "公開作品を検索し、作者・イベント・関連作品からたどれます。",
    icon: "grid",
  },
  {
    label: "イベントを探す",
    href: "/event",
    description: "開催中・公開中のイベントと、投稿枠の状況を確認できます。",
    icon: "calendar",
  },
  {
    label: "投稿する",
    href: "/entry",
    description: "ログイン後、通常投稿またはイベント枠投稿を選べます。",
    icon: "upload",
  },
];

function formatCount(value: number): string {
  return value.toLocaleString("ja-JP");
}

export default async function AboutPage(): Promise<React.ReactElement> {
  const staticTop = await loadStaticTopPage();
  const stats: AboutStats | null = staticTop.top
    ? {
        publicVideos: staticTop.top.stats.publicVideos,
        creators: staticTop.top.stats.creators,
        events: staticTop.top.stats.publicEvents ?? staticTop.top.stats.activeEvents,
      }
    : null;
  const statItems = stats
    ? [
        {
          label: "公開作品",
          value: formatCount(stats.publicVideos),
          unit: "件",
          note: "動画ページ・作品棚・イベントから閲覧できます。",
        },
        {
          label: "クリエイター名義",
          value: formatCount(stats.creators),
          unit: "件",
          note: "X ID を公開名義として作品と紐づけます。",
        },
        {
          label: "イベント",
          value: formatCount(stats.events),
          unit: "件",
          note: "募集・公開・アーカイブの記録を扱います。",
        },
      ]
    : [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <Logo showText={false} className={styles.logo} />
            <p className="fn-eyebrow">ABOUT</p>
            <h1 className="fn-display">
              作品が見つかり、イベントの記録も残る場所。
            </h1>
            <p className={styles.lead}>
              FlameNode は、YouTube に公開された個人制作・合作映像を、作者名義、メンバー、イベント、投稿枠の記録と一緒にたどれるサイトです。
              見る、投稿する、運営する流れを分けずに、同じ作品データを中心に扱います。
            </p>
            <div className={styles.heroPoints} aria-label="FlameNode がつなぐ情報">
              {HERO_POINTS.map((point) => (
                <span key={point}>{point}</span>
              ))}
            </div>
            <div className={styles.actions}>
              <Link href="/list" className="fn-btn fn-btn-primary fn-btn-lg">
                <Icon name="play" size={15} aria-hidden />
                作品を見る
              </Link>
              <Link href="/event" className="fn-btn fn-btn-ghost fn-btn-lg">
                <Icon name="calendar" size={15} aria-hidden />
                イベントを見る
              </Link>
            </div>
          </div>

          <aside className={styles.heroRail} aria-label="FlameNode の主な流れ">
            {FLOW_STEPS.map((item) => (
              <div key={item.label} className={styles.flowItem}>
                <span className={styles.flowIcon}>
                  <Icon name={item.icon} size={17} aria-hidden />
                </span>
                <span>
                  <small>{item.label}</small>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {statItems.length > 0 ? (
        <section className={`fn-public-container ${styles.statsBand}`} aria-label="FlameNode の現在">
          <dl className={styles.statsGrid}>
            {statItems.map((item) => (
              <div key={item.label} className={styles.statItem}>
                <dt>{item.label}</dt>
                <dd>
                  <strong>{item.value}</strong>
                  <span>{item.unit}</span>
                </dd>
                <p>{item.note}</p>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className={`fn-public-container fn-page-section ${styles.pathways}`}>
        <header className={styles.sectionHead}>
          <p className="fn-eyebrow">What It Connects</p>
          <h2 className="fn-page-title fn-page-title--compact">
            作品を中心に、見る・出す・動かすをつなぐ
          </h2>
        </header>
        <div className={styles.pathGrid} aria-label="FlameNode の対象ユーザー">
          {AUDIENCE_PATHS.map((item) => (
            <article key={item.title} className={styles.pathItem}>
              <span className={styles.itemIcon}>
                <Icon name={item.icon} size={18} aria-hidden />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`fn-public-container fn-page-section ${styles.philosophy}`}>
        <div className={styles.statement}>
          <p className="fn-eyebrow">Policy</p>
          <h2 className="fn-page-title fn-page-title--compact">
            アーカイブであり、イベントの作業場でもある
          </h2>
          <p>
            FlameNode で扱う中心は作品そのものです。イベントは作品が集まる場所として、プロフィールは公開名義として、投稿フォームは記録を整える入口として設計しています。
          </p>
        </div>
        <div className={styles.principles}>
          {PRINCIPLES.map((item) => (
            <article key={item.title} className={styles.principleItem}>
              <Icon name="check" size={16} aria-hidden />
              <span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className={`fn-public-container fn-page-section ${styles.credits}`}>
        <header className={styles.sectionHead}>
          <p className="fn-eyebrow">CREDITS</p>
          <h2 className="fn-page-title fn-page-title--compact">制作クレジット</h2>
        </header>
        <div className={styles.creditsGrid} aria-label="制作クレジット">
          <article className={styles.creditItem}>
            <h3>FlameNode Logo</h3>
            <p className={styles.creditBy}>
              制作：<strong>ともき</strong>
            </p>
            <div className={styles.creditLinks}>
              <a
                href="https://www.foriio.com/tomokidesign"
                target="_blank"
                rel="noopener noreferrer"
              >
                foriio
              </a>
              <a
                href="https://x.com/tomoki3192"
                target="_blank"
                rel="noopener noreferrer"
              >
                X @tomoki3192
              </a>
            </div>
          </article>
          <article className={styles.creditItem}>
            <h3>FlameNode Sans</h3>
            <p className={styles.creditBy}>
              制作：<strong>ともき</strong>
            </p>
            <div className={styles.creditLinks}>
              <a
                href="https://www.foriio.com/tomokidesign"
                target="_blank"
                rel="noopener noreferrer"
              >
                foriio
              </a>
              <a
                href="https://x.com/tomoki3192"
                target="_blank"
                rel="noopener noreferrer"
              >
                X @tomoki3192
              </a>
            </div>
          </article>
        </div>
      </section>

      <section className={`fn-public-container fn-page-section ${styles.entryPoints}`}>
        <header className={styles.sectionHead}>
          <p className="fn-eyebrow">Start</p>
          <h2 className="fn-page-title fn-page-title--compact">
            まず触るなら、ここから
          </h2>
        </header>
        <div className={styles.linkList}>
          {ENTRY_POINTS.map((item) => (
            <Link key={item.href} href={item.href} className={styles.linkItem}>
              <span className={styles.itemIcon}>
                <Icon name={item.icon} size={18} aria-hidden />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="chevron-right" size={16} aria-hidden />
            </Link>
          ))}
          </div>
      </section>
    </div>
  );
}
