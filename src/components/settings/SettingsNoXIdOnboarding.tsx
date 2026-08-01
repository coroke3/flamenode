import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import pageStyles from "./settings-page.module.css";

export function SettingsNoXIdOnboarding({
  pendingCount = 0,
}: {
  pendingCount?: number;
}): React.ReactElement {
  return (
    <div className={pageStyles.onboarding} role="status">
      <div className={pageStyles.onboardingIcon} aria-hidden>
        <Icon name="x" size={22} />
      </div>
      <div className={pageStyles.onboardingBody}>
        <h2 className={pageStyles.onboardingTitle}>X ID を連携しましょう</h2>
        <p className={pageStyles.onboardingLead}>
          FlameNode では Discord でログインし、利用規約に同意したうえで活動名義となる X ID
          を連携します。申請後は運営が目視確認して承認します。
        </p>
        <ul className={pageStyles.onboardingList}>
          <li>作品の閲覧はログインなしでも可能です</li>
          <li>枠確保は X ID 申請後（承認待ち）から利用できます</li>
          <li>いいね・セーブ・投稿には承認済みの活動名義（Active X ID）が必要です</li>
          <li>複数の X ID を連携し、アクティブを切り替えられます</li>
        </ul>
        {pendingCount > 0 ? (
          <p className={pageStyles.onboardingPending}>
            <Icon name="clock" size={13} aria-hidden />
            承認待ちの申請が {pendingCount} 件あります。「申請履歴」タブで確認できます。
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPageLead({
  hasLinkedXIds,
  pendingCount,
}: {
  hasLinkedXIds: boolean;
  pendingCount: number;
}): React.ReactElement {
  if (!hasLinkedXIds) {
    return (
      <p className="fn-page-lead">
        まず X ID を連携してください。承認後にいいね・セーブ・投稿ができます（枠確保は申請後から可能）。
        {pendingCount > 0 ? " 申請中の連携は「申請履歴」タブで確認できます。" : ""}
      </p>
    );
  }

  return (
    <p className="fn-page-lead">
      連携した X ID ごとにプロフィールを編集し、アクティブ X ID を切り替えます。
    </p>
  );
}
