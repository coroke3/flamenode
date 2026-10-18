import React from "react";

/**
 * CURRENT texts for the shared states, so pages do not retype them (MIG-0204 T02).
 * `packages/ui/test/feedback.test.mjs` checks each against its CURRENT source.
 */
export const FEEDBACK_MESSAGES = Object.freeze({
  /** CURRENT `src/components/layout/PublicDegradedBanner.tsx` */
  degradedTitle: "簡易表示:",
  // Two JSX lines in CURRENT, rendered with one space between them.
  degraded: "現在、公開データを簡易表示しています。 一部の集計や並べ替えは利用できません。",
  /** CURRENT `PUBLIC_REFLECTION_DELAY_MESSAGE` (`src/lib/staticRebuild/publicReflectionNotice.ts`) */
  reflectionPending: "公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。",
  /** CURRENT `DataUnavailableNotice` default */
  dataUnavailable: "データを取得できませんでした。",
  /** CURRENT `PartialFailureNotice` default title */
  partialFailure: "一部の処理に失敗しました。",
  /** CURRENT `ErrorCallout` fallback */
  error: "エラーが発生しました",
});

export type StatusNoticeType = "degraded" | "pending" | "success" | "info" | "unavailable";

export interface StatusNoticeProps {
  status: StatusNoticeType;
  /** Defaults: degraded / pending / unavailable use the CURRENT text above. */
  message?: React.ReactNode;
  title?: string;
  className?: string;
}

const DEFAULTS: Partial<Record<StatusNoticeType, { title?: string; message: string }>> = {
  degraded: { title: FEEDBACK_MESSAGES.degradedTitle, message: FEEDBACK_MESSAGES.degraded },
  pending: { message: FEEDBACK_MESSAGES.reflectionPending },
  unavailable: { message: FEEDBACK_MESSAGES.dataUnavailable },
};

/**
 * Non-blocking state notice. Like CURRENT (PublicDegradedBanner, SaveSuccessNotice,
 * ReflectionPendingNotice, DataUnavailableNotice) it is `role="status"`; errors that
 * need attention use ErrorCallout / PartialFailureNotice (`role="alert"`).
 */
export function StatusNotice({ status, message, title, className }: StatusNoticeProps): React.ReactElement {
  const fallback = DEFAULTS[status];
  const resolvedTitle = title ?? fallback?.title;
  return (
    <div
      role="status"
      aria-live="polite"
      className={["fn-status-notice", `fn-status-notice--${status}`, className].filter(Boolean).join(" ")}
    >
      {resolvedTitle ? <strong className="fn-status-title">{resolvedTitle}</strong> : null}
      <span className="fn-status-message">{message ?? fallback?.message}</span>
    </div>
  );
}

export interface PartialFailureNoticeProps {
  items: readonly string[];
  title?: string;
  className?: string;
}

/** CURRENT `src/components/ui/PartialFailureNotice.tsx`: nothing without items, `role="alert"`. */
export function PartialFailureNotice({
  items,
  title = FEEDBACK_MESSAGES.partialFailure,
  className,
}: PartialFailureNoticeProps): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div role="alert" className={["fn-partial-failure", className].filter(Boolean).join(" ")}>
      <p className="fn-partial-failure-title">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
