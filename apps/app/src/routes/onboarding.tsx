import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { OnboardingResponse } from "@flamenode/contracts";
import type { PersonalApi } from "../api/personal.js";
import { createTermsApi, type TermsApi } from "../api/terms.js";
import { OnboardingTermsForm } from "./onboardingTermsForm.js";
import { ResultView, useApiResult } from "./guard.js";
import { onboardingHref, sanitizeOnboardingNext } from "./next.js";
import { AppLink, useDocumentTitle } from "./ui/AppLink.js";
import { DEFAULT_TERMS_MARKDOWN, DEFAULT_TERMS_VERSION_LABEL } from "./ui/defaultTerms.js";
import { Icon } from "./ui/Icon.js";
import { parseLegalMarkdown } from "./ui/legalMarkdown.js";

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

/**
 * CURRENT app/(auth)/onboarding/page.tsx, read-only part (MIG-0701): guard next is the sanitized self href.
 * U02 (MIG-0710) adds the terms form; the X ID request forms remain MIG-0709 and maybeMarkOnboardingComplete is U03.
 * Class names that were CSS-module members in CURRENT are plain `onb-*` classes until the stylesheet port lands.
 */
export function Onboarding({ api, termsApi: suppliedTermsApi }: {
  api: PersonalApi;
  /** Optional injection for U03 read-only/one-write parity tests. */
  termsApi?: TermsApi;
}): React.ReactElement {
  useDocumentTitle("初期設定");
  const [params] = useSearchParams();
  const next = sanitizeOnboardingNext(params.get("next"), "/dashboard");
  const selfHref = onboardingHref(next);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const defaultTermsApi = React.useMemo(() => createTermsApi(), []);
  const termsApi = suppliedTermsApi ?? defaultTermsApi;
  const state = useApiResult(api, "onboarding", (a, signal) => a.getOnboarding(signal), refreshKey);
  const completionSent = React.useRef(false);
  React.useEffect(() => {
    // CURRENT's page marks completion after reading the onboarding snapshot.
    // The POST is an idempotent auxiliary marker, never a UI/auth signal.
    if (state.status !== "ok" || completionSent.current) return;
    completionSent.current = true; // StrictMode and refreshKey must not double-submit.
    void termsApi.complete().catch(() => {
      // CURRENT ignores completion-marker errors; keep the read-only page visible.
    });
  }, [state.status, termsApi]);
  return (
    <ResultView state={state} next={selfHref}>
      {(data) => (
        <OnboardingView
          data={data}
          next={next}
          started={params.get("start") === "1"}
          termsApi={termsApi}
          onTermsAccepted={() => setRefreshKey((v) => v + 1)}
        />
      )}
    </ResultView>
  );
}

export function OnboardingView({
  data,
  next,
  started,
  termsApi,
  onTermsAccepted,
}: {
  data: OnboardingResponse;
  next: string;
  started: boolean;
  termsApi: ReturnType<typeof createTermsApi>;
  onTermsAccepted: () => void;
}): React.ReactElement {
  const { state, rules } = data;
  const selfHref = onboardingHref(next);
  // 「枠だけ確保」は next が dashboard 既定のとき /entry へ誘導する
  const reserveOnlyHref = next === "/dashboard" || next.startsWith("/dashboard?") ? "/entry" : next;
  const settingsHref = `/dashboard/settings?next=${encodeURIComponent(selfHref)}`;
  const startHref = `${selfHref}&start=1`;

  // 優先: 規約再同意 → X未申請 → 却下 → 承認待ち → 承認済み(active未設定含む) → 投稿可能
  if (state.needsTermsAcceptance) {
    const body = rules?.bodyMarkdown ?? DEFAULT_TERMS_MARKDOWN;
    const versionLabel = rules?.versionLabel ?? DEFAULT_TERMS_VERSION_LABEL;
    return (
      <div className="fn-public-container fn-page">
        <header className="fn-page-head">
          <span className="fn-eyebrow">初期設定 1 / 2</span>
          <h1 className="fn-display fn-page-title">利用規約の確認</h1>
          <p className="fn-jp fn-page-lead">投稿やイベント参加を始める前に、利用規約を確認してください。</p>
        </header>

        <ul className="onb-summaryList">
          <li>投稿作品の取り扱い</li>
          <li>禁止事項</li>
          <li>アカウントおよび投稿の削除</li>
          <li>イベント参加時のルール</li>
        </ul>

        <section className="onb-stepCard" aria-labelledby="ob-step-terms">
          <h2 id="ob-step-terms" className="fn-sr-only">
            利用規約への同意
          </h2>
          <OnboardingTermsForm
            versionLabel={versionLabel}
            termsBody={renderMarkdown(body)}
            api={termsApi}
            onAccepted={onTermsAccepted}
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
          <p className="fn-jp fn-page-lead">@{state.activeApprovedXId} で作品投稿やイベント参加ができます。</p>
        </header>
        <div className="onb-completeBanner" role="status">
          <Icon name="check" size={18} aria-hidden />
          <div>
            <strong>設定完了・投稿可能</strong>
          </div>
          <div className="onb-stepActions">
            <AppLink href={next} className="fn-btn fn-btn-primary">
              元の操作を続ける
            </AppLink>
            <AppLink href="/entry" className="fn-btn fn-btn-ghost">
              参加・投稿へ
            </AppLink>
            <AppLink href={settingsHref} className="fn-btn fn-btn-ghost">
              プロフィールを設定する
            </AppLink>
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
          <p className="fn-jp fn-page-lead">承認済みの X ID があります。投稿に使う Active X ID を設定してください。</p>
        </header>
        <div className="onb-stepActions">
          <AppLink href={settingsHref} className="fn-btn fn-btn-primary">
            設定で Active X ID を選ぶ
          </AppLink>
          <AppLink href={next} className="fn-btn fn-btn-ghost">
            元の操作へ戻る
          </AppLink>
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
            {state.requestedXId ? `@${state.requestedXId}` : "申請中の X ID"} の連携を運営が確認しています。
          </p>
        </header>
        <div className="onb-statusCard onb-statusCard--pending" role="status">
          <div className="onb-statusHead">
            <Icon name="clock" size={16} aria-hidden />
            <strong>申請完了・承認待ち</strong>
          </div>
          <p className="onb-statusBody">現在利用できる機能</p>
          <ul className="onb-pendingList">
            <li>作品の閲覧</li>
            <li>イベント枠の確保</li>
            <li className="onb-pendingMuted">いいね・セーブ・作品投稿は承認後に利用可能</li>
          </ul>
          <div className="onb-stepActions">
            <AppLink href={next} className="fn-btn fn-btn-primary">
              元の操作へ戻る
            </AppLink>
            <AppLink href="/entry" className="fn-btn fn-btn-ghost">
              参加・投稿ページへ
            </AppLink>
            <AppLink href="/dashboard" className="fn-btn fn-btn-ghost">
              ダッシュボードへ
            </AppLink>
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
          <h1 className="fn-display fn-page-title">X ID 連携を確認できませんでした</h1>
        </header>
        <div className="onb-statusCard onb-statusCard--rejected" role="alert">
          <div className="onb-statusHead">
            <Icon name="alert" size={16} aria-hidden />
            <strong>申請を確認できませんでした</strong>
          </div>
          {state.requestedXId ? <p className="onb-statusBody">申請した X ID: @{state.requestedXId}</p> : null}
          <p className="onb-statusBody">
            指定されたアカウントを確認できませんでした。同じ X ID
            で再申請するか、別の X ID を入力してください。
          </p>
          {/* MIG-0702: OnboardingXIdForm (initialValue = requestedXId) */}
          <div className="onb-stepActions">
            <AppLink href={next} className="fn-btn fn-btn-primary">
              元の操作へ戻る
            </AppLink>
            <AppLink href="/dashboard" className="fn-btn fn-btn-ghost">
              ダッシュボードへ
            </AppLink>
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
          <h1 className="fn-display fn-page-title">FlameNode を利用する準備</h1>
          <p className="fn-jp fn-page-lead">
            作品投稿のために、活動名義となる X ID を登録します。枠確保は規約同意後から利用できます。
          </p>
        </header>
        <ol className="onb-prepareList">
          <li>利用規約への同意（完了済み）</li>
          <li>活動名義となる X ID の登録（作品投稿に必要）</li>
        </ol>
        <p className="onb-prepareNote">所要時間：約1分</p>
        <div className="onb-stepActions">
          <AppLink href={startHref} className="fn-btn fn-btn-primary">
            設定を始める
          </AppLink>
          {state.canReserveSlot ? (
            <AppLink href={reserveOnlyHref} className="fn-btn fn-btn-ghost">
              あとで枠だけ確保する
            </AppLink>
          ) : (
            <AppLink href={next} className="fn-btn fn-btn-ghost">
              あとで
            </AppLink>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <span className="fn-eyebrow">初期設定 2 / 2</span>
        <h1 className="fn-display fn-page-title">活動名義を登録</h1>
        <p className="fn-jp fn-page-lead">作品投稿時に使用する X アカウントを登録してください。</p>
      </header>

      <section className="onb-stepCard" aria-labelledby="ob-step-xid">
        <h2 id="ob-step-xid" className="fn-sr-only">
          X ID 申請
        </h2>
        <p className="onb-stepBody">
          運営による確認後、作品投稿が可能になります。枠の確保は利用規約同意後から利用できます。
        </p>
        {/* MIG-0702: OnboardingXIdForm */}
        {state.canReserveSlot ? (
          <div className="onb-stepActions">
            <AppLink href={reserveOnlyHref} className="fn-btn fn-btn-ghost">
              あとで枠だけ確保する
            </AppLink>
          </div>
        ) : null}
      </section>
    </div>
  );
}

