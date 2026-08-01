import "server-only";
import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import {
  getOnboardingState,
  maybeMarkOnboardingComplete,
  onboardingHref,
} from "@/lib/auth/onboarding";
import { sanitizeOnboardingNext } from "@/lib/auth/onboardingUrls";
import { Icon } from "@/components/ui/Icon";
import { parseLegalMarkdown } from "@/lib/terms/legalMarkdown";
import {
  DEFAULT_TERMS_MARKDOWN,
  DEFAULT_TERMS_VERSION_LABEL,
} from "@/lib/terms/defaultTerms";
import { loadStaticRulesPage } from "@/lib/publicData/loader";
import styles from "./page.module.css";
import { OnboardingTermsForm } from "./OnboardingTermsForm";
import { OnboardingXIdForm } from "./OnboardingXIdForm";

export const metadata: Metadata = { title: "初期設定" };
export const dynamic = "force-dynamic";

function renderMarkdown(markdown: string): React.ReactNode[] {
  return parseLegalMarkdown(markdown).map((block, blockIndex) => {
    const key = `${block.type}-${blockIndex}`;
    if (block.type === "heading2") return <h2 key={key}>{block.text}</h2>;
    if (block.type === "heading3") return <h3 key={key}>{block.text}</h3>;
    if (block.type === "list") {
      return (
        <ul key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      );
    }
    return <p key={key}>{block.text}</p>;
  });
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; start?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeOnboardingNext(params?.next, "/dashboard");
  const selfHref = onboardingHref(next);
  const started = params?.start === "1";

  const guard = await requireSession({ next: selfHref });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  const state = await getOnboardingState(db, user);
  if (db) {
    await maybeMarkOnboardingComplete(db, user.id, state);
  }

  const settingsHref = `/dashboard/settings?next=${encodeURIComponent(selfHref)}`;
  const startHref = `${selfHref}&start=1`;

  // 優先: 規約再同意 → X未申請 → 却下 → 承認待ち → 承認済み(active未設定含む) → 投稿可能
  if (state.needsTermsAcceptance) {
    const staticRules = await loadStaticRulesPage();
    const body = staticRules.rules?.bodyMarkdown ?? DEFAULT_TERMS_MARKDOWN;
    const versionLabel =
      staticRules.rules?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL;

    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">初期設定 1 / 2</span>
          <h1 className="fn-display fn-page-title">利用規約の確認</h1>
          <p className="fn-jp fn-page-lead">
            投稿やイベント参加を始める前に、利用規約を確認してください。
          </p>
        </header>

        <ul className={styles.summaryList}>
          <li>投稿作品の取り扱い</li>
          <li>禁止事項</li>
          <li>アカウントおよび投稿の削除</li>
          <li>イベント参加時のルール</li>
        </ul>

        <section className={styles.stepCard} aria-labelledby="ob-step-terms">
          <h2 id="ob-step-terms" className="fn-sr-only">
            利用規約への同意
          </h2>
          <OnboardingTermsForm
            versionLabel={versionLabel}
            termsBody={renderMarkdown(body)}
          />
        </section>
      </div>
    );
  }

  if (state.canPost) {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">設定が完了しました</h1>
          <p className="fn-jp fn-page-lead">
            @{state.activeApprovedXId} で作品投稿やイベント参加ができます。
          </p>
        </header>
        <div className={styles.completeBanner} role="status">
          <Icon name="check" size={18} aria-hidden />
          <div>
            <strong>設定完了・投稿可能</strong>
          </div>
          <div className={styles.stepActions}>
            <Link href={next} className="fn-btn fn-btn-primary">
              元の操作を続ける
            </Link>
            <Link href="/entry" className="fn-btn fn-btn-ghost">
              参加・投稿へ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.xIdentityStatus === "approved" && !state.activeApprovedXId) {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">活動名義の選択</h1>
          <p className="fn-jp fn-page-lead">
            承認済みの X ID があります。投稿に使う Active X ID を設定してください。
          </p>
        </header>
        <div className={styles.stepActions}>
          <Link href={settingsHref} className="fn-btn fn-btn-primary">
            設定で Active X ID を選ぶ
          </Link>
          <Link href={next} className="fn-btn fn-btn-ghost">
            元の操作へ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (state.xIdentityStatus === "pending") {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">X ID 連携を申請しました</h1>
          <p className="fn-jp fn-page-lead">
            {state.requestedXId ? `@${state.requestedXId}` : "申請中の X ID"}{" "}
            の連携を運営が確認しています。
          </p>
        </header>
        <div
          className={`${styles.statusCard} ${styles["statusCard--pending"]}`}
          role="status"
        >
          <div className={styles.statusHead}>
            <Icon name="clock" size={16} aria-hidden />
            <strong>申請完了・承認待ち</strong>
          </div>
          <p className={styles.statusBody}>現在利用できる機能</p>
          <ul className={styles.pendingList}>
            <li>作品の閲覧</li>
            <li>イベント枠の確保</li>
            <li className={styles.pendingMuted}>
              いいね・セーブ・作品投稿は承認後に利用可能
            </li>
          </ul>
          <div className={styles.stepActions}>
            <Link href={next} className="fn-btn fn-btn-primary">
              元の操作へ戻る
            </Link>
            <Link href="/entry" className="fn-btn fn-btn-ghost">
              参加・投稿ページへ
            </Link>
            <Link href="/dashboard" className="fn-btn fn-btn-ghost">
              ダッシュボードへ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.xIdentityStatus === "rejected") {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">初期設定 2 / 2</span>
          <h1 className="fn-display fn-page-title">
            X ID 連携を確認できませんでした
          </h1>
        </header>
        <div
          className={`${styles.statusCard} ${styles["statusCard--rejected"]}`}
          role="alert"
        >
          <div className={styles.statusHead}>
            <Icon name="alert" size={16} aria-hidden />
            <strong>申請を確認できませんでした</strong>
          </div>
          {state.requestedXId ? (
            <p className={styles.statusBody}>
              申請した X ID: @{state.requestedXId}
            </p>
          ) : null}
          <p className={styles.statusBody}>
            指定されたアカウントを確認できませんでした。同じ X ID
            で再申請するか、別の X ID を入力してください。
          </p>
          <OnboardingXIdForm initialValue={state.requestedXId ?? ""} />
          <div className={styles.stepActions}>
            <Link href={next} className="fn-btn fn-btn-primary">
              元の操作へ戻る
            </Link>
            <Link href="/dashboard" className="fn-btn fn-btn-ghost">
              ダッシュボードへ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // xIdentityStatus === "none"
  if (!started) {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">
            FlameNode を利用する準備
          </h1>
          <p className="fn-jp fn-page-lead">
            投稿やイベント参加のために、次の 2 つを設定します。
          </p>
        </header>
        <ol className={styles.prepareList}>
          <li>利用規約への同意（完了済み）</li>
          <li>活動名義となる X ID の登録</li>
        </ol>
        <p className={styles.prepareNote}>所要時間：約1分</p>
        <div className={styles.stepActions}>
          <Link href={startHref} className="fn-btn fn-btn-primary">
            設定を始める
          </Link>
          <Link href={next} className="fn-btn fn-btn-ghost">
            あとで
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <span className="fn-eyebrow">初期設定 2 / 2</span>
        <h1 className="fn-display fn-page-title">活動名義を登録</h1>
        <p className="fn-jp fn-page-lead">
          作品投稿やイベント参加時に使用する X アカウントを登録してください。
        </p>
      </header>

      <section className={styles.stepCard} aria-labelledby="ob-step-xid">
        <h2 id="ob-step-xid" className="fn-sr-only">
          X ID 申請
        </h2>
        <p className={styles.stepBody}>
          運営による確認後、作品投稿が可能になります。枠の確保は申請完了後すぐに利用できます。
        </p>
        <OnboardingXIdForm />
      </section>
    </div>
  );
}
