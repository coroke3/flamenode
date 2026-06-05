// Admin user detail page — /admin/users/[id]
function AdminUserDetailPage({ onNav, adminUserId }) {
  const creators = window.FN_CREATORS;
  const videos = window.FN_VIDEOS;
  const creator = creators.find(c => c.id === adminUserId) || creators[0];
  const userVideos = videos.filter(v => v.creator === creator.id);

  const X_IDS = [
    { handle: creator.handle,       status: "approved", primary: true  },
    { handle: creator.handle+"_old", status: "rejected", primary: false },
  ];
  const AUDIT_BY = [
    { action: "UPDATE", table: "videos",   record: "fn-003", time: "07/25 20:11" },
    { action: "CREATE", table: "chapters", record: "fn-003", time: "07/24 14:30" },
  ];
  const AUDIT_ON = [
    { action: "UPDATE", table: "users", record: creator.id, operator: "halo_loop_v", time: "07/20 10:00", diff: ["role"] },
  ];

  return (
    <main className="fn-main" data-screen-label="AdminUserDetail">
      <div className="fn-wrap">
        <button className="fn-cp-back fn-mono" style={{ marginTop: 20, display: "block" }} onClick={() => onNav("admin")}>
          ← 管理コンソール / ユーザー一覧
        </button>

        <header className="fn-manage-head" style={{ marginTop: 12 }}>
          <div className="fn-manage-head-left">
            <span className="fn-eyebrow">admin / users / {creator.id}</span>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:6 }}>
              <div className="fn-vcard-avatar" style={{ width:52, height:52, fontSize:22 }}>{creator.name.charAt(0)}</div>
              <div>
                <h1 className="fn-display fn-manage-title" style={{ fontSize:"clamp(28px,4vw,48px)" }}>{creator.name}</h1>
                <span className="fn-mono" style={{ fontSize:12, color:"var(--text-muted)" }}>ID: {creator.id}</span>
              </div>
            </div>
          </div>
          <div className="fn-manage-head-actions">
            <span className="fn-pill" data-tone="accent">creator</span>
            <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("creatorProfile", { creator: creator.id })}>
              公開ページ <i className="fa-solid fa-arrow-up-right-from-square"></i>
            </button>
          </div>
        </header>

        <div className="fn-admin-user-grid">
          {/* Left: user info */}
          <div className="fn-admin-user-main">
            {/* Stats */}
            <div className="fn-manage-stats" style={{ gridTemplateColumns:"repeat(4,1fr)", marginBottom:24 }}>
              {[
                { k:"作品数", v: userVideos.length },
                { k:"いいね（受け取り）", v: userVideos.reduce((s,v)=>s+(v.score/50|0),0) },
                { k:"ブックマーク", v: 8 },
                { k:"参加イベント", v: 3 },
              ].map((s,i) => (
                <div key={i} className="fn-manage-stat">
                  <span className="fn-eyebrow">{s.k}</span>
                  <span className="fn-display fn-manage-stat-v">{s.v}</span>
                </div>
              ))}
            </div>

            {/* X IDs */}
            <section className="fn-edit-section" style={{ marginBottom:20 }}>
              <h3 className="fn-edit-section-title">連携 X ID</h3>
              <table className="fn-admin-xid-tbl">
                <thead><tr><th>ハンドル</th><th>状態</th><th>プライマリ</th><th></th></tr></thead>
                <tbody>
                  {X_IDS.map((x,i) => (
                    <tr key={i} className="fn-admin-xid-row">
                      <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{x.handle}</td>
                      <td><span className="fn-pill" data-tone={x.status==="approved"?"ok":"muted"}>{x.status}</span></td>
                      <td>{x.primary && <span className="fn-pill" data-tone="accent">primary</span>}</td>
                      <td className="fn-admin-xid-ops">
                        {!x.primary && <button className="fn-btn" data-size="sm" data-variant="ghost">プライマリに設定</button>}
                        <button className="fn-btn" data-size="sm" data-variant="ghost" style={{ color:"var(--danger,#ff5a5f)" }}>削除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Videos */}
            <section className="fn-edit-section" style={{ marginBottom:20 }}>
              <h3 className="fn-edit-section-title">投稿作品</h3>
              <table className="fn-admin-xid-tbl">
                <thead><tr><th>コード</th><th>タイトル</th><th>イベント</th><th>スコア</th><th>投稿日</th><th></th></tr></thead>
                <tbody>
                  {userVideos.map(v => (
                    <tr key={v.id} className="fn-admin-xid-row">
                      <td className="fn-mono">{v.code}</td>
                      <td style={{ fontWeight:600,fontSize:13 }}>{v.title}</td>
                      <td className="fn-mono">{v.event.toUpperCase()}</td>
                      <td className="fn-mono">{v.score.toLocaleString()}</td>
                      <td className="fn-mono">{v.posted}</td>
                      <td><button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => onNav("video", { video: v.id })}>→</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Audit: by / on */}
            <section className="fn-edit-section" style={{ marginBottom:20 }}>
              <h3 className="fn-edit-section-title">操作ログ（このユーザーが行った操作）</h3>
              <table className="fn-admin-xid-tbl">
                <thead><tr><th>時刻</th><th>アクション</th><th>テーブル</th><th>レコード</th></tr></thead>
                <tbody>
                  {AUDIT_BY.map((r,i) => (
                    <tr key={i} className="fn-admin-xid-row">
                      <td className="fn-mono" style={{ fontSize:11 }}>{r.time}</td>
                      <td className="fn-mono" style={{ fontSize:11, fontWeight:700, color: r.action==="CREATE"?"var(--ok)":"var(--accent-strong)" }}>{r.action}</td>
                      <td className="fn-mono">{r.table}</td>
                      <td className="fn-mono" style={{ fontSize:11 }}>{r.record}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="fn-edit-section">
              <h3 className="fn-edit-section-title">操作ログ（このユーザーへの管理操作）</h3>
              <table className="fn-admin-xid-tbl">
                <thead><tr><th>時刻</th><th>アクション</th><th>差分フィールド</th><th>操作者</th></tr></thead>
                <tbody>
                  {AUDIT_ON.map((r,i) => (
                    <tr key={i} className="fn-admin-xid-row">
                      <td className="fn-mono" style={{ fontSize:11 }}>{r.time}</td>
                      <td className="fn-mono" style={{ fontSize:11,fontWeight:700,color:"var(--accent-strong)" }}>{r.action}</td>
                      <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{r.diff.join(", ")}</td>
                      <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{r.operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {/* Right: actions */}
          <aside className="fn-edit-aside">
            <div className="fn-edit-aside-card">
              <span className="fn-eyebrow">管理操作</span>
              <div className="fn-edit-aside-actions">
                <button className="fn-btn" data-size="sm" style={{ width:"100%" }}>ロール変更</button>
                <button className="fn-btn" data-size="sm" style={{ width:"100%" }}>アカウント停止</button>
                <button className="fn-btn" data-size="sm" style={{ width:"100%", color:"var(--danger,#ff5a5f)" }}>削除</button>
              </div>
            </div>
            <div className="fn-edit-aside-card">
              <span className="fn-eyebrow">アカウント情報</span>
              <dl className="fn-admin-user-dl fn-mono">
                <dt>Discord ID</dt><dd>discord_{creator.id}</dd>
                <dt>ロール</dt><dd>creator</dd>
                <dt>登録日</dt><dd>2025-03-14</dd>
                <dt>最終ログイン</dt><dd>2025-07-25</dd>
                <dt>like 数</dt><dd>22</dd>
                <dt>bookmark 数</dt><dd>8</dd>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

// ─── Dashboard Library page ──────────────────────────────────────
function DashboardLibraryPage({ onNav }) {
  const [tab, _setTab] = React.useState("like");
  const videos = window.FN_VIDEOS;
  const likedIds   = [videos[0].id, videos[2].id, videos[4].id, videos[6].id, videos[8].id];
  const bookmarkIds= [videos[1].id, videos[3].id, videos[7].id];
  const likedVids   = likedIds.map(id => videos.find(v => v.id === id)).filter(Boolean);
  const bookmarkVids= bookmarkIds.map(id => videos.find(v => v.id === id)).filter(Boolean);
  const display = tab === "like" ? likedVids : bookmarkVids;
  const otherCount  = tab === "like" ? bookmarkVids.length : likedVids.length;

  return (
    <main className="fn-main" data-screen-label="DashboardLibrary">
      <div className="fn-wrap">
        <header className="fn-cr-head">
          <div>
            <span className="fn-eyebrow">library — あなたのコレクション</span>
            <h1 className="fn-display fn-cr-title">ライブラリ</h1>
          </div>
          <div className="fn-cr-controls">
            <div className="fn-cr-segment">
              <button className={"fn-cr-seg-btn " + (tab==="like"?"is-active":"")} onClick={() => _setTab("like")}>
                <i className="fa-solid fa-heart" style={{ marginRight:6 }}></i>
                いいね ({likedVids.length})
              </button>
              <button className={"fn-cr-seg-btn " + (tab==="bookmark"?"is-active":"")} onClick={() => _setTab("bookmark")}>
                <i className="fa-regular fa-bookmark" style={{ marginRight:6 }}></i>
                ブックマーク ({bookmarkVids.length})
              </button>
            </div>
          </div>
        </header>

        {otherCount > 0 && (
          <div className="fn-library-other-hint fn-jp fn-mono">
            {tab === "like" ? "ブックマーク" : "いいね"} に {otherCount} 件あります ·
            <button className="fn-link" onClick={() => _setTab(tab === "like" ? "bookmark" : "like")} style={{ marginLeft:6 }}>見る</button>
          </div>
        )}

        {display.length === 0 ? (
          <div className="fn-library-empty">
            <i className={"fa-solid " + (tab==="like"?"fa-heart":"fa-bookmark")} style={{ fontSize:32, color:"var(--text-faint)", display:"block", textAlign:"center", marginBottom:12 }}></i>
            <p className="fn-jp" style={{ textAlign:"center", color:"var(--text-muted)" }}>
              {tab === "like" ? "いいねした作品がありません。" : "ブックマークした作品がありません。"}
            </p>
            <button className="fn-btn" data-variant="accent" style={{ margin:"14px auto 0", display:"flex" }} onClick={() => onNav("recommend")}>
              作品を探す →
            </button>
          </div>
        ) : (
          <div className="fn-list-grid" style={{ marginTop: 24 }}>
            {display.map(v => (
              <VideoCard key={v.id} video={v} onOpen={() => onNav("video", { video: v.id })} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { AdminUserDetailPage, DashboardLibraryPage });
