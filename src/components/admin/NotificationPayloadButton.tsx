"use client";

import * as React from "react";

interface Props {
  payload: string;
}

/**
 * payload_json を整形してモーダル表示する小さなビューア。
 * JSON.parse できなかった場合は raw を表示する。
 */
export function NotificationPayloadButton({ payload }: Props): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const pretty = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }, [payload]);

  return (
    <>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        onClick={() => setOpen(true)}
      >
        payload
      </button>
      {open ? (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              padding: 20,
              maxWidth: 720,
              width: "90%",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>notification payload</strong>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </header>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-sm)",
                fontSize: 11,
                lineHeight: 1.55,
                overflow: "auto",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {pretty}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  );
}
