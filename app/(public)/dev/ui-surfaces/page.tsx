import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import settingsStyles from "@/components/settings/settings-page.module.css";
import videoStyles from "@/components/forms/VideoForm.module.css";
import socialStyles from "@/components/forms/SocialLinksEditor.module.css";

export const metadata: Metadata = { title: "UI surfaces preview (dev)" };
export const dynamic = "force-dynamic";

/**
 * ローカル目視用。production では 404。
 * personal 面のコントロール高さと settings/VideoForm 風の粗さを確認する。
 */
export default function DevUiSurfacesPage(): React.ReactElement {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main
      data-fn-surface="personal"
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "24px 16px 80px",
        display: "grid",
        gap: 28,
      }}
    >
      <header>
        <p className="fn-mono" style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
          DEV / UI SURFACES
        </p>
        <h1 className="fn-display" style={{ margin: "6px 0 8px", fontSize: 28 }}>
          設定・投稿コントロール目視
        </h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13 }}>
          production 非公開。高さ・余白・ボタンの一貫性確認用。
        </p>
      </header>

      <section className="fn-card" style={{ padding: 18 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>共通コントロール行</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input className="fn-input" defaultValue="fn-input" style={{ width: 180 }} />
          <select className="fn-select" defaultValue="a" style={{ width: 140 }}>
            <option value="a">fn-select</option>
            <option value="b">B</option>
          </select>
          <button type="button" className="fn-btn fn-btn-primary">
            primary
          </button>
          <button type="button" className="fn-btn fn-btn-secondary">
            secondary
          </button>
          <button type="button" className="fn-btn fn-btn-ghost">
            ghost
          </button>
          <button type="button" className="fn-btn fn-btn-sm fn-btn-ghost">
            sm
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>settings tabs / actionBtn</h2>
        <div className={settingsStyles.tabs}>
          <div className={settingsStyles.tabList} role="tablist">
            <a className={`${settingsStyles.tab} ${settingsStyles.tabActive}`} href="#x">
              <span className={settingsStyles.tabIcon} aria-hidden>
                X
              </span>
              <span className={settingsStyles.tabBody}>
                <span className={settingsStyles.tabLabel}>X ID</span>
                <span className={settingsStyles.tabMeta}>連携</span>
              </span>
            </a>
            <a className={settingsStyles.tab} href="#discord">
              <span className={settingsStyles.tabIcon} aria-hidden>
                D
              </span>
              <span className={settingsStyles.tabBody}>
                <span className={settingsStyles.tabLabel}>Discord</span>
                <span className={settingsStyles.tabMeta}>アカウント</span>
              </span>
            </a>
            <a className={settingsStyles.tab} href="#pref">
              <span className={settingsStyles.tabIcon} aria-hidden>
                P
              </span>
              <span className={settingsStyles.tabBody}>
                <span className={settingsStyles.tabLabel}>表示</span>
                <span className={settingsStyles.tabMeta}>テーマ</span>
              </span>
            </a>
          </div>
        </div>
        <div className={settingsStyles.card}>
          <div className={settingsStyles.cardHd}>
            <h3 className={settingsStyles.cardTitle}>行操作サンプル</h3>
          </div>
          <div style={{ padding: "16px 18px" }}>
            <div className={settingsStyles.rowOps}>
              <input className="fn-input" defaultValue="sample_x_id" style={{ flex: 1, minWidth: 140 }} />
              <button type="button" className={`${settingsStyles.actionBtn} ${settingsStyles.actionBtnPrimary}`}>
                保存
              </button>
              <button type="button" className={settingsStyles.actionBtn}>
                切替
              </button>
              <button type="button" className={`${settingsStyles.actionBtn} ${settingsStyles.actionBtnDanger}`}>
                解除
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={videoStyles.form}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>VideoForm 風フィールド</h2>
        <div className={videoStyles.field}>
          <label className={`${videoStyles.label} ${videoStyles.required}`} htmlFor="dev-title">
            タイトル
          </label>
          <input id="dev-title" className="fn-input" defaultValue="サンプル作品" />
          <p className={videoStyles.help}>help は 12px 想定</p>
        </div>
        <div className={videoStyles.field}>
          <label className={videoStyles.label} htmlFor="dev-yt">
            YouTube URL（任意）
          </label>
          <input id="dev-yt" className="fn-input" placeholder="https://www.youtube.com/watch?v=..." />
        </div>
        <div className={videoStyles.actions}>
          <button type="button" className="fn-btn fn-btn-ghost">
            戻る
          </button>
          <button type="button" className="fn-btn fn-btn-primary">
            提出する
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>SocialLinksEditor 風</h2>
        <div className={socialStyles.row}>
          <select className={socialStyles.select} defaultValue="x">
            <option value="x">X</option>
            <option value="web">Web</option>
          </select>
          <input className={socialStyles.input} defaultValue="https://x.com/example" />
          <button type="button" className={socialStyles.iconOnlyButton} aria-label="削除">
            ×
          </button>
        </div>
      </section>
    </main>
  );
}
