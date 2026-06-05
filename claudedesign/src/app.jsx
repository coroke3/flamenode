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
  const [sel, setSel] = _aUseState({ event: null, video: null, creator: null, adminUserId: null });

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
    top: TopPage, video: VideoDetail, videoEdit: VideoEditPage,
    event: EventDetail, events: EventsPage,
    creator: CreatorList, creatorProfile: CreatorProfile, card: CardShowcase,
    list: ListPage, reserve: ReservePage, recommend: RecommendPage,
    login: LoginPage,
    post: PostChooserPage,
    submit: SubmitPage,
    dashboard: Dashboard,
    admin: AdminPage,
    adminUserDetail: AdminUserDetailPage,
    library: DashboardLibraryPage,
    manageEvent: ManageEventPage,
    manageTop: ManageTopPage,
    manageSlots: ManageSlotsPage,
    manageAudience: ManageAudiencePage,
    manageStaff: ManageStaffPage,
    user: UserPage, entry: EntryPage, settings: SettingsPage,
  };
  const Page = PAGES[page] || TopPage;
  // Admin pages & manage pages hide site header/footer for full-width layout
  const isAuthPage = page === "login";
  const isAdminShell = ["admin", "manageTop"].includes(page);

  return (
    <div className="fn-app">
      {!isAuthPage && !isAdminShell && <Header page={page} onNav={onNav} lang={t.lang} density={t.density} />}
      {isAdminShell && <AdminHeader onNav={onNav} />}
      <Page onNav={onNav} lang={t.lang} forceStatus={t.eventStatus} selectedEvent={sel.event} selectedVideo={sel.video} selectedCreator={sel.creator} adminUserId={sel.adminUserId} />
      {!isAuthPage && !isAdminShell && <Footer lang={t.lang} />}

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
              <option value="recommend">Recommend / おすすめ</option>
              <option value="video">Video detail / 動画詳細</option>
              <option value="events">Events / イベント一覧</option>
              <option value="event">Event detail / イベント個別</option>
              <option value="reserve">Reserve / 枠確保</option>
              <option value="creator">Creator list / クリエイター一覧</option>
              <option value="creatorProfile">Creator profile / クリエイター個別</option>
              <option value="list">Video archive / 作品一覧</option>
              <option value="card">Card showcase / 募集カード見本</option>
            </optgroup>
            <optgroup label="Auth / Account">
              <option value="login">Login / サインイン</option>
              <option value="entry">Entry / イベント参加</option>
              <option value="dashboard">Dashboard / マイページ</option>
              <option value="library">Library / ライブラリ</option>
              <option value="post">Post chooser / 投稿方法選択</option>
              <option value="videoEdit">Video edit / 動画編集</option>
              <option value="user">User profile / プロフィール</option>
              <option value="submit">Submit / 投稿フロー</option>
              <option value="settings">Settings / アカウント設定</option>
            </optgroup>
            <optgroup label="Manage / Admin">
              <option value="manageTop">Manage top / イベント運営トップ</option>
              <option value="manageEvent">Manage event / イベント運営詳細</option>
              <option value="manageSlots">Manage slots / スロット運営</option>
              <option value="manageAudience">Manage audience / 登録者</option>
              <option value="manageStaff">Manage staff / スタッフ管理</option>
              <option value="admin">Admin console / 管理コンソール</option>
              <option value="adminUserDetail">Admin user detail / ユーザー詳細</option>
            </optgroup>
          </select>
        </TweakRow>
      </TweaksPanel>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
