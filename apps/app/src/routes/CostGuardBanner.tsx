import * as React from "react";
import {
  createOperationModeBannerApi,
  type BannerMode,
  type BannerSnapshot,
} from "../api/operationMode.js";

type BannerApi = ReturnType<typeof createOperationModeBannerApi>;

type Tone = {
  bg: string;
  border: string;
  color: string;
  label: string;
  description: string;
};

/**
 * MIG-0718 U02: exact CURRENT CostGuardBanner tone/markup parity.
 * Reads only the public banner endpoint; no admin D1, session or writes.
 * U03 will mount below MIG-0701's auth shell wrapper, before <main>.
 */
const TONE: Record<BannerMode, Tone> = {
  economy: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "省コストモード",
    description: "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。",
  },
  read_only: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "読み取り専用モード",
    description: "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。",
  },
  static_only: {
    bg: "var(--accent-warning-soft, #fff3cd)",
    border: "var(--accent-warning, #d97706)",
    color: "var(--accent-warning, #b45309)",
    label: "静的JSONモード",
    description: "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。",
  },
  maintenance: {
    bg: "var(--accent-danger-soft, #f8d7da)",
    border: "var(--accent-danger, #dc2626)",
    color: "var(--accent-danger, #991b1b)",
    label: "メンテナンス中",
    description: "サイトはメンテナンス中です。一部機能が利用できません。",
  },
};

const defaultApi = createOperationModeBannerApi();

/** Render separately from the async effect so errors/normal mode show no banner. */
export function CostGuardBannerView({
  snapshot,
}: {
  snapshot: BannerSnapshot | null;
}): React.ReactElement | null {
  if (!snapshot) return null;
  const tone = TONE[snapshot.mode];
  return (
    <div
      role="status"
      aria-live="polite"
      className="cgb-banner"
      style={{
        background: tone.bg,
        borderBottomColor: tone.border,
        color: tone.color,
      }}
    >
      <div className="fn-public-container cgb-inner">
        <strong>{tone.label}:</strong>
        <span>{tone.description}</span>
        {snapshot.reason ? <em className="cgb-reason">(理由: {snapshot.reason})</em> : null}
      </div>
    </div>
  );
}

/** A failed or unmounted request may never change the rendered banner. */
export function CostGuardBanner({
  api = defaultApi,
}: {
  api?: BannerApi;
}): React.ReactElement | null {
  const [state, setState] = React.useState<{ api: BannerApi; value: BannerSnapshot | null }>({
    api,
    value: null,
  });
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ api, value: null });
    Promise.resolve()
      .then(() => api.getBanner(controller.signal))
      .then(
        (value) => {
          if (!controller.signal.aborted) setState({ api, value });
        },
        () => {
          if (!controller.signal.aborted) setState({ api, value: null });
        },
      );
    return () => controller.abort();
  }, [api]);

  // Avoid showing stale mode/reason between changing providers and the new effect.
  return <CostGuardBannerView snapshot={state.api === api ? state.value : null} />;
}
