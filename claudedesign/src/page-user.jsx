// User profile page (public creator profile) — /user/[id]

const { useState: _usUseState } = React;

function UserPage({ onNav, lang }) {
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS;
  const me = creators[2]; // halo / loop
  const myVideos = videos.slice(0, 9);
  const [tab, setTab] = _usUseState("works");

  return (
    <main className="fn-main" data-screen-label="UserProfile">
      {/* Cover band */}
      <div className="fn-user-cover">
        <div className="fn-user-cover-bg" />
        <div className="fn-thumb-grid" aria-hidden="true" />
      </div>

      <div className="fn-wrap fn-user">
        {/* Profile header */}
        <header className="fn-user-head">
          <div className="fn-user-avatar">{me.name.charAt(0)}</div>
          <div className="fn-user-id">
            <h1 className="fn-display fn-user-name">{me.name}</h1>
            <span className="fn-mono fn-user-handle">@{me.handle}</span>
            <p className="fn-user-bio fn-jp">夜と導線をテーマに、個人制作で映像を作っています。PVSF・NCNC 常連。</p>
            <div className="fn-user-links">
              <button className="fn-vd-sns" aria-label="X"><i className="fa-brands fa-x-twitter"></i></button>
              <button className="fn-vd-sns" aria-label="YouTube"><i className="fa-brands fa-youtube"></i></button>
              <button className="fn-vd-sns" aria-label="外部リンク"><i className="fa-solid fa-link"></i></button>
            </div>
          </div>
          <div className="fn-user-actions">
            <button className="fn-btn" data-variant="accent">フォロー</button>
            <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("settings")}>プロフィール編集</button>
          </div>
        </header>

        {/* Stats */}
        <div className="fn-user-stats">
          <div className="fn-user-stat"><span className="fn-display fn-user-stat-v">{me.videos}</span><span className="fn-user-stat-k fn-jp">作品</span></div>
          <div className="fn-user-stat"><span className="fn-display fn-user-stat-v">1,206</span><span className="fn-user-stat-k fn-jp">フォロワー</span></div>
          <div className="fn-user-stat"><span className="fn-display fn-user-stat-v">84.2k</span><span className="fn-user-stat-k fn-jp">総再生</span></div>
          <div className="fn-user-stat"><span className="fn-display fn-user-stat-v">06</span><span className="fn-user-stat-k fn-jp">参加イベント</span></div>
        </div>

        {/* Tabs */}
        <div className="fn-user-tabs">
          {[
            { id: "works", label: "作品" },
            { id: "events", label: "参加イベント" },
            { id: "about", label: "プロフィール" },
          ].map(t => (
            <button key={t.id} className={"fn-user-tab " + (tab === t.id ? "is-active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {tab === "works" && (
          <div className="fn-list-grid fn-user-works">
            {myVideos.map(v => <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />)}
          </div>
        )}

        {tab === "events" && (
          <div className="fn-user-events">
            {window.FN_EVENTS.map(ev => (
              <div key={ev.id} className="fn-user-event-row" onClick={() => onNav("event", { event: ev.id })}>
                <span className="fn-mono fn-user-event-code">{ev.code}</span>
                <div className="fn-user-event-info">
                  <span className="fn-user-event-title">{ev.title}</span>
                  <span className="fn-user-event-sub fn-jp">{ev.subtitle}</span>
                </div>
                <span className="fn-mono fn-user-event-count">{Math.max(1, ev.id === "archive" ? 5 : 2)} 作品</span>
                <span className="fn-vd-posted" aria-hidden="true">→</span>
              </div>
            ))}
          </div>
        )}

        {tab === "about" && (
          <dl className="fn-user-about">
            <div><dt className="fn-jp">活動名</dt><dd>{me.name}</dd></div>
            <div><dt className="fn-jp">読み方</dt><dd>ハロループ</dd></div>
            <div><dt className="fn-jp">映像歴</dt><dd>3〜5年</dd></div>
            <div><dt className="fn-jp">使用ソフト</dt><dd>After Effects · Premiere Pro · Blender</dd></div>
            <div><dt className="fn-jp">拠点</dt><dd>東京</dd></div>
            <div><dt className="fn-jp">紹介</dt><dd className="fn-jp">夜と導線をテーマに個人制作。コンタクトは X DM まで。</dd></div>
          </dl>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { UserPage });
