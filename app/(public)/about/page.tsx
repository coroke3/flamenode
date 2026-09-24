import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { buildPageMetadata } from "@/lib/seo";
import { AboutStats } from "./AboutStats";

export const metadata: Metadata = buildPageMetadata({
  path: "/about",
  title: "FlameNode について",
  description:
    "FlameNode は、個人制作映像のアーカイブとイベント参加・投稿・運営の記録をつなぐサイトです。",
});

const HERO_POINTS = ["作品", "作者名義", "イベント", "投稿枠"] as const;

const FLOW_STEPS: Array<{
  step: string;
  label: string;
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    step: "01",
    label: "Watch",
    title: "作品から入る",
    body: "サムネイル、作者、イベント、関連作品を同じ導線でたどれます。",
    icon: "play",
  },
  {
    step: "02",
    label: "Submit",
    title: "投稿を整える",
    body: "通常投稿もイベント枠投稿も、作品ごとの名義やSNS情報までまとめます。",
    icon: "upload",
  },
  {
    step: "03",
    label: "Operate",
    title: "開催後も残す",
    body: "枠、提出状況、公開作品、スタッフ権限、履歴をイベントの記録として扱います。",
    icon: "calendar",
  },
];

const AUDIENCE_PATHS: Array<{
  tag: string;
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    tag: "FOR VIEWERS",
    title: "見る人へ",
    body: "新着、ピックアップ、作者、イベントから作品を探せます。作品ページでは、メンバー、チャプター、関連作品も合わせて見られます。",
    icon: "search",
  },
  {
    tag: "FOR CREATORS",
    title: "投稿する人へ",
    body: "YouTube 作品を、表示名、アイコン、X ID、合作メンバー、イベント所属と一緒に登録できます。イベント枠に紐づく提出も同じ流れで扱います。",
    icon: "edit",
  },
  {
    tag: "FOR ORGANIZERS",
    title: "運営する人へ",
    body: "募集枠、提出状況、公開作品、スタッフ権限、通知、変更履歴をまとめて扱い、開催後のアーカイブにもつなげます。",
    icon: "settings",
  },
];

const PRINCIPLES: Array<{ number: string; title: string; body: string }> = [
  {
    number: "01",
    title: "作品を主役にする",
    body: "説明より先に、サムネイル、タイトル、作者、再生導線が見える密度を保ちます。",
  },
  {
    number: "02",
    title: "名義を分けて守る",
    body: "Discord はログイン、X ID は公開名義として扱い、投稿主体と表示名義を混同しません。",
  },
  {
    number: "03",
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

export default function AboutPage(): React.ReactElement {
  return (
    <div className={styles.page}>
      {/* ── Hero Section ── */}
      <section className={styles.hero}>
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.heroBrandRow}>
              <Logo showText={false} className={styles.logo} />
              <span className={styles.eyebrowBadge}>ABOUT FLAMENODE</span>
            </div>
            <h1 className={styles.heroTitle}>
              作品が見つかり、
              <br className={styles.heroBr} />
              イベントの記録も残る場所。
            </h1>
            <p className={styles.lead}>
              FlameNode は、YouTube に公開された個人制作・合作映像を、作者名義、メンバー、イベント、投稿枠の記録と一緒にたどれるサイトです。
              見る、投稿する、運営する流れを分けずに、同じ作品データを中心に扱います。
            </p>
            <div className={styles.heroPoints} aria-label="FlameNode がつなぐ情報">
              {HERO_POINTS.map((point) => (
                <span key={point} className={styles.pointChip}>
                  <span className={styles.pointDot} aria-hidden="true" />
                  {point}
                </span>
              ))}
            </div>
            <div className={styles.actions}>
              <Link
                href="/list"
                className={`fn-btn fn-btn-primary ${styles.heroBtnPrimary}`}
                prefetch={false}
              >
                <Icon name="play" size={16} aria-hidden />
                <span>作品を見る</span>
              </Link>
              <Link
                href="/event"
                className={`fn-btn fn-btn-ghost ${styles.heroBtnGhost}`}
                prefetch={false}
              >
                <Icon name="calendar" size={16} aria-hidden />
                <span>イベントを見る</span>
              </Link>
            </div>
          </div>

          <aside className={styles.heroRail} aria-label="FlameNode の主な流れ">
            <div className={styles.heroRailHeader}>
              <span className={styles.heroRailBadge}>CORE FLOW</span>
              <span className={styles.heroRailSub}>循環するプラットフォーム</span>
            </div>
            <div className={styles.flowList}>
              {FLOW_STEPS.map((item) => (
                <div key={item.label} className={styles.flowCard}>
                  <div className={styles.flowCardStep}>
                    <span className={styles.flowIndex}>{item.step}</span>
                    <span className={styles.flowIcon}>
                      <Icon name={item.icon} size={16} aria-hidden />
                    </span>
                  </div>
                  <div className={styles.flowCardBody}>
                    <div className={styles.flowCardMeta}>
                      <span className={styles.flowLabel}>{item.label}</span>
                      <strong className={styles.flowTitle}>{item.title}</strong>
                    </div>
                    <p className={styles.flowDesc}>{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* ── Dynamic Stats ── */}
      <AboutStats />

      {/* ── Audience Pathways ── */}
      <section className={`fn-public-container fn-page-section ${styles.pathwaysSection}`}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>What It Connects</span>
          <h2 className={styles.sectionTitle}>
            作品を中心に、見る・出す・動かすをつなぐ
          </h2>
          <p className={styles.sectionLead}>
            利用者の立場ごとに分断されがちな導線を統合し、同じアーカイブ基盤の上でスムーズにつながります。
          </p>
        </header>
        <div className={styles.pathGrid} aria-label="FlameNode の対象ユーザー">
          {AUDIENCE_PATHS.map((item) => (
            <article key={item.title} className={styles.pathCard}>
              <div className={styles.pathCardTop}>
                <span className={styles.pathTag}>{item.tag}</span>
                <span className={styles.pathIconWrapper}>
                  <Icon name={item.icon} size={20} aria-hidden />
                </span>
              </div>
              <h3 className={styles.pathTitle}>{item.title}</h3>
              <p className={styles.pathBody}>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Policy & Principles ── */}
      <section className={`fn-public-container fn-page-section ${styles.philosophySection}`}>
        <div className={styles.philosophyInner}>
          <div className={styles.manifestoCard}>
            <span className={styles.sectionEyebrow}>Policy</span>
            <h2 className={styles.manifestoTitle}>
              アーカイブであり、
              <br />
              イベントの作業場でもある
            </h2>
            <p className={styles.manifestoText}>
              FlameNode で扱う中心は作品そのものです。イベントは作品が集まる場所として、プロフィールは公開名義として、投稿フォームは記録を整える入口として設計しています。
            </p>
            <div className={styles.manifestoTagline}>
              <span>PRESERVING CREATIVE HISTORY</span>
            </div>
          </div>
          <div className={styles.principlesContainer}>
            <div className={styles.principlesHeader}>
              <span className={styles.principlesBadge}>3 GUIDELINES</span>
              <span className={styles.principlesSub}>設計における3つの不変原則</span>
            </div>
            <div className={styles.principlesList}>
              {PRINCIPLES.map((item) => (
                <article key={item.title} className={styles.principleCard}>
                  <div className={styles.principleIndexCol}>
                    <span className={styles.principleNumber}>{item.number}</span>
                    <span className={styles.principleCheckIcon}>
                      <Icon name="check" size={14} aria-hidden />
                    </span>
                  </div>
                  <div className={styles.principleContent}>
                    <h3 className={styles.principleTitle}>{item.title}</h3>
                    <p className={styles.principleBody}>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Credits ── */}
      <section className={`fn-public-container fn-page-section ${styles.creditsSection}`}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>CREDITS</span>
          <h2 className={styles.sectionTitle}>制作クレジット</h2>
        </header>
        <div className={styles.creditsGrid} aria-label="制作クレジット">
          <article className={styles.creditCard}>
            <div className={styles.creditCardHeader}>
              <div className={styles.creditIconBadge}>
                <Logo showText={false} className={styles.creditLogoIcon} />
              </div>
              <div className={styles.creditTitleCol}>
                <span className={styles.creditRoleLabel}>IDENTITY</span>
                <h3 className={styles.creditTitle}>FlameNode Logo</h3>
              </div>
            </div>
            <p className={styles.creditAuthor}>
              制作：<strong>ともき</strong>
            </p>
            <div className={styles.creditActions}>
              <a
                href="https://www.foriio.com/tomokidesign"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.creditLinkBtn}
              >
                <span>foriio</span>
                <Icon name="chevron-right" size={13} aria-hidden />
              </a>
              <a
                href="https://x.com/tomoki3192"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.creditLinkBtn}
              >
                <span>X @tomoki3192</span>
                <Icon name="chevron-right" size={13} aria-hidden />
              </a>
            </div>
          </article>

          <article className={styles.creditCard}>
            <div className={styles.creditCardHeader}>
              <div className={styles.creditIconBadge}>
                <span className={styles.creditFontGlyph}>Aa</span>
              </div>
              <div className={styles.creditTitleCol}>
                <span className={styles.creditRoleLabel}>TYPEFACE</span>
                <h3 className={styles.creditTitle}>FlameNode Sans</h3>
              </div>
            </div>
            <p className={styles.creditAuthor}>
              制作：<strong>ともき</strong>
            </p>
            <div className={styles.creditActions}>
              <a
                href="https://www.foriio.com/tomokidesign"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.creditLinkBtn}
              >
                <span>foriio</span>
                <Icon name="chevron-right" size={13} aria-hidden />
              </a>
              <a
                href="https://x.com/tomoki3192"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.creditLinkBtn}
              >
                <span>X @tomoki3192</span>
                <Icon name="chevron-right" size={13} aria-hidden />
              </a>
            </div>
          </article>
        </div>
      </section>

      {/* ── Entry Points (Action Hub) ── */}
      <section className={`fn-public-container fn-page-section ${styles.entrySection}`}>
        <div className={styles.entryBanner}>
          <header className={styles.entryHeader}>
            <span className={styles.sectionEyebrow}>Start</span>
            <h2 className={styles.entryMainTitle}>
              まず触るなら、ここから
            </h2>
            <p className={styles.entryLeadText}>
              FlameNode はどなたでも自由に作品を探したり、イベントを閲覧・投稿できます。
            </p>
          </header>
          <div className={styles.entryCardsGrid}>
            {ENTRY_POINTS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles.entryActionCard}
                prefetch={false}
              >
                <div className={styles.entryActionIconBox}>
                  <Icon name={item.icon} size={22} aria-hidden />
                </div>
                <div className={styles.entryActionContent}>
                  <strong className={styles.entryActionTitle}>{item.label}</strong>
                  <span className={styles.entryActionDesc}>{item.description}</span>
                </div>
                <div className={styles.entryActionArrow}>
                  <Icon name="chevron-right" size={18} aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}