// Auth flow — Discord primary auth + optional X credit link
// Views: signin → discord (OAuth) → register → xlink (optional) ; status (X ID guard)

const { useState: _auUseState } = React;

const AUTH_FACTS = {
  signin:   [["auth", "Discord OAuth 2.0"], ["scope", "identify · email"], ["guard", "kv.normal"]],
  discord:  [["provider", "discord.com"], ["scope", "identify · email"], ["expires", "60 min"]],
  register: [["step", "profile setup"], ["discord", "halo#4821"], ["plan", "creator"]],
  xlink:    [["provider", "x.com"], ["purpose", "credits · display"], ["required", "任意"]],
  status:   [["discord", "connected"], ["x-ids", "2 linked"], ["active", "@halo_loop_v"]],
};

function LoginPage({ onNav, lang }) {
  const [view, setView] = _auUseState("signin");

  const asideCopy = {
    signin:   { title: "Sign in to\nFlameNode.", lead: "Discord アカウントで認証します。投稿・枠確保・イベント運営にはサインインが必要です。" },
    discord:  { title: "Connect\nyour Discord.", lead: "FlameNode はあなたの Discord アカウントを認証に使用します。読み取り（identify）権限のみを要求します。" },
    register: { title: "Set up\nyour profile.", lead: "公開プロフィールを作成します。スロット公開ページやクレジットに表示される情報です。" },
    xlink:    { title: "Link your\nX account.", lead: "X ID はクレジット・作品表示名として使用されます。投稿・DM 等は一切行いません。連携は任意です。" },
    status:   { title: "X ID\nguard.", lead: "連携した X ID の承認状態を管理します。却下された場合、元の枠は24時間優先的に再取得できます。" },
  }[view];

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
            <h2 className="fn-display fn-auth-aside-title">{asideCopy.title.split("\n").map((l, i) => <React.Fragment key={i}>{l}<br /></React.Fragment>)}</h2>
            <p className="fn-jp fn-auth-aside-lead">{asideCopy.lead}</p>
          </div>
          <dl className="fn-auth-facts fn-mono">
            {AUTH_FACTS[view].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="fn-auth-viewswitch">
            <span className="fn-eyebrow">画面切替</span>
            <div className="fn-auth-viewswitch-btns">
              {[["signin","サインイン"],["discord","Discord"],["register","登録"],["xlink","X連携"],["status","ID状態"]].map(([id, l]) => (
                <button key={id} className={"fn-auth-vbtn " + (view === id ? "is-active" : "")} onClick={() => setView(id)}>{l}</button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right: form */}
        <div className="fn-auth-main">
          {view === "signin"   && <SignInView   onNav={onNav} setView={setView} />}
          {view === "discord"  && <DiscordView  onNav={onNav} setView={setView} />}
          {view === "register" && <RegisterView onNav={onNav} setView={setView} />}
          {view === "xlink"    && <XLinkView    onNav={onNav} setView={setView} />}
          {view === "status"   && <StatusView   onNav={onNav} setView={setView} />}
        </div>
      </div>
    </main>
  );
}

// ─── Sign in ────────────────────────────────────────────────────
function SignInView({ onNav, setView }) {
  return (
    <div className="fn-auth-card">
      <span className="fn-eyebrow">welcome back</span>
      <h1 className="fn-display fn-auth-title">サインイン</h1>
      <p className="fn-auth-sub fn-jp">Discord アカウントで続けてください。</p>

      <button className="fn-auth-discord" onClick={() => setView("discord")}>
        <i className="fa-brands fa-discord fn-auth-discord-icon"></i>
        <span>Discord でサインイン</span>
      </button>

      <div className="fn-auth-note fn-jp">
        <i className="fa-solid fa-circle-info"></i>
        <span>FlameNode の認証は Discord で行います。X アカウントはサインイン後にクレジット連携として任意で追加できます。</span>
      </div>

      <p className="fn-auth-foot fn-jp">
        初めての方も Discord ボタンからどうぞ ·
        <button className="fn-link" onClick={() => onNav("top")}> ゲストとして見る</button>
      </p>
    </div>
  );
}

// ─── Discord OAuth authorize ─────────────────────────────────────
function DiscordView({ onNav, setView }) {
  return (
    <div className="fn-auth-card">
      <button className="fn-auth-back" onClick={() => setView("signin")}>← 戻る</button>
      <span className="fn-eyebrow">Discord 認証</span>
      <h1 className="fn-display fn-auth-title">Discord 認証</h1>
      <p className="fn-auth-sub fn-jp">FlameNode が以下の権限を要求しています。</p>

      <div className="fn-oauth-card">
        <div className="fn-oauth-apps">
          <span className="fn-oauth-app">
            <span className="fn-logo-mark" aria-hidden="true">
              <svg viewBox="0 0 693 840" height="22" fill="currentColor"><path d="M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z"></path></svg>
            </span>
          </span>
          <span className="fn-oauth-link" aria-hidden="true">⇄</span>
          <span className="fn-oauth-app fn-oauth-app--discord"><i className="fa-brands fa-discord"></i></span>
        </div>
        <div className="fn-oauth-acct">
          <span className="fn-sb-saveid-avatar" style={{ width: 36, height: 36, fontSize: 16, background: "#5865F2", color: "#fff" }}>h</span>
          <div>
            <span className="fn-oauth-acct-name">halo / loop</span>
            <span className="fn-mono fn-oauth-acct-handle">halo#4821 · Discord</span>
          </div>
          <button className="fn-link">別アカウント</button>
        </div>
        <ul className="fn-oauth-scopes">
          <li><i className="fa-solid fa-check"></i><div><span className="fn-jp">ユーザー情報の読み取り</span><span className="fn-oauth-scope-sub fn-jp">表示名・アバター・Discord ID</span></div></li>
          <li><i className="fa-solid fa-check"></i><div><span className="fn-jp">メールアドレスの確認</span><span className="fn-oauth-scope-sub fn-jp">本人性確認のみ。外部に共有しません</span></div></li>
          <li className="fn-oauth-scope-no"><i className="fa-solid fa-xmark"></i><div><span className="fn-jp">サーバー・DM・メッセージはしません</span><span className="fn-oauth-scope-sub fn-jp">書き込み権限は一切要求しません</span></div></li>
        </ul>
      </div>

      <div className="fn-auth-actions">
        <button className="fn-btn" data-variant="ghost" data-size="lg" onClick={() => setView("signin")}>拒否</button>
        <button className="fn-auth-discord" style={{ flex: 1, height: 44, margin: 0, borderRadius: 10, fontSize: 14, fontWeight: 600 }} onClick={() => setView("register")}>
          <i className="fa-brands fa-discord fn-auth-discord-icon"></i><span>許可してFlameNodeへ</span>
        </button>
      </div>
      <p className="fn-auth-foot fn-jp">既に登録済みの場合は <button className="fn-link" onClick={() => onNav("dashboard")}>マイページへ</button></p>
    </div>
  );
}

// ─── Register (first-time profile) ───────────────────────────────
function RegisterView({ onNav, setView }) {
  const [name, setName] = _auUseState("halo / loop");
  const [agreed, setAgreed] = _auUseState(true);
  return (
    <div className="fn-auth-card fn-auth-card--wide">
      <button className="fn-auth-back" onClick={() => setView("discord")}>← 戻る</button>
      <span className="fn-eyebrow">初回登録</span>
      <h1 className="fn-display fn-auth-title">プロフィール登録</h1>
      <p className="fn-auth-sub fn-jp">Discord で認証しました。公開プロフィールを設定します。</p>

      {/* Discord verified badge */}
      <div className="fn-reg-discord">
        <span className="fn-sb-saveid-avatar" style={{ width: 38, height: 38, fontSize: 17, background: "#5865F2", color: "#fff" }}>h</span>
        <div className="fn-reg-xid-text">
          <span className="fn-reg-xid-name">halo / loop</span>
          <span className="fn-mono fn-reg-xid-handle"><i className="fa-brands fa-discord" style={{ color: "#5865F2" }}></i> halo#4821 · 認証済み</span>
        </div>
        <span className="fn-pill" data-tone="ok">verified</span>
      </div>

      <label className="fn-field">
        <span className="fn-field-label">表示名<span className="fn-field-req">必須</span></span>
        <input className="fn-input" value={name} onChange={e => setName(e.target.value)} placeholder="公開される名前" />
        <span className="fn-field-hint fn-jp">スロット公開ページ・クレジットに表示されます。後から変更できます。</span>
      </label>
      <div className="fn-field-grid">
        <label className="fn-field">
          <span className="fn-field-label">読み方（フリガナ）</span>
          <input className="fn-input" defaultValue="ハロループ" placeholder="ハロループ" />
        </label>
        <label className="fn-field">
          <span className="fn-field-label">映像歴</span>
          <select className="fn-input" defaultValue="3-5">
            <option value="0-1">〜1年</option>
            <option value="1-3">1〜3年</option>
            <option value="3-5">3〜5年</option>
            <option value="5+">5年以上</option>
          </select>
        </label>
      </div>
      <label className="fn-field">
        <span className="fn-field-label">アイコン画像（250×250）</span>
        <div className="fn-icon-picker">
          <div className="fn-icon-current" style={{ background: "#5865F2", color: "#fff" }}>h</div>
          <div className="fn-icon-history">
            <span className="fn-field-hint fn-jp">Discord のアバターを取り込み済み。差し替え可。</span>
            <div className="fn-icon-thumbs">
              {[0,1,2].map(i => <button key={i} className={"fn-icon-thumb " + (i === 0 ? "is-active" : "")} aria-label="icon" />)}
              <button className="fn-icon-thumb fn-icon-upload" aria-label="upload">＋</button>
            </div>
          </div>
        </div>
      </label>

      <label className="fn-checkbox">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        <span className="fn-jp">利用規約（v8.1）とプライバシーポリシーに同意します</span>
      </label>

      <div className="fn-auth-actions" style={{ marginTop: 8 }}>
        <button className="fn-btn fn-auth-submit" data-variant="accent" data-size="lg" disabled={!agreed || !name} onClick={() => setView("xlink")} style={{ flex: 1 }}>
          次へ — X 連携の設定 →
        </button>
      </div>
      <p className="fn-auth-foot fn-jp">X 連携は後からでも設定できます · <button className="fn-link" onClick={() => onNav("dashboard")}>スキップしてはじめる</button></p>
    </div>
  );
}

// ─── X Link (application-based, no X API) ────────────────────────
function XLinkView({ onNav, setView }) {
  const [handle, setHandle] = _auUseState("");
  const [submitted, setSubmitted] = _auUseState(false);
  const clean = handle.replace(/^@/, "").trim();
  const valid = clean.length >= 1;

  if (submitted) {
    return (
      <div className="fn-auth-card">
        <span className="fn-eyebrow">申請受付</span>
        <h1 className="fn-display fn-auth-title">申請を受付しました</h1>
        <div className="fn-xlink-done">
          <i className="fa-solid fa-circle-check fn-xlink-done-icon"></i>
          <div>
            <span className="fn-xlink-done-handle fn-mono"><i className="fa-brands fa-x-twitter"></i> @{clean}</span>
            <p className="fn-jp fn-xlink-done-msg">運営が確認後、承認します。承認されるとスロット一覧・作品クレジットにハンドルが表示されます。</p>
          </div>
        </div>
        <div className="fn-auth-note fn-jp">
          <i className="fa-solid fa-circle-info"></i>
          <span>承認は手動で行います。却下された場合はメール通知はありません。X ID 状態ページで確認してください。</span>
        </div>
        <button className="fn-btn fn-auth-submit" data-variant="accent" data-size="lg" onClick={() => onNav("dashboard")} style={{ marginTop: 12, width: "100%" }}>
          マイページへ →
        </button>
      </div>
    );
  }

  return (
    <div className="fn-auth-card">
      <button className="fn-auth-back" onClick={() => setView("register")}>← 戻る</button>
      <span className="fn-eyebrow">X ID 連携（任意）</span>
      <h1 className="fn-display fn-auth-title">X ID 連携</h1>
      <p className="fn-auth-sub fn-jp">X アカウントをクレジット・スロット表示名として申請します。任意です。</p>

      <div className="fn-xlink-why">
        <div className="fn-xlink-why-row">
          <i className="fa-solid fa-id-badge"></i>
          <div>
            <span className="fn-jp">スロット一覧に @ハンドルで表示</span>
            <span className="fn-field-hint fn-jp">例：08/30 21:00 — halo / loop (@halo_loop_v)</span>
          </div>
        </div>
        <div className="fn-xlink-why-row">
          <i className="fa-solid fa-film"></i>
          <div>
            <span className="fn-jp">作品クレジットに X リンクを表示</span>
            <span className="fn-field-hint fn-jp">視聴者があなたの X に直接アクセスできます</span>
          </div>
        </div>
        <div className="fn-xlink-why-row">
          <i className="fa-solid fa-lock"></i>
          <div>
            <span className="fn-jp">認証には使いません · X API 不使用</span>
            <span className="fn-field-hint fn-jp">ハンドル入力のみ。運営が目視で承認します</span>
          </div>
        </div>
      </div>

      <label className="fn-field" style={{ marginTop: 8 }}>
        <span className="fn-field-label">X ハンドル / X handle</span>
        <div className="fn-xlink-input-wrap">
          <span className="fn-xlink-at fn-mono">@</span>
          <input
            className="fn-input fn-mono"
            style={{ paddingLeft: 32 }}
            placeholder="your_handle"
            value={handle}
            onChange={e => setHandle(e.target.value.replace(/^@+/, ""))}
          />
        </div>
        <span className="fn-field-hint fn-jp">@ は不要です。正確に入力してください。</span>
      </label>

      <div className="fn-auth-note fn-jp" style={{ marginTop: 4 }}>
        <i className="fa-solid fa-circle-info"></i>
        <span>申請後、運営がハンドルの存在を確認して手動承認します。通常 24 時間以内。</span>
      </div>

      <button
        className="fn-btn fn-auth-submit"
        data-variant="accent"
        data-size="lg"
        disabled={!valid}
        onClick={() => setSubmitted(true)}
        style={{ marginTop: 8, width: "100%" }}
      >
        <i className="fa-brands fa-x-twitter" style={{ marginRight: 8 }}></i>
        @{clean || "handle"} で申請する
      </button>

      <p className="fn-auth-foot fn-jp">
        <button className="fn-link" onClick={() => onNav("dashboard")}>連携せずにはじめる</button>
      </p>
    </div>
  );
}

// ─── Inline add-X-handle form (used in StatusView) ───────────────
function AddXHandleForm({ onAdded }) {
  const [open, setOpen] = _auUseState(false);
  const [handle, setHandle] = _auUseState("");
  const clean = handle.replace(/^@/, "").trim();
  const valid = clean.length >= 1;
  if (!open) {
    return (
      <button className="fn-add-x-btn fn-mono" onClick={() => setOpen(true)}>
        <i className="fa-brands fa-x-twitter"></i>
        <span>別の X アカウントを申請</span>
        <i className="fa-solid fa-plus fn-add-x-plus"></i>
      </button>
    );
  }
  return (
    <div className="fn-add-x-form">
      <span className="fn-eyebrow" style={{ marginBottom: 8, display: "block" }}>新規 X ID 申請</span>
      <div className="fn-xlink-input-wrap">
        <span className="fn-xlink-at fn-mono">@</span>
        <input
          className="fn-input fn-mono"
          style={{ paddingLeft: 32 }}
          placeholder="your_handle"
          value={handle}
          autoFocus
          onChange={e => setHandle(e.target.value.replace(/^@+/, ""))}
        />
      </div>
      <div className="fn-add-x-actions">
        <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => { setOpen(false); setHandle(""); }}>キャンセル</button>
        <button className="fn-btn" data-variant="accent" data-size="sm" disabled={!valid} onClick={() => { onAdded(clean); setOpen(false); setHandle(""); }}>
          申請する
        </button>
      </div>
      <span className="fn-field-hint fn-jp" style={{ marginTop: 6, display: "block" }}>運営が手動で確認します。承認後に反映されます。</span>
    </div>
  );
}

// ─── Status (X ID guard board) ───────────────────────────────────
function StatusView({ onNav, setView }) {
  const IDS = [
    { name: "halo / loop",      handle: "halo_loop_v",     state: "approved", note: "active · 保存名義" },
    { name: "frame index",      handle: "frame_index__",   state: "pending",  note: "承認待ち · 提出は保留中" },
    { name: "negative cue (旧)",handle: "negativecue_old", state: "rejected", note: "却下 · 優先再取得 23:41 残" },
  ];
  const stateMeta = {
    approved: { jp: "承認済み", tone: "ok",     icon: "fa-circle-check" },
    pending:  { jp: "承認待ち", tone: "warn",   icon: "fa-clock" },
    rejected: { jp: "却下",     tone: "danger", icon: "fa-circle-xmark" },
  };
  return (
    <div className="fn-auth-card fn-auth-card--wide">
      <button className="fn-auth-back" onClick={() => setView("signin")}>← 戻る</button>
      <span className="fn-eyebrow">X ID の状態</span>
      <h1 className="fn-display fn-auth-title">X ID 状態</h1>
      <p className="fn-auth-sub fn-jp">連携している X ID と承認状態。却下時は元枠を24時間優先再取得できます。</p>

      {/* Discord account (read-only, always connected) */}
      <div className="fn-status-discord">
        <span className="fn-eyebrow">サインインアカウント</span>
        <div className="fn-reg-discord" style={{ marginTop: 8 }}>
          <span className="fn-sb-saveid-avatar" style={{ width: 38, height: 38, fontSize: 17, background: "#5865F2", color: "#fff" }}>h</span>
          <div className="fn-reg-xid-text">
            <span className="fn-reg-xid-name">halo / loop</span>
            <span className="fn-mono fn-reg-xid-handle"><i className="fa-brands fa-discord" style={{ color: "#5865F2" }}></i> halo#4821 · Discord</span>
          </div>
          <span className="fn-pill" data-tone="ok">primary</span>
        </div>
      </div>

      <div className="fn-status-divider fn-eyebrow">連携 X アカウント（クレジット用）</div>

      <ul className="fn-idlist">
        {IDS.map(id => {
          const m = stateMeta[id.state];
          return (
            <li key={id.handle} className={"fn-idrow fn-idrow--" + id.state}>
              <span className="fn-sb-saveid-avatar" style={{ width: 38, height: 38, fontSize: 16 }}>{id.name.charAt(0)}</span>
              <div className="fn-idrow-id">
                <span className="fn-idrow-name">{id.name}</span>
                <span className="fn-mono fn-idrow-handle"><i className="fa-brands fa-x-twitter"></i> @{id.handle}</span>
              </div>
              <span className="fn-idrow-note fn-jp">{id.note}</span>
              <span className={"fn-idrow-state fn-idstate-" + m.tone}><i className={"fa-solid " + m.icon}></i>{m.jp}</span>
              <div className="fn-idrow-ops">
                {id.state === "rejected" && <button className="fn-btn" data-size="sm" data-variant="accent">優先再取得</button>}
                {id.state === "pending"  && <button className="fn-btn" data-size="sm" data-variant="ghost">取消</button>}
                {id.state === "approved" && <button className="fn-link">保存名義に設定中</button>}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="fn-id-add">
        <AddXHandleForm onAdded={() => {}} />
      </div>

      <p className="fn-auth-foot fn-jp"><button className="fn-link" onClick={() => onNav("dashboard")}>マイページへ戻る</button></p>
    </div>
  );
}

Object.assign(window, { LoginPage });
