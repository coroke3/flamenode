"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  forceResendNotification,
  retryAllFailedNotifications,
  retryFailedNotification,
} from "@/lib/actions/notification-admin";

type NotificationActionResult = {
  ok: boolean;
  message?: string;
};

type NotificationAction = (
  formData: FormData,
) => Promise<NotificationActionResult>;

type Props =
  | {
      kind: "retry" | "force-resend";
      id: string;
    }
  | {
      kind: "bulk-retry";
      id?: never;
    };

const ACTIONS: Record<
  Props["kind"],
  NotificationAction
> = {
  retry: retryFailedNotification,
  "force-resend": forceResendNotification,
  "bulk-retry": retryAllFailedNotifications,
};

const CONFIG = {
  retry: {
    label: "再試行",
    pendingLabel: "...",
    className:
      "fn-btn fn-btn-ghost fn-btn-sm",
    confirmMessage: null,
    fallbackError:
      "リトライに失敗しました。",
    showSuccess: false,
  },
  "force-resend": {
    label: "強制再送",
    pendingLabel: "...",
    className:
      "fn-btn fn-btn-ghost fn-btn-sm",
    confirmMessage:
      "同内容の通知を再送キューに追加しますか？",
    fallbackError:
      "再送に失敗しました。",
    showSuccess: false,
  },
  "bulk-retry": {
    label:
      "failed を一括リトライ (上限 50)",
    pendingLabel: "...",
    className:
      "fn-btn fn-btn-danger fn-btn-sm",
    confirmMessage:
      "failed 通知をまとめてリトライしますか? (上限 50 件)",
    fallbackError:
      "一括リトライに失敗しました。",
    showSuccess: true,
  },
} as const;

export function NotificationActionButton(
  props: Props,
): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] =
    React.useTransition();

  const [message, setMessage] =
    React.useState<{
      text: string;
      error: boolean;
    } | null>(null);

  const config = CONFIG[props.kind];

  const run = () => {
    if (
      config.confirmMessage &&
      !window.confirm(config.confirmMessage)
    ) {
      return;
    }

    setMessage(null);

    const formData = new FormData();

    if (
      props.kind !== "bulk-retry"
    ) {
      formData.set("id", props.id);
    }

    startTransition(async () => {
      const result =
        await ACTIONS[props.kind](formData);

      if (!result.ok) {
        setMessage({
          text:
            result.message ??
            config.fallbackError,
          error: true,
        });
        return;
      }

      if (
        config.showSuccess &&
        result.message
      ) {
        setMessage({
          text: result.message,
          error: false,
        });
      }

      router.refresh();
    });
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <button
        type="button"
        className={config.className}
        disabled={busy}
        onClick={run}
      >
        {busy
          ? config.pendingLabel
          : config.label}
      </button>

      {message ? (
        <span
          role={
            message.error
              ? "alert"
              : "status"
          }
          style={{
            color: message.error
              ? "var(--accent-danger)"
              : "var(--text-muted)",
            fontSize: 10,
          }}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
