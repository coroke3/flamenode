"use client";

import * as React from "react";

type ApiResponse = {
  ok: boolean;
  message?: string;
  mode?: "preview" | "apply";
  preview_token?: string;
  plan_hash?: string;
  expires_at?: number;
  requires_repreview?: boolean;
  retryable?: boolean;
  summary?: Record<string, number>;
  warnings?: string[];
  errors?: string[];
  preview?: {
    events: Array<{ id: string; title: string; visibility_status: string }>;
    videos: Array<{ id: string; title: string; creator_display_name: string; visibility_status: string }>;
  };
  result?: unknown;
};

type PreviewCredential = {
  token: string;
  planHash: string;
  expiresAt: number;
};

export function LegacyCanonicalImportClient(): React.ReactElement {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [result, setResult] = React.useState<ApiResponse | null>(null);
  const [pending, setPending] = React.useState<"preview" | "apply" | null>(null);
  const [credential, setCredential] = React.useState<PreviewCredential | null>(null);

  function invalidatePreview(): void {
    setCredential(null);
  }

  async function submit(mode: "preview" | "apply"): Promise<void> {
    const form = formRef.current;
    if (!form || pending) return;
    if (mode === "apply" && !credential) {
      setResult({ ok: false, message: "先にプレビューを実行してください。" });
      return;
    }
    if (mode === "apply" && credential && credential.expiresAt <= Math.floor(Date.now() / 1000)) {
      setCredential(null);
      setResult({ ok: false, message: "プレビューの有効期限が切れました。再度プレビューしてください。" });
      return;
    }
    if (mode === "apply" && !window.confirm("R2に保存したプレビュー済みplanを新正本へ書き込みます。続行しますか？")) {
      return;
    }

    setPending(mode);
    const body = mode === "preview" ? new FormData(form) : new FormData();
    body.set("mode", mode);
    if (mode === "apply" && credential) {
      body.set("preview_token", credential.token);
      body.set("plan_hash", credential.planHash);
    }

    try {
      const response = await fetch("/api/admin/import/legacy", { method: "POST", body });
      const json = (await response.json()) as ApiResponse;
      setResult(json);
      if (mode === "preview") {
        setCredential(
          json.ok && json.preview_token && json.plan_hash && json.expires_at
            ? { token: json.preview_token, planHash: json.plan_hash, expiresAt: json.expires_at }
            : null,
        );
      } else if (json.ok || json.requires_repreview) {
        setCredential(null);
      }
    } catch {
      setResult({
        ok: false,
        message: "通信結果を確認できませんでした。二重送信を避けるため、少し待ってから同じpreviewで再試行してください。",
      });
    } finally {
      setPending(null);
    }
  }

  const expiresLabel = credential
    ? new Date(credential.expiresAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form
        ref={formRef}
        onChange={invalidatePreview}
        style={{ display: "grid", gap: 14, padding: 18, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)" }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <strong>旧形式ファイル</strong>
          <input name="files" type="file" accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values" multiple required className="fn-input" />
          <span className="fn-muted fn-text-sm">JSON・CSV・TSV、最大20ファイル、合計12MB、5,000行まで。</span>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <strong>イベント公開状態</strong>
            <select name="event_visibility" defaultValue="public" className="fn-input">
              <option value="public">公開</option>
              <option value="private">非公開</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <strong>作品公開状態</strong>
            <select name="video_visibility" defaultValue="public" className="fn-input">
              <option value="public">公開</option>
              <option value="private">非公開</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <strong>既存IDの扱い</strong>
            <select name="strategy" defaultValue="create_only" className="fn-input">
              <option value="create_only">既存IDがあれば停止</option>
              <option value="skip_existing">既存IDをスキップ</option>
              <option value="replace_imported">過去の旧形式インポート行だけ置換</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="fn-btn fn-btn-primary" disabled={!!pending} onClick={() => void submit("preview")}>
            {pending === "preview" ? "解析・保存中…" : "プレビュー"}
          </button>
          <button type="button" className="fn-btn fn-btn-danger" disabled={!!pending || !credential} onClick={() => void submit("apply")}>
            {pending === "apply" ? "書き込み中…" : "新正本へ書き込む"}
          </button>
          <span className="fn-muted fn-text-sm">
            {credential
              ? `planはR2へ固定済みです。有効期限: ${expiresLabel}`
              : "ファイルまたは設定を変更すると再プレビューが必要です。"}
          </span>
        </div>
      </form>

      {result ? <ImportResult result={result} /> : null}
    </div>
  );
}

function ImportResult({ result }: { result: ApiResponse }): React.ReactElement {
  return (
    <section aria-live="polite" style={{ display: "grid", gap: 12, padding: 18, border: `1px solid ${result.ok ? "var(--border-subtle)" : "var(--danger)"}`, borderRadius: "var(--radius-md)", background: "var(--bg-surface)" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>{result.ok ? (result.mode === "apply" ? "インポート完了" : "プレビュー結果") : "確認が必要です"}</h2>
      {result.message ? <p>{result.message}</p> : null}
      {result.plan_hash ? <p className="fn-muted fn-text-sm">plan hash: <code>{result.plan_hash}</code></p> : null}
      {result.summary ? (
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          {Object.entries(result.summary).map(([key, value]) => (
            <div key={key}><dt className="fn-muted fn-text-sm">{key}</dt><dd style={{ fontWeight: 700 }}>{value.toLocaleString()}</dd></div>
          ))}
        </dl>
      ) : null}
      {result.errors?.length ? <MessageList title="エラー" items={result.errors} /> : null}
      {result.warnings?.length ? <MessageList title="警告" items={result.warnings} /> : null}
      {result.preview?.events.length ? (
        <details><summary>イベント例</summary><ul>{result.preview.events.map((row) => <li key={row.id}><code>{row.id}</code> {row.title} ({row.visibility_status})</li>)}</ul></details>
      ) : null}
      {result.preview?.videos.length ? (
        <details><summary>作品例</summary><ul>{result.preview.videos.map((row) => <li key={row.id}><code>{row.id}</code> {row.title} / {row.creator_display_name} ({row.visibility_status})</li>)}</ul></details>
      ) : null}
      {result.result ? <pre style={{ margin: 0, overflow: "auto", fontSize: 12 }}>{JSON.stringify(result.result, null, 2)}</pre> : null}
    </section>
  );
}

function MessageList({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return <details open><summary>{title} ({items.length})</summary><ul>{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></details>;
}
