// Public pages: About, Rules, Event Slots (public view)

const { useState: _pubUs } = React;

// ─── About page ──────────────────────────────────────────────────
function AboutPage({ onNav }) {
  const FEATURES = [
    { icon:"fa-grid-2",     title:"作品とイベントを同じ文脈で見る", body:"投稿された作品、参加イベント、枠、メンバー、チャプターコメントをばらばらにせず、作品を中心にたどれるようにします。" },
    { icon:"fa-id-badge",   title:"XIDを表の名前にする",           body:"Discordはログインと権限確認の入口、XIDは公開プロフィールや作品の名義として扱います。連携前のデータも後から整理できます。" },
    { icon:"fa-sliders",    title:"運営と投稿者の作業を軽くする",   body:"枠確保、提出、CSVインポート、履歴確認、権限付与を同じ管理線上に置き、イベント後の確認まで迷いにくくします。" },
  ];
  const FLOW = [
    "Discord でログイン",
    "X ID とプロフィールを確認",
    "イベント枠または通常投稿を選択",
    "作品・メンバー・SNS 情報を提出",
    "公開後に再生リストや個人ページからたどる",
  ];
  return (
    <main className="fn-main fn-about" data-screen-label="About">
      <div className="fn-wrap">
        {/* Hero */}
        <section className="fn-about-hero">
          <div className="fn-about-logo-area">
            <svg viewBox="0 0 693 840" className="fn-about-logomark" fill="currentColor" aria-hidden="true">
              <path d="M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z"></path>
            </svg>
          </div>
          <div className="fn-about-hero-body">
            <span className="fn-eyebrow">Creator archive and event workflow</span>
            <h1 className="fn-display fn-about-title">FlameNode</h1>
            <p className="fn-jp fn-about-lead">
              FlameNode は、YouTube 作品、クリエイター名義、イベント参加、投稿枠、履歴をひとつの流れで扱うためのプラットフォームです。
              作品を見つける人にも、投稿する人にも、運営する人にも、同じ情報が同じ意味で届くことを目指しています。
            </p>
            <div className="fn-about-actions">
              <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("list")}>
                <i className="fa-solid fa-play"></i> 作品を見る
              </button>
              <button className="fn-btn" data-variant="ghost" data-size="lg" onClick={() => onNav("entry")}>
                <i className="fa-solid fa-calendar"></i> 参加できるイベント
              </button>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="fn-about-features" aria-label="FlameNode の特徴">
          {FEATURES.map((f, i) => (
            <article key={i} className="fn-about-feature">
              <span className="fn-about-feature-icon"><i className={"fa-solid " + f.icon}></i></span>
              <h2 className="fn-jp fn-about-feature-title">{f.title}</h2>
              <p className="fn-jp fn-about-feature-body">{f.body}</p>
            </article>
          ))}
        </section>

        {/* Flow */}
        <section className="fn-about-flow">
          <h2 className="fn-display fn-about-flow-title">FLOW</h2>
          <ol className="fn-about-flow-list">
            {FLOW.map((step, i) => (
              <li key={i} className="fn-about-flow-step">
                <span className="fn-mono fn-about-flow-no">{String(i+1).padStart(2,"0")}</span>
                <span className="fn-jp fn-about-flow-label">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* CTA */}
        <section className="fn-about-cta">
          <div className="fn-about-cta-body">
            <h2 className="fn-display fn-about-cta-title">JOIN</h2>
            <p className="fn-jp">Discord でログインして、FlameNode を使い始めましょう。</p>
          </div>
          <button className="fn-auth-discord" style={{ width:280 }} onClick={() => onNav("login")}>
            <i className="fa-brands fa-discord fn-auth-discord-icon"></i> Discord でサインイン
          </button>
        </section>

        {/* Footer nav */}
        <div className="fn-about-footnav fn-mono">
          <button className="fn-link" onClick={() => onNav("rules")}>利用規約</button>
          <span>·</span>
          <button className="fn-link" onClick={() => onNav("list")}>作品一覧</button>
          <span>·</span>
          <button className="fn-link" onClick={() => onNav("events")}>イベント</button>
        </div>
      </div>
    </main>
  );
}

// ─── Rules page ───────────────────────────────────────────────────
const RULES_TEXT = `# FlameNode 利用規約 (v8.1)

FlameNode は YouTube 埋め込みを利用した動画プラットフォームです。本サイトを利用される前に、以下の項目に同意の上、ご利用ください。

## 1. アカウント

* Discord 認証を介したアカウントを利用します。
* X (Twitter) アカウントは X ID として連携でき、作者・参加者の主体として表示されます。
* 一人の Discord アカウントに複数の X ID を連携することができます。

## 2. 投稿

* YouTube に公開された動画のみを取り扱います。動画ファイル本体は本サービスにアップロードされません。
* 著作権・肖像権など第三者の権利を侵害する動画の登録は禁止します。
* 合作・コラボ動画の場合は、全メンバーの同意を得た上で登録してください。

## 3. イベント

* 第三者主催のイベントは、運営の承認のもと開催できます。
* イベント運営は、参加者の作品情報を必要な範囲で閲覧・編集できます。
* 上映スロットは先着順での確保制を採用します。

## 4. 禁止事項

* 他者への迷惑行為、プラットフォームの安定運用を妨げる行為。
* 不正な情報の登録、なりすまし、悪意あるリンク投稿。
* X ID の不正申請・他者の X ID を騙った申請。

## 5. 免責

* 本サービスは無料で提供されます。可用性・継続性を保証するものではありません。
* 公開状態の管理は投稿者の責任で行ってください。

## 6. 変更

* 本規約は予告なく変更される場合があります。major 改訂があった場合は、次回投稿時に再同意を求めます。

更新日: 2026-05-01`;

function parseMarkdownLite(md) {
  return md.split(/\n/).map((line, i) => {
    if (line.startsWith("# ")) return { type: "h1", text: line.slice(2), key: i };
    if (line.startsWith("## ")) return { type: "h2", text: line.slice(3), key: i };
    if (line.startsWith("* ") || line.startsWith("- ")) return { type: "li", text: line.slice(2), key: i };
    if (line.trim() === "") return { type: "br", key: i };
    return { type: "p", text: line, key: i };
  });
}

function RulesPage({ onNav }) {
  const [agreed, setAgreed] = React.useState(false);
  const [showAccept, setShowAccept] = React.useState(false); // set true if terms_reaccept_required
  const tokens = parseMarkdownLite(RULES_TEXT);

  return (
    <main className="fn-main fn-rules" data-screen-label="Rules">
      <div className="fn-wrap">
        <header className="fn-rules-head">
          <span className="fn-eyebrow">documents</span>
          <h1 className="fn-display fn-rules-title">利用規約</h1>
          <div className="fn-rules-meta fn-mono">
            <span className="fn-pill" data-tone="ok">v8.1 公開中</span>
            <span style={{ color:"var(--text-faint)",fontSize:11 }}>更新日: 2026-05-01</span>
          </div>
        </header>

        <div className="fn-rules-body">
          {tokens.map(t => {
            if (t.type === "h1") return <h2 key={t.key} className="fn-display fn-rules-h1">{t.text}</h2>;
            if (t.type === "h2") return <h3 key={t.key} className="fn-rules-h2">{t.text}</h3>;
            if (t.type === "li") return <li key={t.key} className="fn-jp fn-rules-li">{t.text}</li>;
            if (t.type === "br") return <div key={t.key} className="fn-rules-br" />;
            return <p key={t.key} className="fn-jp fn-rules-p">{t.text}</p>;
          })}
        </div>

        {/* Accept CTA — shown after major update */}
        <div className="fn-rules-cta">
          <label className="fn-checkbox fn-jp">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <span>FlameNode 利用規約（v8.1）に同意します</span>
          </label>
          <button
            className="fn-btn" data-variant="accent" data-size="lg"
            disabled={!agreed}
            onClick={() => onNav("dashboard")}
          >
            同意してダッシュボードへ →
          </button>
          <button className="fn-btn" data-variant="ghost" data-size="sm" onClick={() => onNav("top")}>
            同意せずにトップへ
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── Public event slots page ──────────────────────────────────────
function EventSlotsPage({ onNav, selectedEvent, forceStatus }) {
  const event = window.FN_EVENTS.find(e => e.id === selectedEvent) || window.FN_EVENTS[0];
  const status = window.deriveStatus(event, forceStatus);
  const accepting = status.kind === "entry" || status.kind === "submit";
  const days = window.FN_SLOT_DAYS;
  const hours = window.FN_SLOT_HOURS;
  const matrix = window.FN_SLOT_MATRIX;

  // Flatten
  const allSlots = [];
  days.forEach((d, di) => hours.forEach((h, hi) => {
    const c = matrix[di][hi];
    allSlots.push({ day: d, hour: h, ...c, di, hi });
  }));
  const available = allSlots.filter(s => s.status === "available");
  const entryNotStarted = status.kind === "pre";
  const entryClosed = !accepting && status.kind !== "pre";

  return (
    <main className="fn-main" data-screen-label="EventSlots">
      <div className="fn-wrap">
        <button className="fn-cp-back fn-mono" style={{ marginTop:20,display:"block" }} onClick={() => onNav("event", { event: event.id })}>
          ← {event.title} 詳細
        </button>
        <header className="fn-manage-head" style={{ marginTop:12 }}>
          <div className="fn-manage-head-left">
            <span className="fn-eyebrow">{event.code} / slots</span>
            <h1 className="fn-display fn-manage-title" style={{ fontSize:"clamp(28px,4vw,48px)" }}>枠確保</h1>
            <p className="fn-jp fn-manage-subtitle">{event.summary}</p>
          </div>
          <div className="fn-manage-head-actions">
            <span className="fn-pill" data-tone={accepting?"accent":"muted"}>
              {window.statusLabel(status.kind, "ja")}
            </span>
            {accepting && available.length > 0 && (
              <button className="fn-btn" data-variant="accent" data-size="lg" onClick={() => onNav("reserve", { event: event.id })}>
                枠を確保する →
              </button>
            )}
          </div>
        </header>

        {/* Status messages */}
        {entryNotStarted && (
          <div className="fn-pc-status-banner fn-pc-status-banner--warn" style={{ marginTop:16 }}>
            <i className="fa-solid fa-clock"></i>
            <div>
              <h3 className="fn-jp">まだ募集が始まっていません</h3>
              <p className="fn-jp fn-pc-banner-lead">募集開始まで {window.daysUntilNext(status).count} 日。開始後にこのページから確保できます。</p>
            </div>
          </div>
        )}
        {entryClosed && (
          <div className="fn-pc-status-banner fn-pc-status-banner--warn" style={{ marginTop:16 }}>
            <i className="fa-solid fa-lock"></i>
            <div>
              <h3 className="fn-jp">受付は終了しました</h3>
              <p className="fn-jp fn-pc-banner-lead">このイベントの枠確保受付は終了しています。</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="fn-manage-stats" style={{ gridTemplateColumns:"repeat(4,1fr)", margin:"20px 0" }}>
          {[
            { k:"AVAILABLE", v: available.length },
            { k:"RESERVED",  v: allSlots.filter(s=>s.status==="reserved").length },
            { k:"SUBMITTED", v: allSlots.filter(s=>s.status==="submitted").length },
            { k:"RECLAIM",   v: allSlots.filter(s=>s.status==="reclaim").length },
          ].map((s,i) => (
            <div key={i} className="fn-manage-stat">
              <span className="fn-eyebrow">{s.k}</span>
              <span className="fn-display fn-manage-stat-v">{s.v}</span>
            </div>
          ))}
        </div>

        {/* Slot grid: use existing reserve page's slot table */}
        <div style={{ marginTop:8 }}>
          <div className="fn-slot-wrap">
            <table className="fn-slot">
              <thead>
                <tr>
                  <th className="fn-slot-corner"></th>
                  {days.map((d,i) => <th key={i} className="fn-slot-dayhead"><span className="fn-mono">{d}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {hours.map((h, hi) => (
                  <tr key={h}>
                    <th className="fn-slot-hourhead"><span className="fn-mono">{h}</span></th>
                    {days.map((_, di) => {
                      const cell = matrix[di][hi];
                      const isFree = cell.status === "available";
                      return (
                        <td
                          key={di}
                          className="fn-slot-cell"
                          data-status={cell.status}
                          onClick={() => accepting && isFree && onNav("reserve", { event: event.id })}
                          style={{ cursor: accepting && isFree ? "pointer" : "default" }}
                        >
                          <div className="fn-slot-cell-inner">
                            <span className="fn-slot-cell-name">
                              {cell.name ?? (isFree ? "空き枠" : cell.status === "reclaim" ? "再取得中" : "—")}
                            </span>
                            <span className="fn-slot-cell-status">{isFree ? "OPEN" : cell.status.toUpperCase()}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { AboutPage, RulesPage, EventSlotsPage });
