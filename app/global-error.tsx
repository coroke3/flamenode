"use client";

import * as React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "#0b0d10",
          color: "#f4f6ee",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>問題が発生しました</h1>
          <p style={{ margin: "0 0 20px", color: "#a8b0a4", lineHeight: 1.6 }}>
            アプリの表示中にエラーが発生しました。再試行してください。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 18px",
              border: 0,
              borderRadius: 9,
              fontWeight: 700,
              cursor: "pointer",
              background: "#c8f21f",
              color: "#1a1f03",
            }}
          >
            再試行
          </button>
        </main>
      </body>
    </html>
  );
}
