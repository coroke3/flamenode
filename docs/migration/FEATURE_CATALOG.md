# FlameNode 既存機能カタログ

> 状態: Active / `/flamenode-migration` 用の人間向け全機能索引
> 最終更新: 2026-10-07
> フロントエンド詳細正本: `FRONTEND_FEATURES.md` + `frontend/*.md`
> バックエンド詳細正本: `FUNCTION_INVENTORY.md` + `functions/*.md`
> 進捗正本: `STATUS.md`

この文書は、FlameNodeの移行・再設計で**既存機能を見落として落とさないために、フロントエンドから観測できる機能と、それを支えるバックエンド機能を一か所で一覧できるようにした索引**。

詳細台帳が正本であり、この文書はその内容を読みやすく集約した派生ビュー。
機能を追加・統合・廃止する場合は、先に詳細台帳を更新し、このカタログとmigration checkerを同時に更新する。

## 基準件数

- フロントエンド `UX-*`: **432件**
- バックエンド/domain/platform `FN-*`: **136件**
- `app/**/page.tsx`: **92 route実装**
  - VISUAL_SCREEN: 74
  - COMPAT_REDIRECT: 9
  - DEV_ONLY: 3
  - SYSTEM_SURFACE: 6
- Server Action execution units: 110
- Route Handler HTTP methods: 33
- CURRENT Worker scripts: 4

## 移行時の最優先原則

1. フロントエンドの使い心地・機能・操作結果を落とさない。
2. 権限、privacy、visibility、audit、通知、Queue、外部連携、副作用を維持する。
3. URL/query/deep-link/reload/back-forward/sessionの意味を維持する。
4. バックエンドはCURRENTコードを機械移植せず、責務・境界・共通化を再評価する。
5. 共通化は意味、permission、transaction、failure、audit、visibility、frontend resultが一致する場合だけ行う。
6. コード行数削減を目標にしない。結果として短くなる場合も、読みやすさと意味の明確さを優先する。
7. professional production engineerが読んで違和感のない責務、命名、依存方向、error handling、testabilityを要求する。

## IdentityのTARGET原則

- Auth User = login/session/account/security principal
- Active X = FlameNode上のacting/content/interaction identity
- **like / bookmark / save はActive X所有**
- Active X切替時はlike/bookmark active state、libraryのlike/bookmark一覧、関連playlist文脈を再取得する
- X-scoped permissionはActive Xを第一候補とし、そのXが当該Auth Userのapproved linkであることをserver-sideで検証する
- inactive Xの権限をActive Xへ暗黙に貸さない
- account/security provenance（ban、role、session、Discord、承認者等）はAuth Userのまま

CURRENTではlike/bookmarkがAuth User所有の経路があるため、これは`CURRENT_DIVERGENCE`。移行ではexpand/reconcile/cutoverでActive X canonicalへ移す。

# フロントエンドから見える既存機能 — 全432件

## 横断・シェル・システム

出典: `docs/migration/frontend/CROSS_CUTTING.md`

| UX ID | ユーザーから見える機能 | 画面・Surface | 関連FN | CURRENT/TARGET上の状態 |
| --- | --- | --- | --- | --- |
| UX-GLOBAL-001 | desktopのmain navigationから主要public routeへ移動 | public header | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-002 | mobile menuを開閉してnavigationを使う | public header | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-003 | 現在routeに対応するnavigation active stateを見る | public header | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-004 | header search panelを開閉する | public header | FN-PUB-026 | CURRENT_VERIFIED |
| UX-GLOBAL-005 | headerから作品検索を送信する | public header → `/list?q=` | FN-PUB-026 | CURRENT_VERIFIED |
| UX-GLOBAL-006 | IME変換中のEnterで誤submitせず検索する | public search forms | FN-PUB-026 | CURRENT_VERIFIED |
| UX-GLOBAL-007 | light/dark themeを切り替える | global/header | FN-PUB-027 | CURRENT_VERIFIED |
| UX-GLOBAL-008 | theme選択をreload後も維持する | global | FN-PUB-027 | CURRENT_VERIFIED |
| UX-GLOBAL-009 | system preferenceを初期themeへ反映する | global | FN-PUB-027 | CURRENT_VERIFIED |
| UX-GLOBAL-010 | ログインpresenceをheaderで認識する | public header | FN-AUTH-009 | CURRENT_VERIFIED |
| UX-GLOBAL-011 | account menuを開き詳細を遅延取得する | public header | FN-AUTH-009 | CURRENT_VERIFIED |
| UX-GLOBAL-012 | account詳細取得中/失敗/再試行状態を見る | public header | FN-AUTH-009 | CURRENT_VERIFIED |
| UX-GLOBAL-013 | account詳細未確認時にadmin/manage linkをfail-closedで隠す | public header | FN-AUTH-009,FN-X-002 | CURRENT_VERIFIED |
| UX-GLOBAL-014 | 未ログイン時に現在routeへ戻れるlogin導線を使う | public header/account | FN-AUTH-001 | CURRENT_VERIFIED |
| UX-GLOBAL-015 | account menu/mobile/search panelがroute change/外側操作等でdismissされる | public header | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-016 | menu/dialogをkeyboard/focusで操作する | public header | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-017 | public footerから補助導線を使う | public layout | FN-PUB-025 | CURRENT_VERIFIED |
| UX-GLOBAL-018 | authenticated routeへdirect URL/reloadで到達してもauth状態を正しく解決する | auth/private layout | FN-AUTH-002 | CURRENT_VERIFIED |
| UX-GLOBAL-019 | query/deep-link/browser back-forwardで検索/タブ/page状態を再現する | public/private routes | FN-X-011 | CURRENT_VERIFIED |
| UX-GLOBAL-020 | mobile/tablet/desktopで主要操作へ到達できる | all frontend | cross-cutting | CURRENT_VERIFIED |
| UX-GLOBAL-021 | keyboardのみで主要interactive controlを操作できる | all frontend | cross-cutting | CURRENT_VERIFIED |
| UX-GLOBAL-022 | focus/aria/disabled/loading stateが操作意味と一致する | all frontend | cross-cutting | CURRENT_VERIFIED |
| UX-GLOBAL-023 | recoverable route errorでblank screenにならず再行動できる | `error.tsx` / route-group errors | cross-cutting | CURRENT_VERIFIED |
| UX-GLOBAL-024 | catastrophic root errorでもfallback UIを表示する | `global-error.tsx` | cross-cutting | CURRENT_VERIFIED |
| UX-GLOBAL-025 | unknown/non-public entityで安全な404を表示する | `not-found.tsx` | FN-PLAT-004,FN-X-010 | CURRENT_VERIFIED |
| UX-GLOBAL-026 | degraded public data時にprivate dataへfallbackせず利用不能状態を案内する | public routes | FN-PLAT-007,FN-X-010 | CURRENT_VERIFIED |
| UX-GLOBAL-027 | public projection反映待ちを必要箇所で明示する | public mutation feedback | FN-PLAT-003 | CURRENT_VERIFIED |
| UX-GLOBAL-028 | cost/operation mode警告を対象画面で確認する | admin/manage/public operational shell | FN-ADM-007,FN-PLAT-011 | CURRENT_VERIFIED |
| UX-GLOBAL-029 | admin consoleとmanage consoleのmode差を明示表示する | console sidebar | FN-MNG-002,FN-ADM-001 | CURRENT_VERIFIED |
| UX-GLOBAL-030 | admin console sidebarから管理領域へ移動する | admin shell | FN-ADM-001 | CURRENT_VERIFIED |
| UX-GLOBAL-031 | manage sidebarに自分が担当するeventだけが出る | manage shell | FN-MNG-001,FN-X-002 | CURRENT_VERIFIED |
| UX-GLOBAL-032 | manageでX link request権限がある時だけ導線が出る | manage shell | FN-MNG-012,FN-X-002 | CURRENT_VERIFIED |
| UX-GLOBAL-033 | Active Xとmanage staff identityが不一致の時に警告を見る | manage shell | FN-MNG-001,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-SYS-001 | maintenance/cost modeの状態と次行動を見る | `/maintenance` | FN-PLAT-011 | CURRENT_VERIFIED |
| UX-SYS-002 | admin例外等のmaintenance access policyが適用される | `/maintenance` | FN-PLAT-011,FN-X-002 | CURRENT_VERIFIED |
| UX-SYS-003 | CURRENT UI surface catalogを開発検証に使う | `/dev/ui-surfaces` | FN-PLAT-012 | CURRENT_VERIFIED |
| UX-SYS-004 | crawlerに公開対象だけをindexさせる | robots/canonical | FN-PUB-022,FN-X-011 | CURRENT_VERIFIED |
| UX-SYS-005 | sitemapで公開URL discoveryを維持する | sitemap | FN-PUB-022 | CURRENT_VERIFIED |

## 公開・作品・検索・ユーザー・イベント

出典: `docs/migration/frontend/PUBLIC.md`

| UX ID | ユーザーから見える機能 | 画面・Surface | 関連FN | CURRENT/TARGET上の状態 |
| --- | --- | --- | --- | --- |
| UX-PUB-001 | トップで新着作品を見つける | `/` | FN-PUB-001 | CURRENT_VERIFIED |
| UX-PUB-002 | トップで注目/featured作品を見つける | `/` | FN-PUB-001,FN-PUB-016 | CURRENT_VERIFIED |
| UX-PUB-003 | トップから開催/募集中eventへ進む | `/` | FN-PUB-001,FN-PUB-009 | CURRENT_VERIFIED |
| UX-PUB-004 | トップで公開お知らせを見る | `/` | FN-PUB-023 | CURRENT_VERIFIED |
| UX-PUB-005 | トップで公開統計を確認する | `/` | FN-PUB-024 | CURRENT_VERIFIED |
| UX-PUB-006 | トップでevent/slot概要を確認する | `/` | FN-PUB-024,FN-PUB-012 | CURRENT_VERIFIED |
| UX-PUB-007 | homeのempty/degraded状態から次行動を判断する | `/` | FN-PLAT-007 | CURRENT_VERIFIED |
| UX-PUB-008 | Aboutでサービス概要を読む | `/about` | FN-PUB-020 | CURRENT_VERIFIED |
| UX-PUB-009 | Aboutから作品/参加等の主要導線へ進む | `/about` | FN-PUB-020 | CURRENT_VERIFIED |
| UX-PUB-010 | 現行rules/termsを読む | `/rules` | FN-PUB-021 | CURRENT_VERIFIED |
| UX-PUB-011 | rules内で必要項目を確認し同意導線へ進む | `/rules` | FN-PUB-021,FN-AUTH-006 | CURRENT_VERIFIED |
| UX-PUB-012 | public pageのcanonical/OGP/SEOが外部共有・検索で正しく見える | public | FN-PUB-022 | CURRENT_VERIFIED |
| UX-VID-001 | internal video IDのURLで作品を開く | `/[id]` | FN-PUB-002 | CURRENT_VERIFIED |
| UX-VID-002 | YouTube video ID aliasのURLで同じ作品を開く | `/[id]` | FN-PUB-002,FN-API-003 | CURRENT_VERIFIED |
| UX-VID-003 | public/non-public visibilityに応じて作品が安全に表示/非表示になる | `/[id]` | FN-PLAT-004,FN-X-010 | CURRENT_VERIFIED |
| UX-VID-004 | YouTube playerで作品を再生する | `/[id]` | FN-PUB-003 | CURRENT_VERIFIED |
| UX-VID-005 | YouTube未登録でも公開作品情報を閲覧できるfallbackを見る | `/[id]` | FN-PUB-003 | CURRENT_VERIFIED |
| UX-VID-006 | viewが閲覧UXを阻害せず計測される | `/[id]` | FN-PUB-006 | CURRENT_VERIFIED |
| UX-VID-007 | 作品titleを確認する | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-008 | creator identity/icon/X IDを確認する | `/[id]` | FN-PUB-004,FN-PUB-018 | CURRENT_VERIFIED |
| UX-VID-009 | creatorのFlameNode profileへ移動する | `/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-VID-010 | creatorのX profileを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-011 | creatorのYouTube channelを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-012 | 作品のmusic/creditを確認する | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-013 | music reference URLを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-014 | intro commentを見る | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-015 | 使用software情報を見る | `/[id]` | FN-PUB-004,FN-API-007 | CURRENT_VERIFIED |
| UX-VID-016 | highlightsを見る | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-017 | production storyを見る | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-018 | closing commentを見る | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-019 | primary eventとstatusを確認しeventへ移動する | `/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-VID-020 | event受付中状態を見る | `/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-VID-021 | event YouTube playlistを条件に応じて外部で開く | `/[id]` | FN-JOB-005,FN-MNG-010 | CURRENT_VERIFIED |
| UX-VID-022 | 複数所属eventをtagから開く | `/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-VID-023 | public member一覧・role/commentを見る | `/[id]` | FN-PUB-004 | CURRENT_VERIFIED |
| UX-VID-024 | memberに紐づくchapter担当情報を見る | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-025 | likeを付ける/外す | `/[id]` | FN-PUB-007 | CURRENT_DIVERGENCE |
| UX-VID-026 | bookmark/saveを付ける/外す | `/[id]` | FN-PUB-007 | CURRENT_DIVERGENCE |
| UX-VID-027 | interaction中のpending/active状態を見る | `/[id]` | FN-PUB-007 | CURRENT_DIVERGENCE |
| UX-VID-028 | 未ログイン時にlike/saveからloginへ進む | `/[id]` | FN-PUB-007,FN-AUTH-001 | CURRENT_VERIFIED |
| UX-VID-029 | terms未同意時にinteractionが抑止されrulesへ進む | `/[id]` | FN-PUB-007,FN-AUTH-006 | CURRENT_VERIFIED |
| UX-VID-030 | banned/auth unavailable時にinteraction不能理由を見る | `/[id]` | FN-PUB-007,FN-AUTH-004 | CURRENT_VERIFIED |
| UX-VID-031 | public chapter/comment一覧を見る | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-032 | chapterをクリック/keyboard操作してplayerを該当時刻へseekする | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-033 | playback位置に対応するchapterがactive表示される | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-034 | private chapterを権限あるviewerだけがbadge付きで見る | `/[id]` | FN-PUB-005,FN-PUB-008 | CURRENT_VERIFIED |
| UX-VID-035 | 動画尺外chapterを範囲外表示しseekしない | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-036 | chapter/comment投稿sheetを現在再生位置から開く | `/[id]` | FN-PUB-005,FN-PUB-008 | CURRENT_VERIFIED |
| UX-VID-037 | chapter timeを手入力する | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-038 | 「現在位置」でplayer timeをchapter timeへ反映する | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-039 | chapter label/titleを入力する | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-040 | chapter noteを入力する | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-041 | chapterをpublic/privateで投稿する | `/[id]` | FN-PUB-005,FN-X-004 | CURRENT_VERIFIED |
| UX-VID-042 | chapter投稿にloginが必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-001 | CURRENT_VERIFIED |
| UX-VID-043 | chapter投稿にterms同意が必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-006 | CURRENT_VERIFIED |
| UX-VID-044 | chapter投稿にapproved Active Xが必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-VID-045 | chapter投稿validation errorを見る | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-046 | private chapter投稿直後にviewer overlayへ即時反映する | `/[id]` | FN-PUB-008,FN-API-003 | CURRENT_VERIFIED |
| UX-VID-047 | public chapter投稿後にstatic/public反映待ちnoticeを見る | `/[id]` | FN-PLAT-003,FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-048 | 新規chapter投稿後に追加itemへscrollして結果を確認する | `/[id]` | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-049 | Active X切替時に入力中chapterがあれば破棄確認を受ける | chapter composer/account | FN-AUTH-010,FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-050 | owner/admin等がchapter CSV一括登録UIを利用する | edit/chapter composer | FN-PUB-005,FN-PER-002 | CURRENT_VERIFIED |
| UX-VID-051 | chapter CSVの上限/行error/成功件数を確認する | edit/chapter composer | FN-PUB-005 | CURRENT_VERIFIED |
| UX-VID-052 | viewer utility dockでplaylist/chapter等の補助機能を使う | `/[id]` | FN-PUB-008 | CURRENT_VERIFIED |
| UX-VID-053 | related videosを見る | `/[id]` | FN-PUB-002,FN-PLAT-008 | CURRENT_VERIFIED |
| UX-VID-054 | related data利用不能時にdegraded messageを見る | `/[id]` | FN-PLAT-007 | CURRENT_VERIFIED |
| UX-VID-055 | VideoObject JSON-LD/metadataが外部crawler/shareへ正しく公開される | `/[id]` | FN-PUB-022 | CURRENT_VERIFIED |
| UX-DISC-001 | 全作品listを閲覧する | `/list` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-002 | free-textで作品検索する | `/list?q=` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-003 | event等のfilterで作品を絞る | `/list` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-004 | sortを切り替える | `/list` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-005 | pageを移動する | `/list` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-006 | query URLを共有/reloadして同じ検索状態を復元する | `/list` | FN-PUB-014,FN-X-011 | CURRENT_VERIFIED |
| UX-DISC-007 | browser back/forwardで検索状態を復元する | `/list` | FN-PUB-014,FN-X-011 | CURRENT_VERIFIED |
| UX-DISC-008 | listのempty stateを見る | `/list` | FN-PUB-014 | CURRENT_VERIFIED |
| UX-DISC-009 | listのpublic data degraded/error stateを見る | `/list` | FN-PLAT-007 | CURRENT_VERIFIED |
| UX-DISC-010 | recommended作品を閲覧する | `/recommend` | FN-PUB-015 | CURRENT_VERIFIED |
| UX-DISC-011 | recommendation rail/sectionから作品を開く | `/recommend` | FN-PUB-015 | CURRENT_VERIFIED |
| UX-DISC-012 | recommendationのempty/degraded状態を見る | `/recommend` | FN-PUB-015,FN-PLAT-007 | CURRENT_VERIFIED |
| UX-DISC-013 | trending順位/作品を閲覧する | `/trending` | FN-PUB-016,FN-PLAT-009 | CURRENT_VERIFIED |
| UX-DISC-014 | trendingから作品を開く | `/trending` | FN-PUB-016 | CURRENT_VERIFIED |
| UX-DISC-015 | trendingの集計更新/empty/degraded状態を見る | `/trending` | FN-PUB-016,FN-PLAT-009 | CURRENT_VERIFIED |
| UX-DISC-016 | public list/recommend/trendingでprivate/voided作品が露出しない | discovery routes | FN-X-003,FN-X-004,FN-X-010 | CURRENT_VERIFIED |
| UX-USER-001 | creator一覧を見る | `/user` | FN-PUB-017 | CURRENT_VERIFIED |
| UX-USER-002 | creatorをfree-text検索する | `/user` | FN-PUB-017 | CURRENT_VERIFIED |
| UX-USER-003 | creator listをsortする | `/user` | FN-PUB-017 | CURRENT_VERIFIED |
| UX-USER-004 | creator listをpaginateする | `/user` | FN-PUB-017 | CURRENT_VERIFIED |
| UX-USER-005 | creator検索URLを共有/reload/back-forwardで復元する | `/user` | FN-PUB-017,FN-X-011 | CURRENT_VERIFIED |
| UX-USER-006 | creator identity/icon/display nameを見る | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-007 | creatorのX profileを外部で開く | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-008 | creatorのYouTube channelを外部で開く | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-009 | creator profile blocks/about contentを見る | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-010 | creatorのworks tabを見る | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-011 | creatorのcollab tabを見る | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-012 | works/collabを独立paginateする | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-013 | profile tab/page queryをdeep-link/reload/back-forwardで維持する | `/user/[id]` | FN-PUB-018,FN-X-011 | CURRENT_VERIFIED |
| UX-USER-014 | profileのempty statesを見る | `/user/[id]` | FN-PUB-018 | CURRENT_VERIFIED |
| UX-USER-015 | portfolio viewでcreator作品を作品中心に連続閲覧する | `/user/[id]/portfolio` | FN-PUB-019 | CURRENT_VERIFIED |
| UX-USER-016 | public-listable/profile visibility ruleに従いcreator情報が露出する | `/user*` | FN-PUB-017,FN-PUB-018,FN-X-004 | CURRENT_VERIFIED |
| UX-EVENT-001 | 公開event一覧を見る | `/event` | FN-PUB-009 | CURRENT_VERIFIED |
| UX-EVENT-002 | eventをfree-text検索する | `/event` | FN-PUB-009 | CURRENT_VERIFIED |
| UX-EVENT-003 | event statusでfilterする | `/event` | FN-PUB-009 | CURRENT_VERIFIED |
| UX-EVENT-004 | event listをsortする | `/event` | FN-PUB-009 | CURRENT_VERIFIED |
| UX-EVENT-005 | event queryをdeep-link/reload/back-forwardで維持する | `/event` | FN-PUB-009,FN-X-011 | CURRENT_VERIFIED |
| UX-EVENT-006 | event title/icon/description等の概要を見る | `/event/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-EVENT-007 | event stage/statusを見る | `/event/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-EVENT-008 | event募集受付中/終了等の状態を見る | `/event/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-EVENT-009 | event所属public作品一覧を見る | `/event/[id]` | FN-PUB-010 | CURRENT_VERIFIED |
| UX-EVENT-010 | event entry可能時に参加/投稿導線へ進む | `/event/[id]` | FN-PUB-010,FN-ENT-001 | CURRENT_VERIFIED |
| UX-EVENT-011 | event external/playlist等の関連linkを開く | `/event/[id]` | FN-PUB-010,FN-JOB-005 | CURRENT_VERIFIED |
| UX-EVENT-012 | eventが非公開/blocked時にpublic dataが露出しない | `/event/[id]` | FN-PLAT-004,FN-X-010 | CURRENT_VERIFIED |
| UX-EVENT-013 | event slots pageを開く | `/event/[id]/slots` | FN-PUB-012 | CURRENT_VERIFIED |
| UX-EVENT-014 | slotの空き/使用/公開可能状態を見る | `/event/[id]/slots` | FN-PUB-012 | CURRENT_VERIFIED |
| UX-EVENT-015 | slot情報をmobileでも探索できる | `/event/[id]/slots` | FN-PUB-012 | CURRENT_VERIFIED |
| UX-EVENT-016 | slot public viewでprivate participant情報が漏れない | `/event/[id]/slots` | FN-PUB-012,FN-X-004 | CURRENT_VERIFIED |
| UX-EVENT-017 | event release viewを開く | `/event/[id]/release` | FN-PUB-011 | CURRENT_VERIFIED |
| UX-EVENT-018 | release orderで作品を移動/連続閲覧する | `/event/[id]/release` | FN-PUB-011 | CURRENT_VERIFIED |
| UX-EVENT-019 | release中に非公開作品をskip/非表示にする | `/event/[id]/release` | FN-PUB-011,FN-X-010 | CURRENT_VERIFIED |
| UX-EVENT-020 | event group一覧を見る | `/groups` | FN-PUB-013 | MERGED_INTO_OTHER |
| UX-EVENT-021 | event group detailをslugで開く | `/groups/[slug]` | FN-PUB-013 | MERGED_INTO_OTHER |
| UX-EVENT-022 | group説明/identityを見る | `/groups/[slug]` | FN-PUB-013 | MERGED_INTO_OTHER |
| UX-EVENT-023 | group所属eventへ移動する | `/groups/[slug]` | FN-PUB-013 | MERGED_INTO_OTHER |
| UX-EVENT-024 | non-public group/event情報がpublicへ漏れない | `/groups*` | FN-PUB-013,FN-X-004 | MERGED_INTO_OTHER |

## 認証・個人・投稿

出典: `docs/migration/frontend/AUTH_PERSONAL_ENTRY.md`

| UX ID | ユーザーから見える機能 | 画面・Surface | 関連FN | CURRENT/TARGET上の状態 |
| --- | --- | --- | --- | --- |
| UX-AUTH-001 | Discord OAuthでloginを開始する | entry/account | FN-AUTH-001 | CURRENT_VERIFIED |
| UX-AUTH-002 | login後に安全なnext URLへ戻る | auth complete/entry | FN-AUTH-001,FN-AUTH-007 | CURRENT_VERIFIED |
| UX-AUTH-003 | invalid/open-redirectになるnextを拒否する | auth flow | FN-AUTH-007 | CURRENT_VERIFIED |
| UX-AUTH-004 | existing sessionをreload/navigation後も復元する | authenticated routes | FN-AUTH-002 | CURRENT_VERIFIED |
| UX-AUTH-005 | auth一時障害時に誤logout/誤権限表示せず案内する | header/private routes | FN-AUTH-002,FN-AUTH-009 | CURRENT_VERIFIED |
| UX-AUTH-006 | Discord account linkingを安全に行う | auth/settings | FN-AUTH-003 | CURRENT_VERIFIED |
| UX-AUTH-007 | account重複/link conflictを誤統合せず表示する | auth/settings | FN-AUTH-003 | CURRENT_VERIFIED |
| UX-AUTH-008 | banned状態で制限された操作が利用不能になる | authenticated UI | FN-AUTH-004 | CURRENT_VERIFIED |
| UX-AUTH-009 | roleに応じadmin/manage導線と権限が反映される | authenticated UI | FN-AUTH-004,FN-X-002 | CURRENT_VERIFIED |
| UX-AUTH-010 | logoutしてsession/cookieを終了する | account menu | FN-AUTH-008 | CURRENT_VERIFIED |
| UX-AUTH-011 | onboarding未完了時に必要stepを見る | `/onboarding` | FN-AUTH-005 | CURRENT_VERIFIED |
| UX-AUTH-012 | onboardingを中断後に再開する | `/onboarding` | FN-AUTH-005 | CURRENT_VERIFIED |
| UX-AUTH-013 | current terms versionへ同意する | onboarding/rules | FN-AUTH-006 | CURRENT_VERIFIED |
| UX-AUTH-014 | terms再同意が必要な時にinteraction等が適切にgateされる | site-wide | FN-AUTH-006 | CURRENT_VERIFIED |
| UX-AUTH-015 | linked X IDsとapproval stateを見る | settings/account | FN-PER-007,FN-AUTH-009 | CURRENT_VERIFIED |
| UX-AUTH-016 | X ID登録/連携申請を行う | `/dashboard/settings` | FN-PER-007 | CURRENT_VERIFIED |
| UX-AUTH-017 | X ID conflict/重複/approval待ち/errorを見る | settings | FN-PER-007 | CURRENT_VERIFIED |
| UX-AUTH-018 | rejected X IDを状態に応じて再申請/修正する | settings | FN-PER-007 | CURRENT_VERIFIED |
| UX-AUTH-019 | approved X IDだけをActive X候補として選ぶ | account/settings | FN-AUTH-010 | CURRENT_VERIFIED |
| UX-AUTH-020 | Active X IDを切り替える | account menu | FN-AUTH-010 | CURRENT_VERIFIED |
| UX-AUTH-021 | Active X切替中のpending/errorを見る | account menu | FN-AUTH-010 | CURRENT_VERIFIED |
| UX-AUTH-022 | Active X切替後にaccount summaryと依存UIが再取得される | site-wide | FN-AUTH-010,FN-AUTH-009 | CURRENT_VERIFIED |
| UX-AUTH-023 | approved X IDがない時に必要な設定導線を見る | entry/chapter/dashboard | FN-PER-007,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-DASH-001 | dashboardで自分の現在状態を見る | `/dashboard` | FN-PER-001 | CURRENT_VERIFIED |
| UX-DASH-002 | 対応が必要な作品/参加作業へ進む | `/dashboard` | FN-PER-001 | CURRENT_VERIFIED |
| UX-DASH-003 | 自分に関係する作品をdashboardから開く | `/dashboard` | FN-PER-001 | CURRENT_VERIFIED |
| UX-DASH-004 | dashboardのempty/degraded/auth状態を見る | `/dashboard` | FN-PER-001 | CURRENT_VERIFIED |
| UX-DASH-005 | 自分/共同編集可能なvideo edit画面を開く | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-006 | video title/metadata等を編集・保存する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-007 | musicとcreditを独立fieldとして編集する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-008 | intro/highlight/story/closing等の作品説明を編集する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-009 | visibility/statusを権限・state ruleに従って変更する | `/dashboard/edit/[id]` | FN-PER-002,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-DASH-010 | creator/member情報を編集する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-011 | memberのrole/comment/public/editability等を管理する | `/dashboard/edit/[id]` | FN-PER-002,FN-PER-003 | CURRENT_VERIFIED |
| UX-DASH-012 | member chapter情報を編集/表示する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-013 | owner/admin等がchapter CSV一括登録を行う | `/dashboard/edit/[id]` | FN-PER-002,FN-PUB-005 | CURRENT_VERIFIED |
| UX-DASH-014 | edit validation/save pending/success/errorを見る | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_VERIFIED |
| UX-DASH-015 | 権限がないedit direct URLを安全に拒否される | `/dashboard/edit/[id]` | FN-PER-002,FN-X-002 | CURRENT_VERIFIED |
| UX-DASH-016 | video permission pageを開く | `/dashboard/edit/[id]/permissions` | FN-PER-003 | CURRENT_VERIFIED |
| UX-DASH-017 | collaborator/member permissionを確認する | permissions | FN-PER-003 | CURRENT_VERIFIED |
| UX-DASH-018 | collaborator permissionを変更する | permissions | FN-PER-003 | CURRENT_VERIFIED |
| UX-DASH-019 | owner保護等のpermission invariantにより危険変更を拒否される | permissions | FN-PER-003,FN-X-001 | CURRENT_VERIFIED |
| UX-LIB-001 | likeした作品tabを見る | `/dashboard/library?tab=like` | FN-PER-004,FN-PUB-007 | CURRENT_DIVERGENCE |
| UX-LIB-002 | bookmark/saveした作品tabを見る | `/dashboard/library?tab=bookmark` | FN-PER-004,FN-PUB-007 | CURRENT_DIVERGENCE |
| UX-LIB-003 | Active X名義の自分の作品tabを見る | `/dashboard/library?tab=mine` | FN-PER-004,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-LIB-004 | approved X IDsで共同編集可能な作品tabを見る | `/dashboard/library?tab=collab` | FN-PER-004,FN-PER-003 | CURRENT_VERIFIED |
| UX-LIB-005 | 自分が投稿したchapter/comment tabを見る | `/dashboard/library?tab=chapters` | FN-PER-004,FN-PUB-005 | CURRENT_VERIFIED |
| UX-LIB-006 | 各library tabをpaginateする | `/dashboard/library` | FN-PER-004 | CURRENT_VERIFIED |
| UX-LIB-007 | library tab/page queryをdeep-link/reload/back-forwardで維持する | `/dashboard/library` | FN-PER-004,FN-X-011 | CURRENT_VERIFIED |
| UX-LIB-008 | like/bookmark一覧からplaylist文脈で最初の作品を再生する | `/dashboard/library` → video | FN-PER-004,FN-PUB-008 | CURRENT_DIVERGENCE |
| UX-LIB-009 | Active X未設定時に「自分の作品」tabの説明を見る | `/dashboard/library` | FN-PER-004,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-LIB-010 | approved Xなしでcollab tabが空になる理由を見る | `/dashboard/library` | FN-PER-004 | CURRENT_VERIFIED |
| UX-LIB-011 | 各tab固有のempty stateを見る | `/dashboard/library` | FN-PER-004 | CURRENT_VERIFIED |
| UX-LIB-012 | D1/data unavailable時にretry/reload案内を見る | `/dashboard/library` | FN-PER-004 | CURRENT_VERIFIED |
| UX-SET-001 | personal settingsを表示する | `/dashboard/settings` | FN-PER-005 | CURRENT_VERIFIED |
| UX-SET-002 | profile/account表示情報を編集・保存する | `/dashboard/settings` | FN-PER-005 | CURRENT_VERIFIED |
| UX-SET-003 | X ID管理UIを使う | `/dashboard/settings` | FN-PER-007 | CURRENT_VERIFIED |
| UX-SET-004 | settings validation/pending/success/errorを見る | `/dashboard/settings` | FN-PER-005,FN-PER-007 | CURRENT_VERIFIED |
| UX-SET-005 | `next`付きsettings導線から元の作業へ戻る | `/dashboard/settings` | FN-PER-005 | CURRENT_VERIFIED |
| UX-SET-006 | personal YouTube playlist一覧/状態を見る | `/dashboard/youtube-playlists` | FN-PER-006,FN-JOB-005 | OBSOLETE |
| UX-SET-007 | playlist外部/作品導線を利用する | `/dashboard/youtube-playlists` | FN-PER-006 | OBSOLETE |
| UX-SET-008 | playlist sync/quota/degraded/error状態を見る | `/dashboard/youtube-playlists` | FN-PER-006,FN-JOB-005 | OBSOLETE |
| UX-ENTRY-001 | entry入口を未ログインで開きloginへ進む | `/entry` | FN-ENT-001,FN-AUTH-001 | CURRENT_VERIFIED |
| UX-ENTRY-002 | login後にentryの元のnextへ復帰する | `/entry` | FN-ENT-001,FN-AUTH-007 | CURRENT_VERIFIED |
| UX-ENTRY-003 | terms未同意時に必要な同意導線を見る | `/entry` | FN-ENT-001,FN-AUTH-006 | CURRENT_VERIFIED |
| UX-ENTRY-004 | X identity/Active X要件が不足している時に設定導線を見る | `/entry` | FN-ENT-001,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-ENTRY-005 | 参加可能event/slot/通常投稿から次行動を選ぶ | `/entry` | FN-ENT-001 | CURRENT_VERIFIED |
| UX-ENTRY-006 | event stage/deadline/募集状態に応じ利用可能な投稿経路が変わる | `/entry` | FN-ENT-001,FN-MNG-004 | CURRENT_VERIFIED |
| UX-ENTRY-007 | entry auth temporarily unavailableを明示する | `/entry` | FN-ENT-001,FN-AUTH-002 | CURRENT_VERIFIED |
| UX-SLOT-001 | available slot一覧/候補を見る | entry/event | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-002 | slotを予約する | entry | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-003 | capacity/duplicate/conflictで予約不可理由を見る | entry | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-004 | 自分の予約slot stateを確認する | entry/dashboard | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-005 | slotをrelease/cancelする | entry/manageable reservation | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-006 | 許可される場合slot期限/予約を延長する | entry/manageable reservation | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-007 | 連続枠/part numbering等のslot ruleに従う | entry | FN-ENT-002 | CURRENT_VERIFIED |
| UX-SLOT-008 | slot deadline超過/無効化後にsubmitを拒否される | `/entry/slotted` | FN-ENT-003 | CURRENT_VERIFIED |
| UX-SLOT-009 | reserved slotへslotted submission画面を開く | `/entry/slotted` | FN-ENT-003 | CURRENT_VERIFIED |
| UX-SUB-001 | unslotted submission画面を開く | `/entry/unslotted` | FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-002 | YouTube URL/IDをquick inputする | entry forms | FN-ENT-005 | CURRENT_VERIFIED |
| UX-SUB-003 | YouTube metadataを取得して入力補助に使う | entry forms | FN-ENT-005,FN-JOB-005 | CURRENT_VERIFIED |
| UX-SUB-004 | YouTube metadata取得中/失敗/quota状態を見る | entry forms | FN-ENT-005,FN-JOB-005 | CURRENT_VERIFIED |
| UX-SUB-005 | duplicate YouTube/videoをsubmit前に検出される | entry forms | FN-ENT-005 | CURRENT_VERIFIED |
| UX-SUB-006 | titleを入力/確認する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-007 | musicを入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-008 | credit/composerをmusicと独立して入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-009 | music reference URL等の関連metadataを入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-010 | intro/highlights/story/closing等の説明を入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-011 | software情報を選択/入力する | entry forms | FN-ENT-003,FN-ENT-004,FN-API-007 | CURRENT_VERIFIED |
| UX-SUB-012 | creator/display identityをActive X等から確認する | entry forms | FN-ENT-003,FN-ENT-004,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-SUB-013 | member rowsを追加/編集/削除する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-014 | member role/comment/editability/public stateを入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-015 | member/chapter batch input等の補助入力を使う | entry/edit | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-016 | event custom questionを表示する | slotted/event entry | FN-ENT-006 | CURRENT_VERIFIED |
| UX-SUB-017 | required custom questionへ回答しvalidationされる | entry | FN-ENT-006 | CURRENT_VERIFIED |
| UX-SUB-018 | custom answerを再編集/確認する | entry/edit | FN-ENT-006 | CURRENT_VERIFIED |
| UX-SUB-019 | submission formのfield validation errorを位置/意味付きで確認する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-020 | submit中のpending/二重送信防止状態を見る | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-021 | slotted作品をfinal submitする | `/entry/slotted` | FN-ENT-003 | CURRENT_VERIFIED |
| UX-SUB-022 | unslotted作品をcreate/submitする | `/entry/unslotted` | FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-023 | submit成功後に作品/次行動へ進む | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-024 | submit failure時に入力を失わず再試行できる | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_VERIFIED |
| UX-SUB-025 | visibility default/event ruleが正しく適用された結果を見る | entry | FN-ENT-003,FN-ENT-004,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-SUB-026 | part番号/slot由来scheduled time等のevent ruleがsubmit結果へ反映される | slotted entry | FN-ENT-003 | CURRENT_VERIFIED |

## 運営・管理

出典: `docs/migration/frontend/MANAGE_ADMIN.md`

| UX ID | ユーザーから見える機能 | 画面・Surface | 関連FN | CURRENT/TARGET上の状態 |
| --- | --- | --- | --- | --- |
| UX-MNG-001 | 担当event一覧を見る | `/manage` | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-002 | eventごとの要対応/状態を把握する | `/manage` | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-003 | staff scope外eventが表示されない | `/manage` | FN-MNG-001,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-004 | event workspaceへ移動する | `/manage` | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-005 | manage/admin mode差をbannerで理解する | manage shell | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-006 | 担当event navigationをsidebarで使う | manage shell | FN-MNG-001 | CURRENT_VERIFIED |
| UX-MNG-007 | Active X mismatch warningを見る | manage shell | FN-MNG-001,FN-AUTH-010 | CURRENT_VERIFIED |
| UX-MNG-008 | manage accessがないuserは安全にdashboardへ戻される | manage layout | FN-MNG-001,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-009 | event workspace overview/statusを見る | `/manage/events/[id]` | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-010 | workspace tab/section間をevent context維持して移動する | manage event routes | FN-MNG-002 | CURRENT_VERIFIED |
| UX-MNG-011 | event audience情報を閲覧する | `.../audience` | FN-MNG-003 | CURRENT_VERIFIED |
| UX-MNG-012 | audience privacy/permission範囲に応じて情報が制限される | `.../audience` | FN-MNG-003,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-013 | event settingsを表示する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-014 | event title/description/icon/accent等を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-015 | recruitment/stage/date等を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-016 | slot有無/関連event設定を編集する | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-017 | custom question等entry設定を編集する | `.../edit` | FN-MNG-004,FN-ENT-006 | CURRENT_VERIFIED |
| UX-MNG-018 | event settings validation/pending/success/errorを見る | `.../edit` | FN-MNG-004 | CURRENT_VERIFIED |
| UX-MNG-019 | permissionのないevent setting変更を拒否される | `.../edit` | FN-MNG-004,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-020 | review queueを見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-021 | review対象作品の必要情報を見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-022 | review判定/status transitionを実行する | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-023 | review理由/validation等を入力する | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-024 | review処理後に次の対象へ連続して進む | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-025 | review対象なしempty stateを見る | `.../review` | FN-MNG-005 | MERGED_INTO_OTHER |
| UX-MNG-026 | reviewer権限がない操作を拒否される | `.../review` | FN-MNG-005,FN-X-002 | MERGED_INTO_OTHER |
| UX-MNG-027 | event slot一覧とstateを見る | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-028 | slotの予約者/作品/時間等の管理情報を見る | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-029 | slotを作成/追加する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-030 | slotをbulk生成/調整する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-031 | slotを編集する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-032 | slot reservationをrelease/cancelする | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-033 | slot reservationを延長する | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-034 | capacity/連続slot/part等のrule違反を拒否される | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-035 | slot操作に伴うnotification結果/失敗を認識する | `.../slots` | FN-MNG-006,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-036 | slot destructive operationの確認を受ける | `.../slots` | FN-MNG-006 | CURRENT_VERIFIED |
| UX-MNG-037 | event staff一覧/roleを見る | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-038 | staffを追加する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-039 | staff role/permission presetを変更する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-040 | staffを削除する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-041 | 最後のownerを削除/降格できない | `.../staff` | FN-MNG-007,FN-X-001 | CURRENT_VERIFIED |
| UX-MNG-042 | roleごとの権限差をUIで確認する | `.../staff` | FN-MNG-007 | CURRENT_VERIFIED |
| UX-MNG-043 | permission不足操作をserver側でも拒否される | `.../staff` | FN-MNG-007,FN-X-002 | CURRENT_VERIFIED |
| UX-MNG-044 | event作品一覧を見る | `.../videos` | FN-MNG-008 | CURRENT_VERIFIED |
| UX-MNG-045 | status/filter/searchで要対応作品を絞る | `.../videos` | FN-MNG-008 | CURRENT_VERIFIED |
| UX-MNG-046 | event作品1件の管理詳細を開く | `.../videos/[videoId]` | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-047 | video metadata/member/entry回答等の運営情報を見る | video detail | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-048 | allowed fields/statusを更新する | video detail | FN-MNG-009 | CURRENT_VERIFIED |
| UX-MNG-049 | visibility/status transition結果を確認する | video detail | FN-MNG-009,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-MNG-050 | video処理のaudit/conflict/error結果を見る | video detail | FN-MNG-009,FN-X-005 | CURRENT_VERIFIED |
| UX-MNG-051 | event YouTube playlist sync状態を見る | `.../youtube-playlist` | FN-MNG-010,FN-JOB-005 | CURRENT_VERIFIED |
| UX-MNG-052 | playlist syncを開始/再試行する | `.../youtube-playlist` | FN-MNG-010,FN-JOB-005 | CURRENT_VERIFIED |
| UX-MNG-053 | quota/error/pending/successを見る | `.../youtube-playlist` | FN-MNG-010 | CURRENT_VERIFIED |
| UX-MNG-054 | 自分のscopeにあるnotification failure一覧を見る | `/manage/notifications` | FN-MNG-011 | CURRENT_VERIFIED |
| UX-MNG-055 | notification failureをfilterする | `/manage/notifications` | FN-MNG-011 | CURRENT_VERIFIED |
| UX-MNG-056 | retry可能なnotificationを再試行する | `/manage/notifications` | FN-MNG-011,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-057 | notification retryの重複/結果を確認する | `/manage/notifications` | FN-MNG-011,FN-JOB-006 | CURRENT_VERIFIED |
| UX-MNG-058 | delegated X link request queueを見る | `/manage/x-link-requests` | FN-MNG-012 | CURRENT_VERIFIED |
| UX-MNG-059 | X link requestをapprove/reject等処理する | `/manage/x-link-requests` | FN-MNG-012 | CURRENT_VERIFIED |
| UX-MNG-060 | X request処理のpermission/audit結果を見る | `/manage/x-link-requests` | FN-MNG-012,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-001 | admin dashboardで対応待ち/異常を把握する | `/admin` | FN-ADM-001 | CURRENT_VERIFIED |
| UX-ADM-002 | admin-only accessがserverで強制される | admin shell | FN-ADM-001,FN-X-002 | CURRENT_VERIFIED |
| UX-ADM-003 | announcement一覧を見る | `/admin/announcements` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-004 | announcementを新規作成する | `/admin/announcements/new` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-005 | announcementを編集する | `/admin/announcements/[id]/edit` | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-006 | publish/unpublish等の公開状態を変更する | announcements | FN-ADM-002 | CURRENT_VERIFIED |
| UX-ADM-007 | announcement validation/pending/audit結果を見る | announcements | FN-ADM-002,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-008 | API endpoint設定/一覧を見る | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |
| UX-ADM-009 | API endpointを作成/編集/有効化等する | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |
| UX-ADM-010 | endpoint security/validation/resultを確認する | `/admin/api-endpoints` | FN-ADM-003 | CURRENT_VERIFIED |
| UX-ADM-011 | audit logsを検索/filterする | `/admin/audit` | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-012 | audit detailを開く | `/admin/audit/[id]` | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-013 | before/after等の変更差分を見る | audit detail | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-014 | actor/対象/関連entityへ辿る | audit detail | FN-ADM-004 | CURRENT_VERIFIED |
| UX-ADM-015 | restore対象をpreviewする | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-016 | restoreを明示確認して実行する | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-017 | restore conflict/error/resultを見る | `/admin/audit/restore` | FN-ADM-005 | CURRENT_VERIFIED |
| UX-ADM-018 | audit settingsを見る/変更する | `/admin/audit/settings` | FN-ADM-006 | CURRENT_VERIFIED |
| UX-ADM-019 | history viewを検索/閲覧する | `/admin/history` | FN-ADM-015 | MERGED_INTO_OTHER |
| UX-ADM-020 | audit/historyの意味差を維持する | audit/history | FN-ADM-004,FN-ADM-015 | OBSOLETE |
| UX-ADM-021 | current cost/operation modeを見る | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-022 | cost/operation modeを変更する | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-023 | concurrent/CAS conflict時に再読込判断できる | `/admin/cost-guard` | FN-ADM-007 | CURRENT_VERIFIED |
| UX-ADM-024 | mode変更がbanner/関連surfaceへ反映される | admin/manage/maintenance | FN-ADM-007,FN-PLAT-011 | CURRENT_VERIFIED |
| UX-ADM-025 | event group一覧/検索を見る | `/admin/event-groups` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-026 | event groupを作成する | `/admin/event-groups/new` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-027 | event groupを編集する | `/admin/event-groups/[id]/edit` | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-028 | group slug/relation validation/audit結果を見る | event groups | FN-ADM-008 | CURRENT_VERIFIED |
| UX-ADM-029 | all event一覧/検索を見る | `/admin/events` | FN-ADM-009 | CURRENT_VERIFIED |
| UX-ADM-030 | event admin detailを見る | `/admin/events/[id]` | FN-ADM-009 | MERGED_INTO_OTHER |
| UX-ADM-031 | eventを新規作成する | `/admin/events/new` | FN-ADM-009 | CURRENT_VERIFIED |
| UX-ADM-032 | eventを編集する | `/admin/events/[id]/edit` | FN-ADM-009 | MERGED_INTO_OTHER |
| UX-ADM-033 | event owner/stage/visibility invariantを守って変更する | admin events | FN-ADM-009,FN-X-001 | CURRENT_VERIFIED |
| UX-ADM-034 | admin event slotsを確認/管理する | `/admin/events/[id]/slots` | FN-ADM-009,FN-MNG-006 | MERGED_INTO_OTHER |
| UX-ADM-035 | admin event staffを確認/管理する | `/admin/events/[id]/staff` | FN-ADM-011 | MERGED_INTO_OTHER |
| UX-ADM-036 | dangerous event operation前に明示確認を受ける | event admin | FN-ADM-012 | CURRENT_VERIFIED |
| UX-ADM-037 | dangerous event operationのaudit/resultを見る | event admin | FN-ADM-012,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-038 | event templates一覧を見る | `/admin/events/templates` | FN-ADM-010 | CURRENT_VERIFIED |
| UX-ADM-039 | event templateを作成/編集/適用する | templates | FN-ADM-010 | CURRENT_VERIFIED |
| UX-ADM-040 | template integrity/errorを見る | templates | FN-ADM-010 | CURRENT_VERIFIED |
| UX-ADM-041 | service health summaryを見る | `/admin/health` | FN-ADM-013 | CURRENT_VERIFIED |
| UX-ADM-042 | abnormal health itemを特定する | `/admin/health` | FN-ADM-013 | CURRENT_VERIFIED |
| UX-ADM-043 | integrity checksを実行/閲覧する | `/admin/health/integrity` | FN-ADM-014 | CURRENT_VERIFIED |
| UX-ADM-044 | integrity checkをdefault read-onlyとして扱う | integrity | FN-ADM-014 | CURRENT_VERIFIED |
| UX-ADM-045 | security diagnosticsを見る | `/admin/security` | FN-ADM-021 | CURRENT_VERIFIED |
| UX-ADM-046 | secret/private dataをsecurity UIへ露出させない | security | FN-ADM-021,FN-X-004 | CURRENT_VERIFIED |
| UX-ADM-047 | Worker/job healthを見る | `/admin/workers` | FN-ADM-027 | CURRENT_VERIFIED |
| UX-ADM-048 | failed/degraded Worker/jobを識別する | `/admin/workers` | FN-ADM-027 | CURRENT_VERIFIED |
| UX-ADM-049 | legacy import入力/対象を選ぶ | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-050 | import前preview/validationを見る | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-051 | importを明示実行する | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-052 | import partial failure/result/recovery情報を見る | `/admin/import` | FN-ADM-016 | CURRENT_VERIFIED |
| UX-ADM-053 | moderation case queueを見る | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-054 | moderation case詳細/理由を見る | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-055 | moderation transition/判断を実行する | `/admin/moderation` | FN-ADM-017 | CURRENT_VERIFIED |
| UX-ADM-056 | moderation audit/resultを見る | `/admin/moderation` | FN-ADM-017,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-057 | all notification状態/failureを見る | `/admin/notifications` | FN-ADM-018 | CURRENT_VERIFIED |
| UX-ADM-058 | notificationをfilter/searchする | `/admin/notifications` | FN-ADM-018 | CURRENT_VERIFIED |
| UX-ADM-059 | retry可能notificationを再試行する | `/admin/notifications` | FN-ADM-018,FN-JOB-006 | CURRENT_VERIFIED |
| UX-ADM-060 | retry idempotency/resultを確認する | `/admin/notifications` | FN-ADM-018,FN-JOB-006 | CURRENT_VERIFIED |
| UX-ADM-061 | permission simulatorへ条件を入力する | `/admin/permissions/simulator` | FN-ADM-019 | CURRENT_VERIFIED |
| UX-ADM-062 | simulator resultを見る | permission simulator | FN-ADM-019 | CURRENT_VERIFIED |
| UX-ADM-063 | simulatorがproduction permission coreと同じ結果を返す | permission simulator | FN-ADM-019,FN-X-002 | CURRENT_VERIFIED |
| UX-ADM-064 | rules/terms versions一覧を見る | `/admin/rules` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-065 | rules/termsを新規作成する | `/admin/rules/new` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-066 | rules/termsを編集する | `/admin/rules/[id]/edit` | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-067 | active/version/publish stateを管理する | rules | FN-ADM-020 | CURRENT_VERIFIED |
| UX-ADM-068 | terms更新がreaccept requirementへ反映される | rules/auth | FN-ADM-020,FN-AUTH-006 | CURRENT_VERIFIED |
| UX-ADM-069 | DB/table browserで対象dataを検索/閲覧する | `/admin/spreadsheet` | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-070 | permitted data edit/write operationを行う | `/admin/spreadsheet` | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-071 | dangerous/unsupported DB operationが明示的に抑止される | spreadsheet | FN-ADM-022 | CURRENT_VERIFIED |
| UX-ADM-072 | DB operationのvalidation/audit/resultを見る | spreadsheet | FN-ADM-022,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-073 | static build/rebuild job一覧とstateを見る | `/admin/static-builds` | FN-ADM-023,FN-PLAT-010 | CURRENT_VERIFIED |
| UX-ADM-074 | failed rebuildをretryする | static builds | FN-ADM-023 | CURRENT_VERIFIED |
| UX-ADM-075 | build queue/coalescing/pending/success/failureを確認する | static builds | FN-ADM-023,FN-PLAT-003 | CURRENT_VERIFIED |
| UX-ADM-076 | user一覧/検索/filterを見る | `/admin/users` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-077 | user詳細を開く | `/admin/users/[id]` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-078 | user account/X/role/ban等の管理情報を見る | user detail | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-079 | user編集画面を開く | `/admin/users/[id]/edit` | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-080 | permitted user fields/role/stateを編集する | user edit | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-081 | ban/unban等のsecurity-sensitive state変更を確認付きで行う | user admin | FN-ADM-024 | CURRENT_VERIFIED |
| UX-ADM-082 | user変更のvalidation/conflict/audit/resultを見る | user admin | FN-ADM-024,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-083 | all video一覧/検索/filterを見る | `/admin/videos` | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-084 | video admin detailを開く | `/admin/videos/[id]` | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-085 | video metadata/status/visibility/event等の管理情報を見る | video admin | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-086 | permitted video state/metadataを変更する | video admin | FN-ADM-025 | CURRENT_VERIFIED |
| UX-ADM-087 | video visibility changeのpublic reflection状態を見る | video admin | FN-ADM-025,FN-PLAT-004 | CURRENT_VERIFIED |
| UX-ADM-088 | video member管理画面を開く | `/admin/videos/[id]/members` | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-089 | member追加/編集/削除を行う | video members | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-090 | member permission/public/chapter関連状態を管理する | video members | FN-ADM-026 | CURRENT_VERIFIED |
| UX-ADM-091 | video/member変更のaudit/conflict/resultを見る | video admin | FN-ADM-025,FN-ADM-026,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-092 | X ID merge queue/候補を見る | `/admin/x-id-merges` | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-093 | merge前に影響対象をpreviewする | X merges | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-094 | X ID mergeを明示確認して実行する | X merges | FN-ADM-028 | CURRENT_VERIFIED |
| UX-ADM-095 | merge conflict/audit/resultを見る | X merges | FN-ADM-028,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-096 | X link request queueを見る | `/admin/x-link-requests` | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-097 | X link request detail/evidenceを見る | X link requests | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-098 | X link requestをapprove/rejectする | X link requests | FN-ADM-029 | CURRENT_VERIFIED |
| UX-ADM-099 | X link decisionのaudit/resultを見る | X link requests | FN-ADM-029,FN-X-005 | CURRENT_VERIFIED |
| UX-ADM-100 | YouTube quota usage/thresholdを見る | `/admin/youtube-quota` | FN-ADM-030 | CURRENT_VERIFIED |
| UX-ADM-101 | quota warning/degraded stateを見る | YouTube quota | FN-ADM-030 | CURRENT_VERIFIED |
| UX-ADM-102 | sync job一覧/stateを見る | `/admin/youtube-sync` | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-103 | failed syncをretryする | YouTube sync | FN-ADM-031,FN-JOB-005 | CURRENT_VERIFIED |
| UX-ADM-104 | sync pending/progress/error/resultを見る | YouTube sync | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-105 | playlist sync一覧/stateを見る | `/admin/youtube-sync/playlists` | FN-ADM-031 | CURRENT_VERIFIED |
| UX-ADM-106 | playlist syncを開始/retryする | playlist sync | FN-ADM-031,FN-JOB-005 | CURRENT_VERIFIED |
| UX-ADM-107 | quota/idempotency/failure状態をplaylist単位で確認する | playlist sync | FN-ADM-031 | CURRENT_VERIFIED |


# バックエンド/domain/platform既存機能 — 全136件

## 公開・探索・再生

出典: `docs/migration/functions/PUBLIC.md`

| FN ID | 既存機能・責務 | 主なSurface | 重要契約 | 状態 |
| --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見 | `/` | publicのみ、棚/順序契約 | CURRENT_VERIFIED |
| FN-PUB-002 | 作品詳細を開く | `/[id]` | internal/YouTube alias、visibility | CURRENT_VERIFIED |
| FN-PUB-003 | YouTube作品を再生 | `/[id]` | embed/player状態 | CURRENT_VERIFIED |
| FN-PUB-004 | 作品metadata/説明/credit/music表示 | `/[id]` | public DTO、SEO | CURRENT_VERIFIED |
| FN-PUB-005 | 作品chapter表示 | `/[id]` | public/private境界 | CURRENT_VERIFIED |
| FN-PUB-006 | view計測 | `/[id]` | 重複、集計、非同期副作用 | CURRENT_VERIFIED |
| FN-PUB-007 | like/bookmark作品interaction | `/[id]` | TARGETはlike/bookmarkともActive X所有、auth/匿名状態、idempotency | CURRENT_DIVERGENCE |
| FN-PUB-008 | viewer utility/private overlay | `/[id]` | private data leak禁止 | CURRENT_VERIFIED |
| FN-PUB-009 | イベント一覧 | `/event` | public eventのみ | CURRENT_VERIFIED |
| FN-PUB-010 | イベント詳細/作品一覧 | `/event/[id]` | visibility/stage | CURRENT_VERIFIED |
| FN-PUB-011 | イベントrelease連続閲覧 | `/event/[id]/release` | release順/公開状態 | CURRENT_VERIFIED |
| FN-PUB-012 | 公開枠状況 | `/event/[id]/slots` | live/公開可能情報のみ | CURRENT_VERIFIED |
| FN-PUB-013 | イベントグループ一覧/詳細 | `/groups*` | group visibility | CURRENT_VERIFIED |
| FN-PUB-014 | 作品一覧・filter・search | `/list` | filter/query semantics | CURRENT_VERIFIED |
| FN-PUB-015 | recommend表示 | `/recommend` | algorithm/output contract | CURRENT_VERIFIED |
| FN-PUB-016 | trending表示 | `/trending` | analytics artifact/order | CURRENT_VERIFIED |
| FN-PUB-017 | creator一覧 | `/user` | public-listable X/userのみ | CURRENT_VERIFIED |
| FN-PUB-018 | creator profile/作品 | `/user/[id]` | visibility/profile contract | CURRENT_VERIFIED |
| FN-PUB-019 | creator portfolio | `/user/[id]/portfolio` | work ordering/navigation | CURRENT_VERIFIED |
| FN-PUB-020 | about | `/about` | static content | CURRENT_VERIFIED |
| FN-PUB-021 | rules public閲覧 | `/rules` | active terms/version | CURRENT_VERIFIED |
| FN-PUB-022 | SEO/canonical/OGP | public detail pages | URL/metadata parity | CURRENT_VERIFIED |
| FN-PUB-023 | 公開お知らせ表示 | `/` | publish対象だけ表示、本文/順序/空状態 | CURRENT_VERIFIED |
| FN-PUB-024 | 公開統計・募集中イベント/空き枠概要表示 | `/` | publicVideos/creators/activeEvents、primary event/slot summary | CURRENT_VERIFIED |
| FN-PUB-025 | 全体公開ナビゲーション/モバイルメニュー | public layout | active state、dismiss/focus、responsive navigation | CURRENT_VERIFIED |
| FN-PUB-026 | 公開ヘッダーから作品検索 | public layout → `/list?q=` | IME-safe GET、query/deep-link、mobile/desktop parity | CURRENT_VERIFIED |
| FN-PUB-027 | ライト/ダークテーマ切替 | public/global UI | localStorage永続化、system preference追従、accessible state | CURRENT_VERIFIED |

## 認証・個人・投稿

出典: `docs/migration/functions/AUTH_PERSONAL_ENTRY.md`

| FN ID | 既存機能・責務 | 主なSurface | 重要契約 | 状態 |
| --- | --- | --- | --- | --- |
| FN-AUTH-001 | Discord OAuth login | Auth.js/API | callback/origin/session | CURRENT_VERIFIED |
| FN-AUTH-002 | session復元 | auth/current user | existing sessions compatibility | CURRENT_VERIFIED |
| FN-AUTH-003 | Discord account linking | auth adapter/config | duplicate/link safety | CURRENT_VERIFIED |
| FN-AUTH-004 | banned/role state反映 | auth/session | authorization safety | CURRENT_VERIFIED |
| FN-AUTH-005 | onboarding | `/onboarding` | required initial steps | CURRENT_VERIFIED |
| FN-AUTH-006 | terms同意 | onboarding/terms action | version/user acceptance | CURRENT_VERIFIED |
| FN-AUTH-007 | auth complete redirect | `/auth/complete` | safe redirect/canonical host | CURRENT_VERIFIED |
| FN-AUTH-008 | logout/session終了 | Auth.js | cookie/session invalidation | CURRENT_VERIFIED |
| FN-AUTH-009 | account summary/private account API | public header/account UI, `app/api/account` | presence/details degraded state、authenticated private data、privileged link fail-closed | CURRENT_VERIFIED |
| FN-AUTH-010 | Active X ID切替 | account menu / `useActiveXSwitcher` | approvedのみ切替、pending/error state、切替後summary再取得 | CURRENT_VERIFIED |
| FN-PER-001 | dashboardで必要作業/作品状態を見る | `/dashboard` | own/related data only | CURRENT_VERIFIED |
| FN-PER-002 | 作品編集 | `/dashboard/edit/[id]`, manage-video/updateVideo | ownership/collab/event privilege | CURRENT_VERIFIED |
| FN-PER-003 | 共同編集権限管理 | permissions page, video-collab-perms | owner/permission parity | CURRENT_VERIFIED |
| FN-PER-004 | library閲覧 | `/dashboard/library` | TARGETのlike/bookmark/saveはActive X scoped、切替時に再取得 | CURRENT_DIVERGENCE |
| FN-PER-005 | user settings | `/dashboard/settings` | profile/X/session interactions | CURRENT_VERIFIED |
| FN-PER-006 | personal YouTube playlist確認 | `/dashboard/youtube-playlists` | quota/external state | MERGED_INTO_OTHER |
| FN-PER-007 | X ID登録/変更/申請 | settings/xid actions | approval/link constraints | CURRENT_VERIFIED |
| FN-ENT-001 | entry入口で参加/投稿方法を判断 | `/entry` | auth/event/slot state | CURRENT_VERIFIED |
| FN-ENT-002 | slot確保/状態管理 | slot actions | capacity/duplicate/auth | CURRENT_VERIFIED |
| FN-ENT-003 | slot付き作品提出 | `/entry/slotted`, submitSlotVideo | deadline/slot ownership | CURRENT_VERIFIED |
| FN-ENT-004 | 通常作品投稿 | `/entry/unslotted`, createFreeVideo | duplicate/input/visibility defaults | CURRENT_VERIFIED |
| FN-ENT-005 | YouTube quick input/metadata取得 | entry/video | duplicate detection/quota | CURRENT_VERIFIED |
| FN-ENT-006 | custom question回答 | entry/event | event schema/validation | CURRENT_VERIFIED |

## 運営・管理

出典: `docs/migration/functions/MANAGE_ADMIN.md`

| FN ID | 既存機能・責務 | 主なSurface | 重要契約 | 状態 |
| --- | --- | --- | --- | --- |
| FN-MNG-001 | 担当イベント一覧/要対応把握 | `/manage` | staff scope | CURRENT_VERIFIED |
| FN-MNG-002 | event workspace overview | `/manage/events/[id]` | event permission | CURRENT_VERIFIED |
| FN-MNG-003 | audience情報確認 | `.../audience` | permission/privacy | CURRENT_VERIFIED |
| FN-MNG-004 | event settings編集 | `.../edit`, event actions | permission/stage/validation | CURRENT_VERIFIED |
| FN-MNG-005 | review queue/審査 | `.../review` | reviewer permission/status transition | CURRENT_VERIFIED |
| FN-MNG-006 | slot運用 | `.../slots`, slot admin | slot state/notification | CURRENT_VERIFIED |
| FN-MNG-007 | staff管理 | `.../staff`, event-staff | owner最低1人/permission preset | CURRENT_VERIFIED |
| FN-MNG-008 | event作品一覧管理 | `.../videos` | event privilege/filters | CURRENT_VERIFIED |
| FN-MNG-009 | event作品1件処理 | `.../videos/[videoId]` | status/edit permission/audit | CURRENT_VERIFIED |
| FN-MNG-010 | event YouTube playlist同期管理 | `.../youtube-playlist` | quota/sync state | CURRENT_VERIFIED |
| FN-MNG-011 | 通知失敗/状態管理 | `/manage/notifications` | event scope/retry | CURRENT_VERIFIED |
| FN-MNG-012 | X link request処理 | `/manage/x-link-requests` | delegated permission/audit | CURRENT_VERIFIED |
| FN-ADM-001 | admin dashboard/対応待ち | `/admin` | admin only | CURRENT_VERIFIED |
| FN-ADM-002 | announcements CRUD | `/admin/announcements*`, announcement action | publish state/audit | CURRENT_VERIFIED |
| FN-ADM-003 | API endpoint設定/管理 | `/admin/api-endpoints`, api-endpoints action | admin/security | CURRENT_VERIFIED |
| FN-ADM-004 | audit検索/詳細 | `/admin/audit*` | immutable/auditable access | CURRENT_VERIFIED |
| FN-ADM-005 | audit restore | `/admin/audit/restore` | dangerous action/strict audit | CURRENT_VERIFIED |
| FN-ADM-006 | audit settings | `/admin/audit/settings` | admin write/audit | CURRENT_VERIFIED |
| FN-ADM-007 | cost guard | `/admin/cost-guard` | operation mode/full-row CAS/KV mirror | CURRENT_VERIFIED |
| FN-ADM-008 | event groups CRUD | `/admin/event-groups*` | slug/relation/audit | CURRENT_VERIFIED |
| FN-ADM-009 | events CRUD/admin detail | `/admin/events*` | owner invariant/stage/audit | CURRENT_VERIFIED |
| FN-ADM-010 | event template管理 | `/admin/events/templates` | template integrity | CURRENT_VERIFIED |
| FN-ADM-011 | event staff admin | admin/manage staff | owner/permission invariant | CURRENT_VERIFIED |
| FN-ADM-012 | dangerous event operations | event-admin-danger | explicit admin/audit | CURRENT_VERIFIED |
| FN-ADM-013 | health dashboard | `/admin/health` | diagnostic/read-only semantics | CURRENT_VERIFIED |
| FN-ADM-014 | integrity checks | `/admin/health/integrity` | data health/no mutation by default | CURRENT_VERIFIED |
| FN-ADM-015 | history閲覧 | `/admin/history` | audit/history distinction | MERGED_INTO_OTHER |
| FN-ADM-016 | legacy import | `/admin/import` | dedicated legacy boundary/preview | CURRENT_VERIFIED |
| FN-ADM-017 | moderation cases | `/admin/moderation` | state transition/audit | CURRENT_VERIFIED |
| FN-ADM-018 | notification admin/retry | `/admin/notifications` | retry/idempotency/audit | CURRENT_VERIFIED |
| FN-ADM-019 | permission simulator | `/admin/permissions/simulator` | must match real permission core | CURRENT_VERIFIED |
| FN-ADM-020 | rules/terms CRUD | `/admin/rules*` | versioning/acceptance effect | CURRENT_VERIFIED |
| FN-ADM-021 | security diagnostics | `/admin/security` | admin-only/no secret leak | CURRENT_VERIFIED |
| FN-ADM-022 | spreadsheet/DB browser | `/admin/spreadsheet` | admin/read-write boundary | CURRENT_VERIFIED |
| FN-ADM-023 | static build/rebuild管理 | `/admin/static-builds`, static-rebuild-admin | queue/job state/idempotency | CURRENT_VERIFIED |
| FN-ADM-024 | users search/detail/edit | `/admin/users*`, user-admin | auth state/audit | CURRENT_VERIFIED |
| FN-ADM-025 | videos search/detail/admin | `/admin/videos*`, admin/manage actions | status/permission/audit | CURRENT_VERIFIED |
| FN-ADM-026 | video members admin | `/admin/videos/[id]/members`, adminMembers | membership/permission | CURRENT_VERIFIED |
| FN-ADM-027 | workers monitoring | `/admin/workers` | worker/job health | CURRENT_VERIFIED |
| FN-ADM-028 | X ID merge | `/admin/x-id-merges`, xid-merge-admin | destructive merge/audit | CURRENT_VERIFIED |
| FN-ADM-029 | X link requests | `/admin/x-link-requests`, xid-admin | approval/audit | CURRENT_VERIFIED |
| FN-ADM-030 | YouTube quota | `/admin/youtube-quota` | quota counters/thresholds | CURRENT_VERIFIED |
| FN-ADM-031 | YouTube sync管理 | `/admin/youtube-sync*`, youtube-sync-admin | retry/quota/idempotency | CURRENT_VERIFIED |

## プラットフォーム・API・ジョブ・横断

出典: `docs/migration/functions/PLATFORM_API_JOBS.md`

| FN ID | 既存機能・責務 | 主なSurface | 重要契約 | 状態 |
| --- | --- | --- | --- | --- |
| FN-PLAT-001 | D1をcanonical sourceにする | DB/domain | R2/KVをcanonicalにしない | CURRENT_VERIFIED |
| FN-PLAT-002 | public DTO projection | public API/static generator | explicit safe DTO only | CURRENT_VERIFIED |
| FN-PLAT-003 | static artifact generation | content-jobs/static rebuild | coalesce/retry/dedupe | CURRENT_VERIFIED |
| FN-PLAT-004 | visibility fence | public loader/manifest | public→private即fail-closed | CURRENT_VERIFIED |
| FN-PLAT-005 | visibility repair | public-visibility-repair | safe repair/audit | CURRENT_VERIFIED |
| FN-PLAT-006 | R2 artifact hash/dedupe | content/static artifact | unnecessary PUT回避/integrity | CURRENT_VERIFIED |
| FN-PLAT-007 | degraded D1/public fallback policy | static delivery | fail-open禁止対象を維持 | CURRENT_VERIFIED |
| FN-PLAT-008 | search index/shards | content-jobs/public search | bounded generation/query contract | CURRENT_VERIFIED |
| FN-PLAT-009 | score/trending analytics | jobs/R2 analytics | scoring/order contract | CURRENT_VERIFIED |
| FN-PLAT-010 | content build/rebuild admin visibility | admin static builds | state/retry visibility | CURRENT_VERIFIED |
| FN-PLAT-011 | maintenance状態を全ユーザーへ案内 | `/maintenance` | operation modeに応じた正確な状態/次行動、admin例外 | CURRENT_VERIFIED |
| FN-PLAT-012 | 既存UI surfaceを開発者が確認 | `/dev/ui-surfaces` | dev-only surface、production機能と混同しない | CURRENT_VERIFIED |
| FN-API-001 | event endpoint API | `app/api/event-endpoints` | configured/public endpoint contract | CURRENT_VERIFIED |
| FN-API-002 | events API | `app/api/events` | auth/public DTO boundaries | CURRENT_VERIFIED |
| FN-API-003 | videos API | `app/api/videos` | interaction/private overlay/public DTO | CURRENT_VERIFIED |
| FN-API-004 | public API | `app/api/public` | explicit DTO/no leak | CURRENT_VERIFIED |
| FN-API-005 | internal API | `app/api/internal` | internal authentication/bounded use | CURRENT_VERIFIED |
| FN-API-006 | live API | `app/api/live` | realtime/current state | CURRENT_VERIFIED |
| FN-API-007 | software catalog API | `app/api/software` | normalized catalog/search | CURRENT_VERIFIED |
| FN-API-008 | health API | `app/api/health` | diagnostic semantics | CURRENT_VERIFIED |
| FN-API-009 | YouTube thumbnail proxy | `app/api/youtube-thumbnail` | URL safety/cache/CPU | CURRENT_VERIFIED |
| FN-API-010 | Google Drive image proxy | `app/api/google-drive-image` | URL safety/cache/CPU | CURRENT_VERIFIED |
| FN-API-011 | media APIs | `app/api/media` | R2/media visibility/streaming | CURRENT_VERIFIED |
| FN-JOB-001 | fast job scheduling/processing | `flamenode-fast-jobs` | bounded work/retry | CURRENT_VERIFIED |
| FN-JOB-002 | content/static generation | `flamenode-content-jobs` | target/coalesce/retry | CURRENT_VERIFIED |
| FN-JOB-003 | sync jobs | `flamenode-sync-jobs` | external sync/quota/retry | CURRENT_VERIFIED |
| FN-JOB-004 | Queue wake/DLQ/recovery | workers/queues | idempotency/redelivery/recovery | CURRENT_VERIFIED |
| FN-JOB-005 | YouTube metadata/playlist sync | sync/actions | quota/dedupe/failure state | CURRENT_VERIFIED |
| FN-JOB-006 | notifications/Discord | notification subsystem | delivery/retry/no duplicate | CURRENT_VERIFIED |
| FN-JOB-007 | cleanup jobs | workers | bounded deletion/no data loss | CURRENT_VERIFIED |
| FN-JOB-008 | static rebuild follow-up fanout | content-jobs | dependency/dedupe/no storm | CURRENT_VERIFIED |
| FN-X-001 | event ownerを0人にしない | permission/event staff | CURRENT_VERIFIED |
| FN-X-002 | UIだけで認可しない | auth/write guards | CURRENT_VERIFIED |
| FN-X-003 | public APIは明示DTOのみ | publicDto/routes | CURRENT_VERIFIED |
| FN-X-004 | private dataをpublic artifactへ出さない | projection/visibility | CURRENT_VERIFIED |
| FN-X-005 | mutation auditを維持 | audit helpers/actions | TARGET_REDESIGN_REQUIRED |
| FN-X-006 | Queue retry/idempotencyを維持 | queue consumers | CURRENT_VERIFIED |
| FN-X-007 | existing migration SQLを改変しない | migrations | CURRENT_VERIFIED |
| FN-X-008 | Remote D1 migrationを自動適用しない | deploy docs/scripts | CURRENT_VERIFIED |
| FN-X-009 | legacy importを専用境界外へ広げない | admin import | CURRENT_VERIFIED |
| FN-X-010 | public visibilityはfail-closed対象を維持 | static delivery | CURRENT_VERIFIED |
| FN-X-011 | URL/canonical互換を維持 | public routes | CURRENT_VERIFIED |
| FN-X-012 | production changeはrollback可能にする | routing/deploy | CURRENT_VERIFIED |


# 効率化・共通化の判断

バックエンド移行では、以下を毎回確認する。

- 同じ認証・actor情報をrequest内で重複取得していないか
- permission coreを複数箇所へ複製していないか
- audit/transaction/post-commit effectの境界が明確か
- read model/queryが画面ごとに無駄に重複していないか
- D1 rows read/writeを減らせるか
- public requestで不要なSSR/JSON parse/sort/generationをしていないか
- R2/KV/Cache/Queueの責務がD1 canonicalと混ざっていないか
- YouTube/Discord等のexternal syncがHTTP requestへ不要に乗っていないか
- error/result/validation contractを安全に共通化できるか
- framework固有処理とdomain ruleを分離できるか

共通化で意味が曖昧になる場合は、重複コードが残ってもdomain別実装を選ぶ。

## 現時点の最終判断

- **Performance/architecture最適化のために、frontend product behavior変更を必須とするblocker: 0**
- Public SSG、Private SPA、bounded API、request-local auth context、D1 read-model最適化、Queue/background化、stable imageのdirect/static/R2 deliveryは、既存UXを維持したまま実現可能。
- ただしActive X interaction ownershipは性能都合ではなく**確定済みTARGET要件**としてsemantic changeが必要。
- event rename tombstone、visibility fence、Queue/application retry/recovery、Discord duplicate suppression、YouTube quota/cursor等は、単純化のために消してはいけない意図的例外。

詳細は `BACKEND_OPTIMIZATION.md` と `gap-scan/BACKEND_FN_OPTIMIZATION.md` を参照。

# UIデザイン移行

- 旧 `docs/design-redesign/` は削除済みであり使用しない。
- `app/(redesign)` も新UI正本として使用しない。
- 新しいvisual / information architectureは、後日ユーザーから渡されるHTML mockを `UI_REFERENCE.md` に登録してから扱う。
- `UI_REFERENCE.md = PENDING_HTML` の間は、新しいvisual hierarchy/component compositionをagentが勝手に確定しない。
- HTML mockにないCURRENT機能も暗黙削除しない。

# `/flamenode-migration` での使い方

毎taskで最初にこのカタログを読み、対象domainを特定する。
その後、該当する `frontend/*.md` / `functions/*.md` / screen mapping / action/API/job evidenceだけを詳細に読む。

画面を移行する時のDONE条件:

```text
HTML mockに基づくvisual実装
AND affected UX-* の全件disposition
AND related FN-* / action / API / job parity
AND permission/privacy/visibility/side-effect parity
AND loading/empty/error/forbidden/pending/degraded state parity
AND responsive/accessibility parity
AND URL/query/history/reload parity
```

見た目だけ完成してもDONEではない。

# 変更・削除ルール

既存機能を削除または意味変更する場合:

```text
CURRENT
-> 影響UX/FNを列挙
-> frontendへの具体的影響を提示
-> REMOVAL_PROPOSED / UX_IMPACT_REVIEW_REQUIRED
-> ユーザー明示承認
-> 実装
-> parity / regression validation
```

効率化の障害になる機能が見つかった場合は、`AGENT_PROTOCOL.md` のOptimization blocker形式でfrontend影響を具体的に提示し、承認まではCURRENT behavior維持をdefaultとする。
