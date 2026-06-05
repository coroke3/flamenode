// Post chooser page — /dashboard/post
// Choose between: slotted post (via reserved slot) or unslotted post (archive/free)
// Shows reserved slots grouped by event, X ID approval status gate

const { useState: _pcUs } = React;

function PostChooserPage({ onNav }) {
  const events = window.FN_EVENTS;
  const [xStatus, setXStatus] = _pcUs("approved"); // approved | pending | rejected | null

  // Mock reserved slots
  const RESERVED_SLOTS = [
    { id: "slot-01", event: events[0], label: "08/30 21:00", slotKind: "time", status: "reserved", priorityReclaim: false },
    { id: "slot-02", event: events[0], label: "08/31 19:30", slotKind: "time", status: "submitted", videoTitle: "Pale Index" },
  ];
  const pendingSlots  = RESERVED_SLOTS.filter(s => s.status === "reserved");
  const submittedSlots = RESERVED_SLOTS.filter(s => s.status === "submitted");

  return (
    <main className="fn-main" data-screen-label="PostChooser">
      <div className="fn-wrap fn-postchooser">
        <header className="fn-pc-head">
          <button className="fn-cp-back fn-mono" onClick={() => onNav("dashboard")}>← ダッシュボード</button>
          <span className="fn-eyebrow" style={{ marginTop: 14, display: "block" }}>dashboard / post</span>
          <h1 className="fn-display fn-pc-title">投稿方法を選択</h1>
        </header>

        {/* X ID status gate */}
        <div className="fn-pc-state-switch">
          <span className="fn-eyebrow">プロトタイプ用 X ID 状態</span>
          {[["approved","承認済み"],["pending","申請中"],["rejected","却下"],["null","未設定"]].map(([id,label]) => (
            <button key={id} className={"fn-cr-seg-btn " + (xStatus===id?"is-active":"")} onClick={() => setXStatus(id)}>
              <span className="fn-mono">{label}</span>
            </button>
          ))}
        </div>

        {xStatus === "null" && (
          <div className="fn-pc-status-banner fn-pc-status-banner--warn">
            <i className="fa-solid fa-id-badge"></i>
            <div>
              <h3 className="fn-jp">X ID が設定されていません</h3>
              <p className="fn-jp fn-pc-banner-lead">
                投稿（動画の公開）には承認済みの X ID が必要です。枠の確保は X ID なしでも可能ですが、投稿にはあらかじめ申請・承認が必要です。
              </p>
              <button className="fn-btn" data-variant="accent" data-size="sm" style={{ marginTop: 8 }} onClick={() => onNav("settings")}>
                X ID を申請する →
              </button>
            </div>
          </div>
        )}

        {xStatus === "pending" && (
          <div className="fn-pc-status-banner fn-pc-status-banner--warn">
            <i className="fa-solid fa-clock"></i>
            <div>
              <h3 className="fn-jp">X ID の承認待ちです</h3>
              <p className="fn-jp fn-pc-banner-lead">
                現在の X ID は承認待ちです。枠の確保は行えますが、動画の投稿（公開）は承認後に可能になります。
                通常 24 時間以内に確認します。
              </p>
              <span className="fn-pill" data-tone="warn"><i className="fa-brands fa-x-twitter"></i> @halo_loop_v · 申請中</span>
            </div>
          </div>
        )}

        {xStatus === "rejected" && (
          <div className="fn-pc-status-banner fn-pc-status-banner--warn">
            <i className="fa-solid fa-circle-xmark"></i>
            <div>
              <h3 className="fn-jp">X ID が却下されました</h3>
              <p className="fn-jp fn-pc-banner-lead">
                X ID が確認できませんでした。ハンドルを再確認の上、再申請してください。
              </p>
              <div style={{ display:"flex",gap:8,marginTop:8 }}>
                <span className="fn-pill" data-tone="muted"><i className="fa-brands fa-x-twitter"></i> @halo_loop_v · 却下</span>
                <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("settings")}>再申請する</button>
              </div>
            </div>
          </div>
        )}

        {/* Choice cards */}
        <div className="fn-pc-grid">

          {/* Card A: Slotted post */}
          <section className="fn-pc-card">
            <div className="fn-pc-card-head">
              <i className="fa-solid fa-calendar-check fn-pc-card-icon"></i>
              <div>
                <h2 className="fn-display fn-pc-card-title">確保済みの枠に投稿</h2>
                <p className="fn-jp fn-pc-card-lead">予約した上映スロットに動画を紐付けます。</p>
              </div>
            </div>

            {RESERVED_SLOTS.length === 0 ? (
              <div className="fn-pc-empty">
                <p className="fn-jp">確保済みの枠はありません。</p>
                <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("reserve", { event: events[0].id })}>
                  枠を確保する →
                </button>
              </div>
            ) : (
              <ul className="fn-pc-slot-list">
                {RESERVED_SLOTS.map(s => (
                  <li key={s.id} className={"fn-pc-slot " + (s.status === "submitted" ? "fn-pc-slot--submitted" : "")}>
                    <div className="fn-pc-slot-info">
                      <span className="fn-display fn-pc-slot-label">{s.label}</span>
                      <span className="fn-mono fn-pc-slot-event">{s.event.code}</span>
                      {s.status === "submitted" && (
                        <span className="fn-pill" data-tone="ok"><i className="fa-solid fa-check"></i> 投稿済み: {s.videoTitle}</span>
                      )}
                    </div>
                    <div className="fn-pc-slot-actions">
                      {s.status === "reserved" && (
                        <button
                          className="fn-btn"
                          data-variant="accent"
                          data-size="sm"
                          disabled={xStatus !== "approved"}
                          onClick={() => onNav("submit")}
                        >
                          この枠に投稿 →
                        </button>
                      )}
                      {s.status === "submitted" && (
                        <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("video")}>
                          確認する →
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="fn-pc-card-foot">
              <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("reserve", { event: events[0].id })}>
                <i className="fa-solid fa-plus"></i> 枠をさらに確保する
              </button>
            </div>
          </section>

          {/* Card B: Unslotted post */}
          <section className="fn-pc-card">
            <div className="fn-pc-card-head">
              <i className="fa-solid fa-film fn-pc-card-icon"></i>
              <div>
                <h2 className="fn-display fn-pc-card-title">枠なしで投稿</h2>
                <p className="fn-jp fn-pc-card-lead">上映スロットに関係なく、作品を FlameNode に登録します。</p>
              </div>
            </div>

            <ul className="fn-pc-unslotted-list">
              {[
                { icon: "fa-archive", title: "アーカイブとして投稿", desc: "過去作品や、イベントに縛られない作品を登録。" },
                { icon: "fa-calendar-plus", title: "イベントに紐付けて投稿", desc: "公開中のイベントの作品として投稿（スロットなし）。" },
              ].map((opt, i) => (
                <li key={i} className="fn-pc-opt">
                  <i className={"fa-solid " + opt.icon + " fn-pc-opt-icon"}></i>
                  <div>
                    <span className="fn-pc-opt-title fn-jp">{opt.title}</span>
                    <span className="fn-jp fn-pc-opt-desc fn-field-hint">{opt.desc}</span>
                  </div>
                  <button
                    className="fn-btn"
                    data-variant={xStatus === "approved" ? "accent" : "ghost"}
                    data-size="sm"
                    disabled={xStatus !== "approved"}
                    onClick={() => onNav("submit")}
                  >
                    選択 →
                  </button>
                </li>
              ))}
            </ul>

            {xStatus !== "approved" && (
              <p className="fn-jp fn-field-hint" style={{ marginTop: 10 }}>
                <i className="fa-solid fa-lock" style={{ marginRight: 6 }}></i>
                枠なし投稿には承認済み X ID が必要です。
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { PostChooserPage });
