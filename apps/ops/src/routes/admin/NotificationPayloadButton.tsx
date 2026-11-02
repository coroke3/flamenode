// Port of CURRENT src/components/admin/NotificationPayloadButton.tsx (MIG-0734 U02). Same markup; Escape closes (keyboard).
import * as React from "react";

/**
 * payload_json を整形してモーダル表示する小さなビューア。
 * JSON.parse できなかった場合は raw を表示する。
 */
export function NotificationPayloadButton({ payload }: { payload: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const pretty = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }, [payload]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={() => setOpen(true)}>
        payload
      </button>
      {open ? (
        <div
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 100,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="notification payload"
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)", padding: 20, maxWidth: 720, width: "90%",
              maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>notification payload</strong>
              <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" autoFocus onClick={() => setOpen(false)}>
                閉じる
              </button>
            </header>
            <pre
              style={{
                margin: 0, padding: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)",
                fontSize: 11, lineHeight: 1.55, overflow: "auto", fontFamily: "monospace",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
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
