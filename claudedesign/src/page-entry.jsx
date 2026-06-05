// Entry page — /entry
// Discord login gate → TOS check → Event selection or Past post

const { useState: _entUs } = React;

function EntryPage({ onNav }) {
  const [loginState, setLoginState] = _entUs("loggedIn"); // "guest" | "needTos" | "loggedIn"
  const [activeX, setActiveX] = _entUs("halo_loop_v");
  const events = window.FN_EVENTS.filter(e => e.id !== "archive");

  return (
    <main className="fn-main fn-entry" data-screen-label="Entry">
      <div className="fn-wrap">

        {/* Page hero */}
        <header className="fn-entry-hero">
          <span className="fn-eyebrow">entry</span>
          <h1 className="fn-display fn-entry-title">何をしますか？</h1>
          <p className="fn-jp fn-entry-lead">イベント参加か、過去作品の投稿を選んでください。</p>
        </header>

        {/* Prototype state switcher */}
        <div className="fn-entry-state-switch">
          <span className="fn-eyebrow">プロトタイプ状態切替</span>
          {[["guest","未ログイン"],["needTos","利用規約未同意"],["loggedIn","ログイン済"]].map(([id,label]) => (
            <button key={id} className={"fn-cr-seg-btn " + (loginState === id ? "is-active" : "")} onClick={() => setLoginState(id)}>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Status panel */}
        {loginState === "guest" && (
          <div className="fn-entry-status fn-entry-status--warn">
            <div className="fn-entry-status-body">
              <h2 className="fn-jp">まず Discord でログインしてください</h2>
              <p className="fn-jp fn-entry-status-lead">
                参加・投稿にはログインが必要です。連携時に取得した <code>access_token</code> は保存しません。
              </p>
              <button className="fn-auth-discord" style={{ width: "auto", maxWidth: 280, marginTop: 6 }} onClick={() => setLoginState("loggedIn")}>
                <i className="fa-brands fa-discord fn-auth-discord-icon"></i>
                Discord でログイン
              </button>
              <p className="fn-jp fn-entry-tos-note">
                ログイン後、枠確保や投稿などの書き込み操作を行う前に、最新の利用規約への同意をお願いする場合があります。
              </p>
            </div>
          </div>
        )}

        {loginState === "needTos" && (
          <div className="fn-entry-status fn-entry-status--warn">
            <div className="fn-entry-status-body">
              <h2 className="fn-jp">利用規約への同意が必要です</h2>
              <p className="fn-jp fn-entry-status-lead">書き込み操作（枠確保・投稿・いいね等）の前に、最新の利用規約への同意が必要です。</p>
              <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => setLoginState("loggedIn")} style={{ marginTop: 8 }}>利用規約を確認する →</button>
            </div>
          </div>
        )}

        {loginState === "loggedIn" && (
          <div className="fn-entry-status fn-entry-status--ok">
            <i className="fa-solid fa-circle-check" style={{ color: "var(--ok)" }}></i>
            <span className="fn-jp">ログイン済み</span>
            <span className="fn-v-divider" style={{ height: 14 }} />
            <span className="fn-mono fn-entry-xid">
              Active X ID: <i className="fa-brands fa-x-twitter"></i> @{activeX}
            </span>
            <button className="fn-link fn-entry-change-xid" onClick={() => onNav("settings")}>切替</button>
          </div>
        )}

        {/* Choice grid */}
        <div className={"fn-entry-grid " + (loginState === "guest" ? "fn-entry-grid--disabled" : "")}>

          {/* Card 1: Event participation */}
          <section className="fn-entry-card" aria-labelledby="join-event">
            <div className="fn-entry-card-head">
              <i className="fa-solid fa-calendar fn-entry-card-icon"></i>
              <h2 id="join-event" className="fn-display fn-entry-card-title">イベントに参加する</h2>
            </div>
            <p className="fn-jp fn-entry-card-lead">
              開催中のイベントのスロットを確保して、作品を投稿できます。
            </p>
            <div className="fn-entry-event-list">
              {events.map((ev, i) => {
                const status = window.deriveStatus(ev, "auto");
                const accepting = status.kind === "entry" || status.kind === "submit";
                return (
                  <button
                    key={ev.id}
                    className={"fn-entry-event-card " + (!accepting ? "fn-entry-event-card--closed" : "")}
                    onClick={() => accepting && onNav("reserve", { event: ev.id })}
                    disabled={!accepting}
                  >
                    <div className="fn-entry-event-top">
                      <span className="fn-display fn-entry-event-name">{ev.title}</span>
                      <span className="fn-pill" data-tone={accepting ? "accent" : "muted"}>
                        {window.statusLabel(status.kind, "ja")}
                      </span>
                    </div>
                    <div className="fn-entry-event-meta fn-mono">
                      <span>残り {ev.slotsAvailable} 枠</span>
                      <span className="fn-entry-event-sep" />
                      <span>募集: {ev.rangeText}</span>
                      {ev.entryCloseIso && <span> · 募集締切: {ev.entryCloseIso}</span>}
                    </div>
                    <span className="fn-entry-event-arrow">→</span>
                  </button>
                );
              })}
            </div>
            {loginState === "loggedIn" && events.filter(e => window.deriveStatus(e,"auto").kind === "entry" || window.deriveStatus(e,"auto").kind === "submit").length === 1 && (
              <button
                className="fn-btn fn-entry-primary-btn"
                data-variant="accent" data-size="lg"
                onClick={() => onNav("reserve", { event: events[0].id })}
              >
                <i className="fa-solid fa-calendar"></i>
                スロットを確保する →
              </button>
            )}
          </section>

          {/* Card 2: Past video post */}
          <section className="fn-entry-card" aria-labelledby="post-unslotted">
            <div className="fn-entry-card-head">
              <i className="fa-solid fa-film fn-entry-card-icon"></i>
              <h2 id="post-unslotted" className="fn-display fn-entry-card-title">過去の作品を投稿する</h2>
            </div>
            <p className="fn-jp fn-entry-card-lead">
              イベントの枠に関係なく、既存の作品を FlameNode に登録できます。投稿には承認済みの X ID が必要です。
            </p>
            <div className="fn-entry-requirements">
              <div className="fn-entry-req">
                <i className={loginState === "loggedIn" ? "fa-solid fa-circle-check" : "fa-solid fa-circle"}
                   style={{ color: loginState === "loggedIn" ? "var(--ok)" : "var(--text-faint)" }}></i>
                <span className="fn-jp">Discord ログイン</span>
              </div>
              <div className="fn-entry-req">
                <i className={activeX ? "fa-solid fa-circle-check" : "fa-solid fa-circle-xmark"}
                   style={{ color: activeX ? "var(--ok)" : "var(--warn)" }}></i>
                <span className="fn-jp">承認済み X ID の設定</span>
                {!activeX && <button className="fn-link" onClick={() => onNav("settings")}>設定する</button>}
              </div>
              <div className="fn-entry-req">
                <i className="fa-regular fa-circle" style={{ color: "var(--text-faint)" }}></i>
                <span className="fn-jp">YouTube URL / 動画 ID</span>
              </div>
            </div>
            <div className="fn-entry-card-actions">
              <button
                className="fn-btn fn-entry-primary-btn"
                data-variant={loginState === "loggedIn" ? "accent" : "ghost"} data-size="lg"
                onClick={() => onNav("submit")}
                disabled={loginState !== "loggedIn"}
              >
                <i className="fa-solid fa-film"></i>
                作品を投稿する →
              </button>
              <button
                className="fn-btn"
                data-variant="ghost"
                onClick={() => onNav("dashboard")}
              >
                ダッシュボードへ
              </button>
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}

Object.assign(window, { EntryPage });
