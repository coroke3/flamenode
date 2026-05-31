// FlameNode main app — router + tweaks panel

const { useState: _aUseState, useEffect: _aUseEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variation": "press",       // press | frame | node
  "theme": "dark",            // dark | light
  "density": "normal",        // tight | normal | spacious
  "accent": "lime",           // lime | amber | rose | sky
  "lang": "ja",               // ja | en | bilingual
  "eventStatus": "auto"       // auto | pre | entry | submit | ended
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [page, setPage] = _aUseState("top");
  const [sel, setSel] = _aUseState({ event: null, video: null });

  _aUseEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("fn-light", t.theme === "light");
    root.classList.remove("fn-press", "fn-frame", "fn-node");
    root.classList.add("fn-" + t.variation);
    root.classList.remove("fn-d-tight", "fn-d-normal", "fn-d-spacious");
    root.classList.add("fn-d-" + t.density);
    root.classList.remove("fn-accent-lime", "fn-accent-amber", "fn-accent-rose", "fn-accent-sky");
    root.classList.add("fn-accent-" + t.accent);
  }, [t.theme, t.variation, t.density, t.accent]);

  const onNav = (id, ctx) => {
    if (ctx) setSel(s => ({ ...s, ...ctx }));
    setPage(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const PAGES = {
    top: TopPage, video: VideoDetail, event: EventDetail, events: EventsPage,
    creator: CreatorList, card: CardShowcase, list: ListPage, reserve: ReservePage,
    login: LoginPage, submit: SubmitPage, dashboard: Dashboard, admin: AdminPage,
    user: UserPage, entry: EntryPage, settings: SettingsPage,
  };
  const Page = PAGES[page] || TopPage;
  const isAuthPage = page === "login";

  return (
    <div className="fn-app">
      {!isAuthPage && <Header page={page} onNav={onNav} lang={t.lang} density={t.density} />}
      <Page onNav={onNav} lang={t.lang} forceStatus={t.eventStatus} selectedEvent={sel.event} selectedVideo={sel.video} />
      {!isAuthPage && <Footer lang={t.lang} />}

      <TweaksPanel>
        <TweakSection label="Direction" />
        <TweakRadio
          label="Variation"
          value={t.variation}
          options={["press", "frame", "node"]}
          onChange={(v) => setTweak("variation", v)}
        />
        <TweakRadio
          label="Theme"
          value={t.theme}
          options={["dark", "light"]}
          onChange={(v) => setTweak("theme", v)}
        />
        <TweakRadio
          label="Density"
          value={t.density}
          options={["tight", "normal", "spacious"]}
          onChange={(v) => setTweak("density", v)}
        />
        <TweakRadio
          label="Accent"
          value={t.accent}
          options={["lime", "amber", "rose", "sky"]}
          onChange={(v) => setTweak("accent", v)}
        />

        <TweakSection label="Content" />
        <TweakRadio
          label="Language"
          value={t.lang}
          options={["ja", "en", "bilingual"]}
          onChange={(v) => setTweak("lang", v)}
        />
        <TweakSelect
          label="Event status (force)"
          value={t.eventStatus}
          options={[
            { value: "auto",   label: "Auto (date-based)" },
            { value: "pre",    label: "Pre-open / 募集前" },
            { value: "entry",  label: "Entry open / 募集中" },
            { value: "submit", label: "Submission / 投稿期間中" },
            { value: "ended",  label: "Ended / 終了" },
          ]}
          onChange={(v) => setTweak("eventStatus", v)}
        />

        <TweakSection label="Navigate" />
        <TweakRow label="Page">
          <select
            value={page}
            onChange={(e) => onNav(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
          >
            <optgroup label="Public">
              <option value="top">Top / トップ</option>
              <option value="video">Video detail / 動画詳細</option>
              <option value="events">Events / イベント一覧</option>
              <option value="event">Event detail / イベント個別</option>
              <option value="reserve">Reserve / 枠確保</option>
              <option value="creator">Creator list / クリエイター一覧</option>
              <option value="list">Video archive / 作品一覧</option>
              <option value="card">Card showcase / 募集カード見本</option>
            </optgroup>
            <optgroup label="Auth / Account">
              <option value="login">Login / サインイン</option>
              <option value="entry">Entry / イベント参加</option>
              <option value="dashboard">Dashboard / マイページ</option>
              <option value="user">User profile / プロフィール</option>
              <option value="submit">Submit / 投稿フロー</option>
              <option value="settings">Settings / アカウント設定</option>
              <option value="admin">Admin / 運営コンソール</option>
            </optgroup>
          </select>
        </TweakRow>
      </TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
