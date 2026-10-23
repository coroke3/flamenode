import React from "react";
import { Image, Link } from "../adapters/index.js";
import { cx } from "../cx.js";
import { EXTERNAL, ScreenIcon } from "./parts.js";

/*
 * `/about` from the registered mock `docs/migration/mock/static/About.html` (classes `ab-*`, `metrics`,
 * `kv`, styles in `styles/screens.css`). Texts and links are CURRENT `app/(public)/about/page.tsx`'s:
 * where the mock wording differs, CURRENT wins (CURRENT_DIVERGENCE, see the MIG-0501 work item).
 * Static markup only; the stats come from the caller (build snapshot) and are hidden when absent,
 * as CURRENT hides them when its client fetch fails.
 */
export interface AboutStatsData {
  publicVideos: number;
  creators: number;
  events: number;
}

export interface AboutViewProps {
  stats?: AboutStatsData | null;
  /** Logo image for the identity block (CURRENT `Logo` mark). */
  logoSrc?: string;
  className?: string;
}

const HERO_POINTS = ["作品", "作者名義", "イベント", "投稿枠"] as const;

const FLOW_STEPS = [
  { label: "Watch", title: "作品から入る", body: "サムネイル、作者、イベント、関連作品を同じ導線でたどれます。" },
  { label: "Submit", title: "投稿を整える", body: "通常投稿もイベント枠投稿も、作品ごとの名義やSNS情報までまとめます。" },
  { label: "Operate", title: "開催後も残す", body: "枠、提出状況、公開作品、スタッフ権限、履歴をイベントの記録として扱います。" },
] as const;

const AUDIENCE = [
  { title: "見る人へ", body: "新着、ピックアップ、作者、イベントから作品を探せます。作品ページでは、メンバー、チャプター、関連作品も合わせて見られます。" },
  { title: "投稿する人へ", body: "YouTube 作品を、表示名、アイコン、X ID、合作メンバー、イベント所属と一緒に登録できます。イベント枠に紐づく提出も同じ流れで扱います。" },
  { title: "運営する人へ", body: "募集枠、提出状況、公開作品、スタッフ権限、通知、変更履歴をまとめて扱い、開催後のアーカイブにもつなげます。" },
] as const;

const PRINCIPLES = [
  { title: "作品を主役にする", body: "説明より先に、サムネイル、タイトル、作者、再生導線が見える密度を保ちます。" },
  { title: "名義を分けて守る", body: "Discord はログイン、X ID は公開名義として扱い、投稿主体と表示名義を混同しません。" },
  { title: "イベントを記録にする", body: "募集ページだけで終わらせず、投稿枠、公開作品、履歴まで同じイベントに残します。" },
] as const;

const ENTRY_POINTS = [
  { label: "作品を見る", href: "/list", description: "公開作品を検索し、作者・イベント・関連作品からたどれます。" },
  { label: "イベントを探す", href: "/event", description: "開催中・公開中のイベントと、投稿枠の状況を確認できます。" },
  { label: "投稿する", href: "/entry", description: "ログイン後、通常投稿またはイベント枠投稿を選べます。" },
] as const;

function CreditLinks(): React.ReactElement {
  return (
    <>
      <a className="p-link" href="https://x.com/tomoki3192" {...EXTERNAL}>
        X @tomoki3192
      </a>
      <a className="p-link" href="https://www.foriio.com/tomokidesign" {...EXTERNAL}>
        foriio
      </a>
    </>
  );
}

const count = (n: number): string => n.toLocaleString("ja-JP");

export function AboutView({ stats, logoSrc = "/brand/flamenode-mark.svg", className }: AboutViewProps): React.ReactElement {
  return (
    <div className={cx("p-root fn-screen", className)}>
      <main className="wrap">
        <section className="ab-hero">
          <div className="stack ab-copy">
            <h1 className="t-display">
              作品が見つかり、
              <br />
              イベントの記録も残る場所。
            </h1>
            <p className="ab-lead">
              FlameNode は、YouTube に公開された個人制作・合作映像を、作者名義、メンバー、イベント、投稿枠の記録と一緒にたどれるサイトです。
              見る、投稿する、運営する流れを分けずに、同じ作品データを中心に扱います。
            </p>
            <div className="actions">
              <Link href="/list" className="fn-btn fn-btn--primary">
                作品を見る
              </Link>
              <Link href="/event" className="fn-btn fn-btn--secondary">
                イベントを見る
              </Link>
            </div>
          </div>
          <div className="ab-points">
            {stats ? (
              <div className="metrics" role="group" aria-label="FlameNode の現在">
                <div className="metric"><b>{count(stats.publicVideos)}件</b><span>公開作品</span><span className="ab-note">動画ページ・作品棚・イベントから閲覧できます。</span></div>
                <div className="metric"><b>{count(stats.creators)}件</b><span>クリエイター名義</span><span className="ab-note">X ID を公開名義として作品と紐づけます。</span></div>
                <div className="metric"><b>{count(stats.events)}件</b><span>イベント</span><span className="ab-note">募集・公開・アーカイブの記録を扱います。</span></div>
              </div>
            ) : (
              <ul className="wrap-row t-sm muted ab-chips" aria-label="FlameNode がつなぐ情報">
                {HERO_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="sec" aria-labelledby="ab-flow">
          <h2 id="ab-flow" className="t-h2 ab-head">循環するプラットフォーム</h2>
          <div className="ab-cols" role="group" aria-label="FlameNode の主な流れ">
            {FLOW_STEPS.map((step) => (
              <div key={step.label} className="stack ab-col">
                <span className="t-label muted">{step.label}</span>
                <span className="t-h3">{step.title}</span>
                <span className="muted">{step.body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="sec" aria-labelledby="ab-who">
          <h2 id="ab-who" className="t-h2 ab-head">作品を中心に、見る・出す・動かすをつなぐ</h2>
          <p className="muted ab-sublead">
            利用者の立場ごとに分断されがちな導線を統合し、同じアーカイブ基盤の上でスムーズにつながります。
          </p>
          <dl className="kv ab-kv" aria-label="FlameNode の対象ユーザー">
            {AUDIENCE.map((item) => (
              <React.Fragment key={item.title}>
                <dt>{item.title}</dt>
                <dd className="muted">{item.body}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <section className="sec" aria-labelledby="ab-policy">
          <h2 id="ab-policy" className="t-h2 ab-head">アーカイブであり、イベントの作業場でもある</h2>
          <p className="muted">
            FlameNode で扱う中心は作品そのものです。イベントは作品が集まる場所として、プロフィールは公開名義として、投稿フォームは記録を整える入口として設計しています。
          </p>
          <p className="t-label muted">PRESERVING CREATIVE HISTORY</p>
        </section>

        <section className="sec" aria-labelledby="ab-rules3">
          <h2 id="ab-rules3" className="t-h2 ab-head">設計における3つの不変原則</h2>
          <div className="ab-cols">
            {PRINCIPLES.map((item) => (
              <div key={item.title} className="stack ab-col">
                <span className="t-h3">{item.title}</span>
                <span className="muted">{item.body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="sec" aria-labelledby="ab-identity">
          <h2 id="ab-identity" className="t-h2 ab-head">アイデンティティ</h2>
          <div className="ab-ident">
            <div className="stack ab-tile">
              <Image className="ab-logo" src={logoSrc} alt="FlameNode Logo" />
              <span className="t-label muted">FlameNode Logo</span>
            </div>
            <div className="stack ab-tile">
              <span className="ab-glyph" aria-hidden="true">Aa</span>
              <span className="t-label muted">FlameNode Sans</span>
            </div>
          </div>
        </section>

        <section className="sec" aria-labelledby="ab-credits">
          <h2 id="ab-credits" className="t-h2 ab-head">制作クレジット</h2>
          <dl className="kv" aria-label="制作クレジット">
            <dt>FlameNode Logo</dt>
            <dd className="wrap-row ab-credits">ともき <CreditLinks /></dd>
            <dt>FlameNode Sans</dt>
            <dd className="wrap-row ab-credits">ともき <CreditLinks /></dd>
          </dl>
        </section>

        <section className="sec" aria-labelledby="ab-start">
          <h2 id="ab-start" className="t-h2 ab-head">まず触るなら、ここから</h2>
          <p className="muted ab-sublead">FlameNode はどなたでも自由に作品を探したり、イベントを閲覧・投稿できます。</p>
          <ul className="ab-entry">
            {ENTRY_POINTS.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>
                  <span className="t-h3">
                    {item.label}
                    <ScreenIcon name="arrowRight" />
                  </span>
                  <span className="muted t-sm">{item.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
