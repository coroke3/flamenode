// Shared FlameNode components — Header, Footer, VideoCard, CreatorCard, Shelf, SectionHeader

const { useState, useRef, useEffect } = React;

// ─── Header ─────────────────────────────────────────────────────
function Header({ page, onNav, lang, density }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ACCOUNTS = [
    { handle: "halo_loop_v", name: "halo / loop", avatar: "h" },
    { handle: "frame_index__", name: "frame index", avatar: "f" },
    { handle: "rin_otsuka_", name: "凜・大塚", avatar: "凜" },
  ];
  const [activeAcct, setActiveAcct] = useState(0);
  const acct = ACCOUNTS[activeAcct];
  const NAV = [
    { id: "top",     ja: "ホーム" },
    { id: "list",    ja: "作品" },
    { id: "events",  ja: "イベント" },
    { id: "creator", ja: "クリエイター" },
  ];
  return (
    <header className="fn-header" data-screen-label="Header">
      <div className="fn-header-inner fn-wrap">
        <button className="fn-logo" onClick={() => onNav("top")} aria-label="FlameNode home">
          <span className="fn-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 693 840" height="24" fill="currentColor">
              <path d="M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z"></path>
            </svg>
          </span>
          <span className="fn-logo-name fn-display">FlameNode</span>
        </button>

        <nav className="fn-nav" aria-label="primary">
          {NAV.map(n => (
            <button
              key={n.id}
              className={"fn-nav-item " + (page === n.id ? "is-active" : "")}
              onClick={() => onNav(n.id)}
            >
              <span className="fn-nav-ja">{n.ja}</span>
            </button>
          ))}
        </nav>

        <div className="fn-header-right">
          <button className="fn-icon-btn" aria-label="検索">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5"/><path d="M9.5 9.5 L12.5 12.5"/></svg>
          </button>
          <button className="fn-btn fn-header-submit" data-size="sm" data-variant="accent" onClick={() => onNav("submit")}>投稿する</button>
          <div className="fn-xid-wrap">
            <button className={"fn-xid " + (menuOpen ? "is-open" : "")} aria-label="アカウント" onClick={() => setMenuOpen(o => !o)}>
              <span className="fn-xid-avatar" aria-hidden="true">{acct.avatar}</span>
              <span className="fn-xid-name">{acct.name}</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M1.5 3 L4 5.5 L6.5 3"/></svg>
            </button>
            {menuOpen && (
              <div className="fn-xid-menu">
                <div className="fn-xid-switch">
                  <span className="fn-xid-switch-label fn-mono">連携Xアカウント</span>
                  {ACCOUNTS.map((a, i) => (
                    <button
                      key={a.handle}
                      className={"fn-xid-acct " + (i === activeAcct ? "is-active" : "")}
                      onClick={() => { setActiveAcct(i); }}
                    >
                      <span className="fn-xid-acct-avatar">{a.avatar}</span>
                      <span className="fn-xid-acct-id">
                        <span className="fn-xid-acct-name">{a.name}</span>
                        <span className="fn-xid-acct-handle fn-mono"><i className="fa-brands fa-x-twitter"></i>@{a.handle}</span>
                      </span>
                      {i === activeAcct
                        ? <i className="fa-solid fa-check fn-xid-acct-check"></i>
                        : <span className="fn-xid-acct-switch fn-mono">切替</span>}
                    </button>
                  ))}
                  <button className="fn-xid-acct fn-xid-acct-add" onClick={() => { onNav("login"); setMenuOpen(false); }}>
                    <span className="fn-xid-acct-avatar fn-xid-acct-avatar--add"><i className="fa-solid fa-plus"></i></span>
                    <span className="fn-xid-acct-id"><span className="fn-xid-acct-name">別のXアカウントを連携</span></span>
                  </button>
                </div>
                <div className="fn-xid-menu-divider" />
                <button onClick={() => { onNav("user"); setMenuOpen(false); }}>プロフィール</button>
                <button onClick={() => { onNav("dashboard"); setMenuOpen(false); }}>マイページ</button>
                <button onClick={() => { onNav("submit"); setMenuOpen(false); }}>新規投稿</button>
                <button onClick={() => { onNav("settings"); setMenuOpen(false); }}>アカウント設定</button>
                <button onClick={() => { onNav("admin"); setMenuOpen(false); }}>運営コンソール</button>
                <div className="fn-xid-menu-divider" />
                <button onClick={() => { onNav("login"); setMenuOpen(false); }}>サインアウト</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Footer ─────────────────────────────────────────────────────
function Footer({ lang }) {
  return (
    <footer className="fn-footer">
      <div className="fn-wrap">
        <div className="fn-footer-top">
          <div className="fn-footer-brand">
            <span className="fn-footer-logo-row">
              <span className="fn-logo-mark" aria-hidden="true">
                <svg viewBox="0 0 693 840" height="28" fill="currentColor">
                  <path d="M404 0L398 0L8 181L0 192L0 727L5 734L12 735L142 675L142 518L150 509L403 385L407 379L407 292L403 286L399 286L200 385L146 408L142 403L144 290L154 283L572 98L572 296L418 371L416 375L421 384L572 522L572 678L314 459L306 458L302 464L302 834L306 839L313 839L676 665L687 659L692 650L691 249L687 245L679 245L586 290L583 289L584 95L577 85L566 86L411 155L410 6Z"></path>
                </svg>
              </span>
              <span className="fn-display fn-footer-name">FlameNode</span>
            </span>
            <span className="fn-footer-tag fn-jp">映像（フレーム）の結節点（ノード）</span>
          </div>
          <div className="fn-footer-cols">
            <div>
              <span className="fn-eyebrow">explore</span>
              <ul>
                <li>新着</li>
                <li>ピックアップ</li>
                <li>クリエイター</li>
                <li>イベント</li>
              </ul>
            </div>
            <div>
              <span className="fn-eyebrow">event</span>
              <ul>
                <li>PVSF2025S</li>
                <li>NCNC 2025</li>
                <li>Archive</li>
                <li>第三者開催相談</li>
              </ul>
            </div>
            <div>
              <span className="fn-eyebrow">guide</span>
              <ul>
                <li>利用規約</li>
                <li>X ID 連携について</li>
                <li>投稿ガイド</li>
                <li>問い合わせ</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="fn-footer-bottom fn-mono">
          <span>© 2025 FlameNode</span>
          <span className="fn-footer-meta">build node.0426 · cf.pages + d1 · kv.guard = normal</span>
          <span>jp / en</span>
        </div>
      </div>
    </footer>
  );
}

// ─── Section Header ─────────────────────────────────────────────
function SectionHeader({ kicker, title, jp, moreLabel, onMore }) {
  return (
    <div className="fn-section-head">
      <div className="fn-section-head-left">
        <div className="fn-section-titles">
          <h2 className="fn-display fn-section-title">{title}</h2>
          {jp && <span className="fn-section-jp fn-jp">{jp}</span>}
        </div>
      </div>
      {moreLabel && (
        <button className="fn-section-more" onClick={onMore}>
          <span>{moreLabel}</span>
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}

// ─── Thumbnail (placeholder) ─────────────────────────────────────
function Thumb({ video, ratio = "16/9" }) {
  // Deterministic color from video id
  let h = 0; for (let i = 0; i < video.id.length; i++) h = (h * 31 + video.id.charCodeAt(i)) % 360;
  const h2 = (h + 50) % 360;
  return (
    <div className="fn-thumb" style={{ aspectRatio: ratio }}>
      <div className="fn-thumb-bg" style={{
        background: `linear-gradient(135deg, hsl(${h} 40% 18%), hsl(${h2} 35% 10%))`
      }} />
      <div className="fn-thumb-grid" aria-hidden="true" />
      <div className="fn-thumb-code fn-mono">{video.code}</div>
      <div className="fn-thumb-duration fn-mono">{video.duration}</div>
      <div className="fn-thumb-play" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2 L12 7 L3 12 Z" fill="currentColor"/></svg>
      </div>
    </div>
  );
}

// ─── Video card ─────────────────────────────────────────────────
function VideoCard({ video, onOpen, size = "md" }) {
  const creators = window.FN_CREATORS;
  const creator = creators.find(c => c.id === video.creator);
  return (
    <article className="fn-vcard" data-size={size}>
      <button className="fn-vcard-thumb-btn" onClick={onOpen}>
        <Thumb video={video} />
      </button>
      <div className="fn-vcard-body">
        <h3 className="fn-vcard-title" onClick={onOpen}>{video.title}</h3>
        <div className="fn-vcard-meta">
          <span className="fn-vcard-creator">
            <span className="fn-vcard-avatar" aria-hidden="true">{creator.name.charAt(0)}</span>
            <span>{creator.name}</span>
          </span>
          <span className="fn-vcard-score fn-mono">{video.score.toLocaleString()}</span>
        </div>
      </div>
    </article>
  );
}

// ─── Creator card ───────────────────────────────────────────────
function CreatorCard({ creator, onOpen }) {
  const initial = creator.name.charAt(0);
  return (
    <article className="fn-ccard" onClick={onOpen}>
      <div className="fn-ccard-avatar">
        <span className="fn-ccard-initial">{initial}</span>
      </div>
      <div className="fn-ccard-body">
        <h4 className="fn-ccard-name">{creator.name}</h4>
        <span className="fn-ccard-handle fn-mono">@{creator.handle}</span>
        <span className="fn-ccard-count fn-mono">{creator.videos} works</span>
      </div>
    </article>
  );
}

// ─── Shelf (horizontal scroller) ─────────────────────────────────
function Shelf({ children, ariaLabel }) {
  const ref = useRef(null);
  const scroll = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <div className="fn-shelf">
      <div className="fn-shelf-strip" ref={ref} aria-label={ariaLabel}>
        {children}
      </div>
      <button className="fn-shelf-nav fn-shelf-nav-prev" aria-label="prev" onClick={() => scroll(-1)}>‹</button>
      <button className="fn-shelf-nav fn-shelf-nav-next" aria-label="next" onClick={() => scroll(1)}>›</button>
    </div>
  );
}

Object.assign(window, { Header, Footer, SectionHeader, Thumb, VideoCard, CreatorCard, Shelf });
