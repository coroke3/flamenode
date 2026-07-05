import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { getDatabase } from "@/lib/cloudflare";
import {
  getOnboardingState,
  maybeMarkOnboardingComplete,
  onboardingHref,
  onboardingRulesHref,
  resolveOnboardingStepStatuses,
  type OnboardingStepStatus,
} from "@/lib/auth/onboarding";
import { Icon } from "@/components/ui/Icon";
import { XIdLinkForm } from "@/components/settings/XIdSettingsClient";
import { sanitizeNextPath } from "@/lib/utils/next";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "初期設定" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<OnboardingStepStatus, string> = {
  done: "完了",
  action: "要対応",
  pending: "承認待ち",
  waiting: "未着手",
};

function stepCardClass(status: OnboardingStepStatus): string {
  if (status === "done") return `${styles.stepCard} ${styles["stepCard--done"]}`;
  if (status === "pending") return `${styles.stepCard} ${styles["stepCard--pending"]}`;
  if (status === "action") return `${styles.stepCard} ${styles["stepCard--action"]}`;
  return styles.stepCard;
}

function stepIndexClass(_status: OnboardingStepStatus): string {
  return styles.stepIndex;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = sanitizeNextPath(params?.next, "/dashboard");
  const selfHref = onboardingHref(next);

  const guard = await requireSession({ next: selfHref });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  const state = await getOnboardingState(db, user);
  if (db) {
    await maybeMarkOnboardingComplete(db, user.id, state);
  }
  const steps = resolveOnboardingStepStatuses(state);
  const rulesHref = onboardingRulesHref(selfHref);
  const settingsHref = `/dashboard/settings?next=${encodeURIComponent(selfHref)}`;

  if (state.isComplete && state.canPost) {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">初期設定</h1>
          <p className="fn-jp fn-page-lead">
            初期設定は完了しています。投稿・イベント参加を始められます。
          </p>
        </header>
        <div className={styles.completeBanner} role="status">
          <Icon name="check" size={18} aria-hidden />
          <div>
            <strong>投稿できます</strong>
            {state.activeXId ? (
              <p className="fn-text-muted-sm fn-mt-4">
                活動名義: @{state.activeXId}
              </p>
            ) : null}
          </div>
          <div className={styles.stepActions}>
            <Link href={next} className="fn-btn fn-btn-primary">
              続ける
            </Link>
            <Link href="/entry" className="fn-btn fn-btn-ghost">
              参加・投稿へ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.isComplete && !state.canPost) {
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">onboarding</span>
          <h1 className="fn-display fn-page-title">初期設定</h1>
          <p className="fn-jp fn-page-lead">
            利用規約への同意と X ID 連携申請は完了しています。承認をお待ちください。
          </p>
        </header>
        <div className={`${styles.stepCard} ${styles["stepCard--pending"]}`}>
          <div className={styles.stepHead}>
            <span className={stepIndexClass("pending")} aria-hidden>3</span>
            <div>
              <h2 className={styles.stepTitle}>X ID 承認待ち</h2>
              <span className={styles.stepStatus}>
                <Icon name="clock" size={12} aria-hidden />
                承認待ち
              </span>
            </div>
          </div>
          <p className={styles.stepBody}>
            運営が X ID 連携を確認しています。承認後に通知されます。
          </p>
          <ul className={styles.pendingList}>
            <li>イベント枠の確保は可能です</li>
            <li>投稿は承認後に利用できます</li>
            <li>詳細設定はアカウント設定から変更できます</li>
          </ul>
          <div className={styles.stepActions}>
            <Link href="/entry" className="fn-btn fn-btn-primary">
              枠確保・参加へ
            </Link>
            <Link href={settingsHref} className="fn-btn fn-btn-ghost">
              アカウント設定
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <span className="fn-eyebrow">onboarding</span>
        <h1 className="fn-display fn-page-title">初期設定</h1>
        <p className="fn-jp fn-page-lead">
          ログイン後に必要な設定を順番に進めます。完了すると投稿・枠確保が使えます。
        </p>
      </header>

      <div className={styles.onboardingSteps} aria-label="初期設定の進捗">
        <section className={stepCardClass(steps.login)} aria-labelledby="ob-step-login">
          <div className={styles.stepHead}>
            <span className={stepIndexClass(steps.login)} aria-hidden>1</span>
            <div>
              <h2 id="ob-step-login" className={styles.stepTitle}>
                Discord ログイン
              </h2>
              <span className={styles.stepStatus}>
                <Icon name={steps.login === "done" ? "check" : "discord"} size={12} aria-hidden />
                {STATUS_LABELS[steps.login]}
              </span>
            </div>
          </div>
          <p className={styles.stepBody}>
            FlameNode では Discord アカウントでログインします。
          </p>
        </section>

        <section className={stepCardClass(steps.terms)} aria-labelledby="ob-step-terms">
          <div className={styles.stepHead}>
            <span className={stepIndexClass(steps.terms)} aria-hidden>2</span>
            <div>
              <h2 id="ob-step-terms" className={styles.stepTitle}>
                利用規約への同意
              </h2>
              <span className={styles.stepStatus}>
                <Icon
                  name={
                    steps.terms === "done"
                      ? "check"
                      : steps.terms === "action"
                        ? "edit"
                        : "clock"
                  }
                  size={12}
                  aria-hidden
                />
                {STATUS_LABELS[steps.terms]}
              </span>
            </div>
          </div>
          <p className={styles.stepBody}>
            枠確保・投稿・いいねなどの書き込みには最新の利用規約への同意が必要です。
          </p>
          {steps.terms === "action" ? (
            <div className={styles.stepActions}>
              <Link href={rulesHref} className="fn-btn fn-btn-primary">
                利用規約を確認する
              </Link>
            </div>
          ) : null}
        </section>

        <section className={stepCardClass(steps.xId)} aria-labelledby="ob-step-xid">
          <div className={styles.stepHead}>
            <span className={stepIndexClass(steps.xId)} aria-hidden>3</span>
            <div>
              <h2 id="ob-step-xid" className={styles.stepTitle}>
                X ID 連携申請
              </h2>
              <span className={styles.stepStatus}>
                <Icon
                  name={
                    steps.xId === "done"
                      ? "check"
                      : steps.xId === "pending"
                        ? "clock"
                        : steps.xId === "action"
                          ? "edit"
                          : "clock"
                  }
                  size={12}
                  aria-hidden
                />
                {STATUS_LABELS[steps.xId]}
              </span>
            </div>
          </div>
          {steps.xId === "waiting" ? (
            <p className={styles.stepBody}>
              利用規約への同意後、活動名義となる X ID を申請します。
            </p>
          ) : steps.xId === "pending" ? (
            <>
              <p className={styles.stepBody}>
                連携申請を受け付けました。運営の承認をお待ちください。
              </p>
              <p className={styles.pendingNote}>
                枠確保は可能です。投稿は承認後に利用できます。承認後は通知されます。
              </p>
              <div className={styles.stepActions}>
                <Link href="/entry" className="fn-btn fn-btn-primary">
                  枠確保・参加へ
                </Link>
                <Link href={settingsHref} className="fn-btn fn-btn-ghost fn-btn-sm">
                  詳細設定
                </Link>
              </div>
            </>
          ) : steps.xId === "done" ? (
            <p className={styles.stepBody}>
              承認済みの X ID で投稿できます。
              {state.activeXId ? ` (@${state.activeXId})` : ""}
            </p>
          ) : (
            <>
              <p className={styles.stepBody}>
                投稿・枠確保の名義となる X ID を申請します。@ を除いたユーザー名を入力してください。
              </p>
              <div className={styles.xIdFormWrap}>
                <XIdLinkForm compact onSuccessRedirect={selfHref} />
              </div>
              <div className={styles.stepActions}>
                <Link href={settingsHref} className="fn-btn fn-btn-ghost fn-btn-sm">
                  詳細設定・アイコン編集
                </Link>
              </div>
            </>
          )}
        </section>

        <section className={stepCardClass(steps.ready)} aria-labelledby="ob-step-ready">
          <div className={styles.stepHead}>
            <span className={stepIndexClass(steps.ready)} aria-hidden>4</span>
            <div>
              <h2 id="ob-step-ready" className={styles.stepTitle}>
                投稿・イベント参加へ
              </h2>
              <span className={styles.stepStatus}>
                <Icon
                  name={steps.ready === "done" ? "check" : "calendar"}
                  size={12}
                  aria-hidden
                />
                {STATUS_LABELS[steps.ready]}
              </span>
            </div>
          </div>
          <p className={styles.stepBody}>
            初期設定が完了すると、イベント参加や作品投稿を始められます。
          </p>
          {state.canPost ? (
            <div className={styles.stepActions}>
              <Link href={next} className="fn-btn fn-btn-primary">
                続ける
              </Link>
              <Link href="/entry" className="fn-btn fn-btn-ghost">
                参加・投稿へ
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
