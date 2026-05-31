// Auth page: Login (Submit moved to page-submit.jsx)

// ─── LOGIN ──────────────────────────────────────────────────────
function LoginPage({ onNav, lang }) {
  return (
    <main className="fn-main fn-auth" data-screen-label="Login">
      <div className="fn-auth-grid">
        {/* Left: brand panel */}
        <aside className="fn-auth-aside">
          <div className="fn-auth-aside-top">
            <span className="fn-logo-mark fn-auth-mark" aria-hidden="true">
              <svg viewBox="0 0 693 840" height="34" fill="currentColor">
                <path d="M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z"></path>
              </svg>
            </span>
            <span className="fn-display fn-auth-brand-name">FlameNode</span>
          </div>
          <div className="fn-auth-aside-mid">
            <h2 className="fn-display fn-auth-aside-title">Sign in to<br />FlameNode.</h2>
            <p className="fn-jp fn-auth-aside-lead">
              X（Twitter）アカウントで認証します。投稿・枠確保・イベント運営にはサインインが必要です。
            </p>
          </div>
          <dl className="fn-auth-facts fn-mono">
            <div><dt>auth</dt><dd>X OAuth 2.0</dd></div>
            <div><dt>scope</dt><dd>read · profile</dd></div>
            <div><dt>guard</dt><dd>kv.normal</dd></div>
          </dl>
        </aside>

        {/* Right: form */}
        <div className="fn-auth-main">
          <div className="fn-auth-card">
            <span className="fn-eyebrow">welcome back</span>
            <h1 className="fn-display fn-auth-title">サインイン</h1>
            <p className="fn-auth-sub fn-jp">続けるにはアカウントを連携してください。</p>

            <button className="fn-auth-x" onClick={() => onNav("dashboard")}>
              <span className="fn-auth-x-icon" aria-hidden="true">𝕏</span>
              <span>X でサインイン</span>
            </button>

            <div className="fn-auth-divider"><span>または</span></div>

            <label className="fn-field">
              <span className="fn-field-label">ハンドル / Handle</span>
              <input className="fn-input fn-mono" placeholder="@your_handle" defaultValue="@halo_loop_v" />
            </label>
            <label className="fn-field">
              <span className="fn-field-label">アクセスキー / Access key</span>
              <input className="fn-input fn-mono" type="password" placeholder="••••••••••••" defaultValue="nodekey" />
            </label>
            <button className="fn-btn fn-auth-submit" data-variant="accent" data-size="lg" onClick={() => onNav("dashboard")}>
              サインイン →
            </button>

            <p className="fn-auth-foot fn-jp">
              初めての方は <button className="fn-link" onClick={() => onNav("dashboard")}>アカウント作成</button> ・
              <button className="fn-link" onClick={() => onNav("top")}>ゲストとして見る</button>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { LoginPage });
