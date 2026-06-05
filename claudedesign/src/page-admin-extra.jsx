// Admin video detail — /admin/videos/[id]
// Shows video info, moderation cases, status control

const { useState: _avUs } = React;

const CASE_TYPES = {
  copyright:    { label: "著作権", color: "var(--danger,#ff5a5f)" },
  inappropriate:{ label: "不適切", color: "var(--warn)" },
  spam:         { label: "スパム",  color: "var(--warn)" },
  other:        { label: "その他", color: "var(--text-muted)" },
};

function AdminVideoDetail({ onNav, selectedVideo }) {
  const videos = window.FN_VIDEOS;
  const creators = window.FN_CREATORS;
  const video = videos.find(v => v.id === selectedVideo) || videos[0];
  const creator = creators.find(c => c.id === video.creator);
  const event = window.FN_EVENTS.find(e => e.id === video.event);

  const [status, setStatus] = _avUs("public"); // public | hidden | archived
  const [cases, setCases] = _avUs([
    { id:"mc-01", type:"copyright", status:"open",   public_reason:"楽曲ライセンス要確認", private_note:"楽曲 Node/KAI を要精査", created_at:"07/24 18:00", resolved_at:null  },
    { id:"mc-02", type:"other",     status:"closed", public_reason:"初回投稿フォーム不備", private_note:"差し戻し→再提出済み",    created_at:"07/20 10:00", resolved_at:"07/21 09:00" },
  ]);
  const [newCaseType, setNewCaseType] = _avUs("other");
  const [newPublicReason, setNewPublicReason] = _avUs("");
  const [newPrivateNote, setNewPrivateNote] = _avUs("");
  const [showNewCase, setShowNewCase] = _avUs(false);
  const openCount = cases.filter(c => c.status === "open").length;

  const addCase = () => {
    if (!newPublicReason.trim()) return;
    setCases(cs => [...cs, {
      id: "mc-" + (cs.length+1),
      type: newCaseType,
      status: "open",
      public_reason: newPublicReason,
      private_note: newPrivateNote,
      created_at: new Date().toLocaleDateString("ja"),
      resolved_at: null,
    }]);
    setNewPublicReason(""); setNewPrivateNote(""); setShowNewCase(false);
  };
  const resolveCase = (id) => setCases(cs => cs.map(c => c.id===id ? {...c, status:"closed", resolved_at:"今"} : c));

  return (
    <div className="fn-admin-sub" data-screen-label="AdminVideoDetail">
      {/* Back */}
      <div className="fn-admin-sub-head">
        <div>
          <button className="fn-cp-back fn-mono" onClick={() => { /* go to admin videos sub */ }}>← 動画一覧</button>
          <h2 className="fn-display fn-admin-sub-title" style={{ marginTop:8 }}>{video.title}</h2>
        </div>
        <div className="fn-admin-xid-ops">
          <select
            className="fn-input"
            style={{ height:34,padding:"0 10px",fontSize:13 }}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="public">公開中</option>
            <option value="hidden">非公開</option>
            <option value="archived">アーカイブ</option>
          </select>
          <button className="fn-btn" data-variant="accent" onClick={() => onNav("video", { video: video.id })}>
            <i className="fa-solid fa-arrow-up-right-from-square"></i> サイトで見る
          </button>
        </div>
      </div>

      {/* Moderation cases banner */}
      {openCount > 0 && (
        <div className="fn-admin-alert fn-admin-alert--warn">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span className="fn-jp">未解決のモデレーションケースが {openCount} 件あります</span>
        </div>
      )}

      <div className="fn-edit-grid">
        <div className="fn-edit-left">
          {/* Video info */}
          <section className="fn-edit-section">
            <div className="fn-avd-meta-grid">
              <div className="fn-avd-thumb"><Thumb video={video} /></div>
              <dl className="fn-admin-user-dl fn-mono" style={{ marginTop:0 }}>
                <dt>コード</dt>     <dd>{video.code}</dd>
                <dt>クリエイター</dt><dd>{creator.name} (@{creator.handle})</dd>
                <dt>イベント</dt>   <dd>{event.code}</dd>
                <dt>楽曲</dt>       <dd>{video.music}</dd>
                <dt>尺</dt>         <dd>{video.duration}</dd>
                <dt>チャプター</dt> <dd>{video.chapters} 件</dd>
                <dt>投稿日</dt>     <dd>{video.posted}</dd>
                <dt>スコア</dt>     <dd>{video.score.toLocaleString()}</dd>
                <dt>公開状態</dt>   <dd>
                  <span className="fn-pill" data-tone={status==="public"?"ok":status==="hidden"?"warn":"muted"}>{status}</span>
                </dd>
              </dl>
            </div>
          </section>

          {/* Moderation cases */}
          <section className="fn-edit-section">
            <div className="fn-edit-section-head">
              <h3 className="fn-edit-section-title">モデレーションケース</h3>
              <button className="fn-btn" data-size="sm" data-variant="accent" onClick={() => setShowNewCase(true)}>
                + 新規ケース
              </button>
            </div>

            {showNewCase && (
              <div className="fn-avd-new-case">
                <label className="fn-field">
                  <span className="fn-field-label">ケース種別</span>
                  <select className="fn-input" style={{ height:36,padding:"0 10px",fontSize:13 }} value={newCaseType} onChange={e => setNewCaseType(e.target.value)}>
                    {Object.entries(CASE_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                <label className="fn-field">
                  <span className="fn-field-label">公開理由 <span className="fn-field-req">必須</span></span>
                  <input className="fn-input" value={newPublicReason} onChange={e => setNewPublicReason(e.target.value)} placeholder="投稿者にも表示される理由" />
                </label>
                <label className="fn-field">
                  <span className="fn-field-label">内部メモ</span>
                  <input className="fn-input" value={newPrivateNote} onChange={e => setNewPrivateNote(e.target.value)} placeholder="管理側のみ表示" />
                </label>
                <div className="fn-admin-xid-ops">
                  <button className="fn-btn" data-variant="ghost" onClick={() => setShowNewCase(false)}>キャンセル</button>
                  <button className="fn-btn" data-variant="accent" onClick={addCase} disabled={!newPublicReason.trim()}>作成</button>
                </div>
              </div>
            )}

            {cases.length === 0 ? (
              <p className="fn-jp" style={{ color:"var(--text-muted)",fontSize:13 }}>ケースなし</p>
            ) : (
              <ul className="fn-avd-cases">
                {cases.map((c, i) => {
                  const t = CASE_TYPES[c.type] || CASE_TYPES.other;
                  return (
                    <li key={c.id} className={"fn-avd-case " + (c.status==="open"?"fn-avd-case--open":"fn-avd-case--closed")}>
                      <div className="fn-avd-case-head">
                        <span className="fn-avd-case-type fn-mono" style={{ color:t.color }}>{t.label}</span>
                        <span className="fn-pill" data-tone={c.status==="open"?"warn":"muted"}>
                          {c.status === "open" ? "未解決" : "解決済み"}
                        </span>
                        <span className="fn-mono fn-avd-case-time">{c.created_at}</span>
                      </div>
                      <div className="fn-avd-case-body">
                        <span className="fn-jp fn-avd-case-public"><i className="fa-solid fa-eye" style={{ fontSize:11,marginRight:5,color:"var(--text-faint)" }}></i>{c.public_reason}</span>
                        {c.private_note && (
                          <span className="fn-jp fn-avd-case-private"><i className="fa-solid fa-eye-slash" style={{ fontSize:11,marginRight:5,color:"var(--text-faint)" }}></i>{c.private_note}</span>
                        )}
                        {c.resolved_at && <span className="fn-mono" style={{ fontSize:10.5,color:"var(--text-faint)" }}>解決日時: {c.resolved_at}</span>}
                      </div>
                      {c.status === "open" && (
                        <button className="fn-btn" data-size="sm" data-variant="accent" onClick={() => resolveCase(c.id)}>
                          解決済みにする
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Right: status aside */}
        <aside className="fn-edit-aside">
          <div className="fn-edit-aside-card">
            <span className="fn-eyebrow">クイック操作</span>
            <div className="fn-edit-aside-actions">
              <button className="fn-btn" style={{ width:"100%" }} onClick={() => setStatus("public")}>
                <i className="fa-solid fa-eye"></i> 公開にする
              </button>
              <button className="fn-btn" style={{ width:"100%" }} onClick={() => setStatus("hidden")}>
                <i className="fa-solid fa-eye-slash"></i> 非公開にする
              </button>
              <button className="fn-btn" style={{ width:"100%",color:"var(--danger,#ff5a5f)" }} onClick={() => setStatus("archived")}>
                <i className="fa-solid fa-box-archive"></i> アーカイブ
              </button>
            </div>
          </div>
          <div className="fn-edit-aside-card">
            <span className="fn-eyebrow">関連リンク</span>
            <div className="fn-edit-aside-actions">
              <button className="fn-btn" data-variant="ghost" style={{ width:"100%" }} onClick={() => onNav("video", { video: video.id })}>
                公開ページ →
              </button>
              <button className="fn-btn" data-variant="ghost" style={{ width:"100%" }} onClick={() => onNav("adminUserDetail", { adminUserId: video.creator })}>
                クリエイター詳細 →
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Admin notifications (outbox) ─────────────────────────────────
const NOTIF_STATUSES = ["all","pending","processing","sent","failed","cancelled"];
const NOTIF_TYPES = ["all","slot_reserved","video_approved","x_id_approved","x_id_rejected","terms_updated"];
const MOCK_OUTBOX = [
  { id:"n01", type:"slot_reserved",   status:"sent",       recipient:"halo_loop_v",   event_id:"pvsf2025s", created_at:"07/25 20:11", sent_at:"07/25 20:11" },
  { id:"n02", type:"video_approved",  status:"sent",       recipient:"frame_index__", event_id:"pvsf2025s", created_at:"07/25 19:42", sent_at:"07/25 19:42" },
  { id:"n03", type:"x_id_approved",   status:"sent",       recipient:"halo_loop_v",   event_id:null,        created_at:"07/20 10:00", sent_at:"07/20 10:01" },
  { id:"n04", type:"x_id_rejected",   status:"failed",     recipient:"negativecue",   event_id:null,        created_at:"07/19 18:00", sent_at:null },
  { id:"n05", type:"slot_reserved",   status:"pending",    recipient:"nuiton",        event_id:"ncnc",      created_at:"07/25 22:30", sent_at:null },
  { id:"n06", type:"terms_updated",   status:"cancelled",  recipient:"rin_otsuka_",   event_id:null,        created_at:"07/15 09:00", sent_at:null },
  { id:"n07", type:"video_approved",  status:"processing", recipient:"tsukimi_track", event_id:"pvsf2025s", created_at:"07/25 21:00", sent_at:null },
];

function AdminNotificationsPage() {
  const [statusF, setStatusF] = React.useState("all");
  const [typeF, setTypeF] = React.useState("all");
  const [q, setQ] = React.useState("");

  const filtered = MOCK_OUTBOX.filter(n =>
    (statusF === "all" || n.status === statusF) &&
    (typeF   === "all" || n.type === typeF) &&
    (!q || n.recipient.includes(q) || n.type.includes(q))
  );
  const counts = NOTIF_STATUSES.reduce((acc, s) => {
    acc[s] = s === "all" ? MOCK_OUTBOX.length : MOCK_OUTBOX.filter(n => n.status === s).length;
    return acc;
  }, {});
  const stuckCount = MOCK_OUTBOX.filter(n => n.status === "processing").length;
  const statusColor = s => ({ sent:"var(--ok)", failed:"var(--danger,#ff5a5f)", pending:"var(--text-muted)", processing:"var(--warn)", cancelled:"var(--text-faint)" })[s] || "var(--text-muted)";

  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">通知配信</h2>
        {stuckCount > 0 && (
          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
            <span className="fn-pill" data-tone="warn">{stuckCount} 件 processing</span>
            <button className="fn-btn" data-size="sm" data-variant="accent">一括再試行</button>
          </div>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="fn-cr-segment" style={{ flexWrap:"wrap" }}>
        {NOTIF_STATUSES.map(s => (
          <button key={s} className={"fn-cr-seg-btn " + (statusF===s?"is-active":"")} onClick={() => setStatusF(s)}>
            <span className="fn-mono">{s.toUpperCase()} ({counts[s]})</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="fn-admin-audit-filters">
        <select className="fn-input fn-mono" style={{ height:34,padding:"0 10px",fontSize:12 }} value={typeF} onChange={e => setTypeF(e.target.value)}>
          {NOTIF_TYPES.map(t => <option key={t} value={t}>{t === "all" ? "全タイプ" : t}</option>)}
        </select>
        <input className="fn-input fn-mono" style={{ height:34,padding:"0 10px",fontSize:12,width:200 }} placeholder="受取人 / タイプ検索" value={q} onChange={e => setQ(e.target.value)} />
        <span className="fn-mono" style={{ fontSize:12,color:"var(--text-muted)" }}>{filtered.length} 件</span>
      </div>

      <table className="fn-admin-xid-tbl">
        <thead><tr><th>タイプ</th><th>受取人</th><th>イベント</th><th>状態</th><th>作成</th><th>送信</th><th></th></tr></thead>
        <tbody>
          {filtered.map(n => (
            <tr key={n.id} className="fn-admin-xid-row">
              <td className="fn-mono" style={{ fontSize:11 }}>{n.type}</td>
              <td className="fn-mono fn-admin-xid-handle"><i className="fa-brands fa-x-twitter"></i> @{n.recipient}</td>
              <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{n.event_id || "—"}</td>
              <td><span className="fn-mono" style={{ fontSize:11,fontWeight:700,color:statusColor(n.status) }}>{n.status.toUpperCase()}</span></td>
              <td className="fn-mono" style={{ fontSize:11 }}>{n.created_at}</td>
              <td className="fn-mono" style={{ fontSize:11,color:"var(--text-muted)" }}>{n.sent_at || "—"}</td>
              <td className="fn-admin-xid-ops">
                {(n.status === "failed" || n.status === "pending") && (
                  <button className="fn-btn" data-size="sm" data-variant="ghost">再試行</button>
                )}
                {n.status === "pending" && (
                  <button className="fn-btn" data-size="sm" data-variant="ghost" style={{ color:"var(--danger,#ff5a5f)" }}>キャンセル</button>
                )}
                <button className="fn-btn" data-size="sm" data-variant="ghost">ペイロード</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Admin Rules (terms versions) ─────────────────────────────────
const TERMS_VERSIONS = [
  { id:"tv-01", version:"8.1", status:"published",  major:false, title:"v8.1 — X ID申請フロー追記", updated_at:"2025-07-25", user_count:412, reaccept_count:0 },
  { id:"tv-02", version:"8.0", status:"published",  major:true,  title:"v8.0 — Discord認証移行",   updated_at:"2025-04-10", user_count:408, reaccept_count:408 },
  { id:"tv-03", version:"7.2", status:"archived",   major:false, title:"v7.2 — 投稿ガイド補足",    updated_at:"2025-01-15", user_count:312, reaccept_count:0 },
];

function AdminRulesPage() {
  const [statusF, setStatusF] = React.useState("any");
  const filtered = TERMS_VERSIONS.filter(v => statusF === "any" || v.status === statusF);

  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">規約管理</h2>
        <button className="fn-btn" data-variant="accent" data-size="sm">
          <i className="fa-solid fa-plus"></i> 新規バージョン
        </button>
      </div>

      <div className="fn-admin-xid-guide fn-jp" style={{ background:"var(--bg-elevated)", padding:"12px 16px", borderRadius:"var(--r-card)" }}>
        <i className="fa-solid fa-circle-info" style={{ marginRight:8, color:"var(--text-muted)" }}></i>
        major 公開時は全ユーザー（{TERMS_VERSIONS[0].user_count}名）が次回投稿時に再同意を求められます。
      </div>

      <div className="fn-cr-segment" style={{ width:"fit-content" }}>
        {["any","published","draft","archived"].map(s => (
          <button key={s} className={"fn-cr-seg-btn " + (statusF===s?"is-active":"")} onClick={() => setStatusF(s)}>
            <span className="fn-mono">{s.toUpperCase()}</span>
          </button>
        ))}
      </div>

      <table className="fn-admin-xid-tbl">
        <thead><tr><th>バージョン</th><th>タイトル</th><th>種別</th><th>状態</th><th>更新日</th><th>対象ユーザー</th><th>再同意件数</th><th></th></tr></thead>
        <tbody>
          {filtered.map(v => (
            <tr key={v.id} className="fn-admin-xid-row">
              <td className="fn-mono">{v.version}</td>
              <td style={{ fontWeight:600,fontSize:13 }}>{v.title}</td>
              <td><span className="fn-pill" data-tone={v.major?"warn":"muted"}>{v.major?"major":"minor"}</span></td>
              <td><span className="fn-pill" data-tone={v.status==="published"?"ok":v.status==="draft"?"warn":"muted"}>{v.status}</span></td>
              <td className="fn-mono" style={{ fontSize:11 }}>{v.updated_at}</td>
              <td className="fn-mono">{v.user_count}</td>
              <td className="fn-mono">{v.reaccept_count > 0 ? v.reaccept_count : "—"}</td>
              <td className="fn-admin-xid-ops">
                <button className="fn-btn" data-size="sm" data-variant="ghost">編集</button>
                {v.status === "draft" && <button className="fn-btn" data-size="sm" data-variant="accent">公開</button>}
                {v.status === "published" && <button className="fn-btn" data-size="sm" data-variant="ghost">アーカイブ</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Admin API Endpoints ──────────────────────────────────────────
const MOCK_ENDPOINTS = [
  { id:"ep-01", event_id:"pvsf2025s", event_title:"PVSF2025S", is_active:1, created_at:"07/01" },
  { id:"ep-02", event_id:"ncnc",      event_title:"NCNC2025",   is_active:0, created_at:"06/15" },
];

function AdminApiEndpointsPage() {
  const [endpoints, setEndpoints] = React.useState(MOCK_ENDPOINTS);
  const [selectedEventId, setSelectedEventId] = React.useState(window.FN_EVENTS[0].id);
  const [preview, setPreview] = React.useState(null);
  const events = window.FN_EVENTS;

  const toggleActive = (id) => setEndpoints(eps => eps.map(e => e.id===id ? {...e, is_active: e.is_active ? 0 : 1} : e));
  const addEndpoint = () => {
    const ev = events.find(e => e.id === selectedEventId);
    if (!ev) return;
    setEndpoints(eps => [...eps, { id:"ep-"+(eps.length+1), event_id:ev.id, event_title:ev.title, is_active:0, created_at:"今日" }]);
  };

  const samplePayload = {
    event: { id:"pvsf2025s", title:"PVSF2025S" },
    videos: window.FN_VIDEOS.filter(v=>v.event==="pvsf2025s").slice(0,3).map(v => ({
      id: v.id, code: v.code, title: v.title, youtube_video_id: v.id, creator: v.creator,
    })),
    generated_at: "2025-07-25T20:00:00Z",
  };

  return (
    <div className="fn-admin-sub">
      <div className="fn-admin-sub-head">
        <h2 className="fn-display fn-admin-sub-title">公開 API 管理</h2>
      </div>

      <div className="fn-admin-xid-guide fn-jp">
        <i className="fa-solid fa-circle-info" style={{ marginRight:8, color:"var(--text-muted)" }}></i>
        各エンドポイントは対応するイベントの動画リストを JSON で返します。アクティブにすると公開されます。
      </div>

      <table className="fn-admin-xid-tbl">
        <thead><tr><th>エンドポイント ID</th><th>イベント</th><th>状態</th><th>作成日</th><th></th></tr></thead>
        <tbody>
          {endpoints.map(ep => (
            <tr key={ep.id} className="fn-admin-xid-row">
              <td className="fn-mono" style={{ fontSize:11 }}>/api/endpoints/{ep.id}</td>
              <td style={{ fontWeight:600 }}>{ep.event_title}</td>
              <td>
                <span className="fn-pill" data-tone={ep.is_active?"ok":"muted"}>
                  {ep.is_active ? "アクティブ" : "非アクティブ"}
                </span>
              </td>
              <td className="fn-mono" style={{ fontSize:11 }}>{ep.created_at}</td>
              <td className="fn-admin-xid-ops">
                <button className="fn-btn" data-size="sm" data-variant="ghost" onClick={() => setPreview(preview===ep.id ? null : ep.id)}>
                  {preview===ep.id ? "閉じる" : "プレビュー"}
                </button>
                <button className="fn-btn" data-size="sm" data-variant={ep.is_active?"ghost":"accent"} onClick={() => toggleActive(ep.id)}>
                  {ep.is_active ? "無効化" : "有効化"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Payload preview */}
      {preview && (
        <div className="fn-avd-new-case">
          <span className="fn-eyebrow" style={{ display:"block",marginBottom:8 }}>ペイロードプレビュー（サンプル）</span>
          <pre className="fn-mono fn-api-preview">{JSON.stringify(samplePayload, null, 2)}</pre>
        </div>
      )}

      {/* Create new */}
      <div className="fn-xidmerge-new">
        <span className="fn-eyebrow" style={{ display:"block",marginBottom:10 }}>新規エンドポイント作成</span>
        <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
          <select className="fn-input" style={{ height:38,padding:"0 10px",fontSize:13,flex:1 }} value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
          <button className="fn-btn" data-variant="accent" onClick={addEndpoint}>作成</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdminVideoDetail, AdminNotificationsPage, AdminRulesPage, AdminApiEndpointsPage });
