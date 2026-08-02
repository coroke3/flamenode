import * as React from "react";

export function PublicReflectionPendingNotice(): React.ReactElement {
  return (
    <div className="fn-empty" role="status">
      <p>公開ページへの反映を準備しています。しばらくしてから再読み込みしてください。</p>
    </div>
  );
}

export function PublicDataUnavailableNotice(): React.ReactElement {
  return (
    <div className="fn-empty" role="status">
      <p>
        公開データを一時的に取得できません。時間をおいて再読み込みしてください。
      </p>
    </div>
  );
}
