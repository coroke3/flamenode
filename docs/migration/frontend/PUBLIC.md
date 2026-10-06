# Frontend UX Ledger — Public / Video / Discovery / User / Event

> Status: Active baseline
> Evidence state: `CURRENT_OBSERVED` = current code/surfaceで存在確認、`AUDIT_REQUIRED` = 詳細contract監査待ち

## Home / static information

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-PUB-001 | トップで新着作品を見つける | `/` | FN-PUB-001 | CURRENT_OBSERVED |
| UX-PUB-002 | トップで注目/featured作品を見つける | `/` | FN-PUB-001,FN-PUB-016 | CURRENT_OBSERVED |
| UX-PUB-003 | トップから開催/募集中eventへ進む | `/` | FN-PUB-001,FN-PUB-009 | CURRENT_OBSERVED |
| UX-PUB-004 | トップで公開お知らせを見る | `/` | FN-PUB-023 | CURRENT_OBSERVED |
| UX-PUB-005 | トップで公開統計を確認する | `/` | FN-PUB-024 | CURRENT_OBSERVED |
| UX-PUB-006 | トップでevent/slot概要を確認する | `/` | FN-PUB-024,FN-PUB-012 | CURRENT_OBSERVED |
| UX-PUB-007 | homeのempty/degraded状態から次行動を判断する | `/` | FN-PLAT-007 | AUDIT_REQUIRED |
| UX-PUB-008 | Aboutでサービス概要を読む | `/about` | FN-PUB-020 | CURRENT_OBSERVED |
| UX-PUB-009 | Aboutから作品/参加等の主要導線へ進む | `/about` | FN-PUB-020 | AUDIT_REQUIRED |
| UX-PUB-010 | 現行rules/termsを読む | `/rules` | FN-PUB-021 | CURRENT_OBSERVED |
| UX-PUB-011 | rules内で必要項目を確認し同意導線へ進む | `/rules` | FN-PUB-021,FN-AUTH-006 | AUDIT_REQUIRED |
| UX-PUB-012 | public pageのcanonical/OGP/SEOが外部共有・検索で正しく見える | public | FN-PUB-022 | CURRENT_OBSERVED |

## Video detail / playback / interaction

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-VID-001 | internal video IDのURLで作品を開く | `/[id]` | FN-PUB-002 | CURRENT_OBSERVED |
| UX-VID-002 | YouTube video ID aliasのURLで同じ作品を開く | `/[id]` | FN-PUB-002,FN-API-003 | CURRENT_OBSERVED |
| UX-VID-003 | public/non-public visibilityに応じて作品が安全に表示/非表示になる | `/[id]` | FN-PLAT-004,FN-X-010 | CURRENT_OBSERVED |
| UX-VID-004 | YouTube playerで作品を再生する | `/[id]` | FN-PUB-003 | CURRENT_OBSERVED |
| UX-VID-005 | YouTube未登録でも公開作品情報を閲覧できるfallbackを見る | `/[id]` | FN-PUB-003 | CURRENT_OBSERVED |
| UX-VID-006 | viewが閲覧UXを阻害せず計測される | `/[id]` | FN-PUB-006 | CURRENT_OBSERVED |
| UX-VID-007 | 作品titleを確認する | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-008 | creator identity/icon/X IDを確認する | `/[id]` | FN-PUB-004,FN-PUB-018 | CURRENT_OBSERVED |
| UX-VID-009 | creatorのFlameNode profileへ移動する | `/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-VID-010 | creatorのX profileを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-011 | creatorのYouTube channelを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-012 | 作品のmusic/creditを確認する | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-013 | music reference URLを外部で開く | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-014 | intro commentを見る | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-015 | 使用software情報を見る | `/[id]` | FN-PUB-004,FN-API-007 | CURRENT_OBSERVED |
| UX-VID-016 | highlightsを見る | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-017 | production storyを見る | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-018 | closing commentを見る | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-019 | primary eventとstatusを確認しeventへ移動する | `/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-VID-020 | event受付中状態を見る | `/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-VID-021 | event YouTube playlistを条件に応じて外部で開く | `/[id]` | FN-JOB-005,FN-MNG-010 | CURRENT_OBSERVED |
| UX-VID-022 | 複数所属eventをtagから開く | `/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-VID-023 | public member一覧・role/commentを見る | `/[id]` | FN-PUB-004 | CURRENT_OBSERVED |
| UX-VID-024 | memberに紐づくchapter担当情報を見る | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-025 | likeを付ける/外す | `/[id]` | FN-PUB-007 | CURRENT_OBSERVED |
| UX-VID-026 | bookmark/saveを付ける/外す | `/[id]` | FN-PUB-007 | CURRENT_OBSERVED |
| UX-VID-027 | interaction中のpending/active状態を見る | `/[id]` | FN-PUB-007 | CURRENT_OBSERVED |
| UX-VID-028 | 未ログイン時にlike/saveからloginへ進む | `/[id]` | FN-PUB-007,FN-AUTH-001 | CURRENT_OBSERVED |
| UX-VID-029 | terms未同意時にinteractionが抑止されrulesへ進む | `/[id]` | FN-PUB-007,FN-AUTH-006 | CURRENT_OBSERVED |
| UX-VID-030 | banned/auth unavailable時にinteraction不能理由を見る | `/[id]` | FN-PUB-007,FN-AUTH-004 | CURRENT_OBSERVED |
| UX-VID-031 | public chapter/comment一覧を見る | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-032 | chapterをクリック/keyboard操作してplayerを該当時刻へseekする | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-033 | playback位置に対応するchapterがactive表示される | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-034 | private chapterを権限あるviewerだけがbadge付きで見る | `/[id]` | FN-PUB-005,FN-PUB-008 | CURRENT_OBSERVED |
| UX-VID-035 | 動画尺外chapterを範囲外表示しseekしない | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-036 | chapter/comment投稿sheetを現在再生位置から開く | `/[id]` | FN-PUB-005,FN-PUB-008 | CURRENT_OBSERVED |
| UX-VID-037 | chapter timeを手入力する | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-038 | 「現在位置」でplayer timeをchapter timeへ反映する | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-039 | chapter label/titleを入力する | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-040 | chapter noteを入力する | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-041 | chapterをpublic/privateで投稿する | `/[id]` | FN-PUB-005,FN-X-004 | CURRENT_OBSERVED |
| UX-VID-042 | chapter投稿にloginが必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-001 | CURRENT_OBSERVED |
| UX-VID-043 | chapter投稿にterms同意が必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-006 | CURRENT_OBSERVED |
| UX-VID-044 | chapter投稿にapproved Active Xが必要な状態を見る | `/[id]` | FN-PUB-005,FN-AUTH-010 | CURRENT_OBSERVED |
| UX-VID-045 | chapter投稿validation errorを見る | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-046 | private chapter投稿直後にviewer overlayへ即時反映する | `/[id]` | FN-PUB-008,FN-API-003 | CURRENT_OBSERVED |
| UX-VID-047 | public chapter投稿後にstatic/public反映待ちnoticeを見る | `/[id]` | FN-PLAT-003,FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-048 | 新規chapter投稿後に追加itemへscrollして結果を確認する | `/[id]` | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-049 | Active X切替時に入力中chapterがあれば破棄確認を受ける | chapter composer/account | FN-AUTH-010,FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-050 | owner/admin等がchapter CSV一括登録UIを利用する | edit/chapter composer | FN-PUB-005,FN-PER-002 | CURRENT_OBSERVED |
| UX-VID-051 | chapter CSVの上限/行error/成功件数を確認する | edit/chapter composer | FN-PUB-005 | CURRENT_OBSERVED |
| UX-VID-052 | viewer utility dockでplaylist/chapter等の補助機能を使う | `/[id]` | FN-PUB-008 | CURRENT_OBSERVED |
| UX-VID-053 | related videosを見る | `/[id]` | FN-PUB-002,FN-PLAT-008 | CURRENT_OBSERVED |
| UX-VID-054 | related data利用不能時にdegraded messageを見る | `/[id]` | FN-PLAT-007 | CURRENT_OBSERVED |
| UX-VID-055 | VideoObject JSON-LD/metadataが外部crawler/shareへ正しく公開される | `/[id]` | FN-PUB-022 | CURRENT_OBSERVED |

## List / recommend / trending discovery

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-DISC-001 | 全作品listを閲覧する | `/list` | FN-PUB-014 | CURRENT_OBSERVED |
| UX-DISC-002 | free-textで作品検索する | `/list?q=` | FN-PUB-014 | CURRENT_OBSERVED |
| UX-DISC-003 | event等のfilterで作品を絞る | `/list` | FN-PUB-014 | CURRENT_OBSERVED |
| UX-DISC-004 | sortを切り替える | `/list` | FN-PUB-014 | CURRENT_OBSERVED |
| UX-DISC-005 | pageを移動する | `/list` | FN-PUB-014 | CURRENT_OBSERVED |
| UX-DISC-006 | query URLを共有/reloadして同じ検索状態を復元する | `/list` | FN-PUB-014,FN-X-011 | CURRENT_OBSERVED |
| UX-DISC-007 | browser back/forwardで検索状態を復元する | `/list` | FN-PUB-014,FN-X-011 | CURRENT_OBSERVED |
| UX-DISC-008 | listのempty stateを見る | `/list` | FN-PUB-014 | AUDIT_REQUIRED |
| UX-DISC-009 | listのpublic data degraded/error stateを見る | `/list` | FN-PLAT-007 | AUDIT_REQUIRED |
| UX-DISC-010 | recommended作品を閲覧する | `/recommend` | FN-PUB-015 | CURRENT_OBSERVED |
| UX-DISC-011 | recommendation rail/sectionから作品を開く | `/recommend` | FN-PUB-015 | CURRENT_OBSERVED |
| UX-DISC-012 | recommendationのempty/degraded状態を見る | `/recommend` | FN-PUB-015,FN-PLAT-007 | AUDIT_REQUIRED |
| UX-DISC-013 | trending順位/作品を閲覧する | `/trending` | FN-PUB-016,FN-PLAT-009 | CURRENT_OBSERVED |
| UX-DISC-014 | trendingから作品を開く | `/trending` | FN-PUB-016 | CURRENT_OBSERVED |
| UX-DISC-015 | trendingの集計更新/empty/degraded状態を見る | `/trending` | FN-PUB-016,FN-PLAT-009 | AUDIT_REQUIRED |
| UX-DISC-016 | public list/recommend/trendingでprivate/voided作品が露出しない | discovery routes | FN-X-003,FN-X-004,FN-X-010 | CURRENT_OBSERVED |

## Creator / profile / portfolio

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-USER-001 | creator一覧を見る | `/user` | FN-PUB-017 | CURRENT_OBSERVED |
| UX-USER-002 | creatorをfree-text検索する | `/user` | FN-PUB-017 | CURRENT_OBSERVED |
| UX-USER-003 | creator listをsortする | `/user` | FN-PUB-017 | CURRENT_OBSERVED |
| UX-USER-004 | creator listをpaginateする | `/user` | FN-PUB-017 | CURRENT_OBSERVED |
| UX-USER-005 | creator検索URLを共有/reload/back-forwardで復元する | `/user` | FN-PUB-017,FN-X-011 | CURRENT_OBSERVED |
| UX-USER-006 | creator identity/icon/display nameを見る | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-007 | creatorのX profileを外部で開く | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-008 | creatorのYouTube channelを外部で開く | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-009 | creator profile blocks/about contentを見る | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-010 | creatorのworks tabを見る | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-011 | creatorのcollab tabを見る | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-012 | works/collabを独立paginateする | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-013 | profile tab/page queryをdeep-link/reload/back-forwardで維持する | `/user/[id]` | FN-PUB-018,FN-X-011 | CURRENT_OBSERVED |
| UX-USER-014 | profileのempty statesを見る | `/user/[id]` | FN-PUB-018 | CURRENT_OBSERVED |
| UX-USER-015 | portfolio viewでcreator作品を作品中心に連続閲覧する | `/user/[id]/portfolio` | FN-PUB-019 | CURRENT_OBSERVED |
| UX-USER-016 | public-listable/profile visibility ruleに従いcreator情報が露出する | `/user*` | FN-PUB-017,FN-PUB-018,FN-X-004 | CURRENT_OBSERVED |

## Event / slots / release / groups

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-EVENT-001 | 公開event一覧を見る | `/event` | FN-PUB-009 | CURRENT_OBSERVED |
| UX-EVENT-002 | eventをfree-text検索する | `/event` | FN-PUB-009 | CURRENT_OBSERVED |
| UX-EVENT-003 | event statusでfilterする | `/event` | FN-PUB-009 | CURRENT_OBSERVED |
| UX-EVENT-004 | event listをsortする | `/event` | FN-PUB-009 | CURRENT_OBSERVED |
| UX-EVENT-005 | event queryをdeep-link/reload/back-forwardで維持する | `/event` | FN-PUB-009,FN-X-011 | CURRENT_OBSERVED |
| UX-EVENT-006 | event title/icon/description等の概要を見る | `/event/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-EVENT-007 | event stage/statusを見る | `/event/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-EVENT-008 | event募集受付中/終了等の状態を見る | `/event/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-EVENT-009 | event所属public作品一覧を見る | `/event/[id]` | FN-PUB-010 | CURRENT_OBSERVED |
| UX-EVENT-010 | event entry可能時に参加/投稿導線へ進む | `/event/[id]` | FN-PUB-010,FN-ENT-001 | AUDIT_REQUIRED |
| UX-EVENT-011 | event external/playlist等の関連linkを開く | `/event/[id]` | FN-PUB-010,FN-JOB-005 | AUDIT_REQUIRED |
| UX-EVENT-012 | eventが非公開/blocked時にpublic dataが露出しない | `/event/[id]` | FN-PLAT-004,FN-X-010 | CURRENT_OBSERVED |
| UX-EVENT-013 | event slots pageを開く | `/event/[id]/slots` | FN-PUB-012 | CURRENT_OBSERVED |
| UX-EVENT-014 | slotの空き/使用/公開可能状態を見る | `/event/[id]/slots` | FN-PUB-012 | CURRENT_OBSERVED |
| UX-EVENT-015 | slot情報をmobileでも探索できる | `/event/[id]/slots` | FN-PUB-012 | AUDIT_REQUIRED |
| UX-EVENT-016 | slot public viewでprivate participant情報が漏れない | `/event/[id]/slots` | FN-PUB-012,FN-X-004 | CURRENT_OBSERVED |
| UX-EVENT-017 | event release viewを開く | `/event/[id]/release` | FN-PUB-011 | CURRENT_OBSERVED |
| UX-EVENT-018 | release orderで作品を移動/連続閲覧する | `/event/[id]/release` | FN-PUB-011 | CURRENT_OBSERVED |
| UX-EVENT-019 | release中に非公開作品をskip/非表示にする | `/event/[id]/release` | FN-PUB-011,FN-X-010 | AUDIT_REQUIRED |
| UX-EVENT-020 | event group一覧を見る | `/groups` | FN-PUB-013 | CURRENT_OBSERVED |
| UX-EVENT-021 | event group detailをslugで開く | `/groups/[slug]` | FN-PUB-013 | CURRENT_OBSERVED |
| UX-EVENT-022 | group説明/identityを見る | `/groups/[slug]` | FN-PUB-013 | AUDIT_REQUIRED |
| UX-EVENT-023 | group所属eventへ移動する | `/groups/[slug]` | FN-PUB-013 | CURRENT_OBSERVED |
| UX-EVENT-024 | non-public group/event情報がpublicへ漏れない | `/groups*` | FN-PUB-013,FN-X-004 | CURRENT_OBSERVED |

## Notes

- `CURRENT_OBSERVED`は存在確認であり、inputs/errors/permissions/side effectsの詳細audit完了ではない。
- MIG-0003/0004/0007/0008/0010で関連contractを補完し、MIG-0011でorphan/gapを0にする。
- `UX-*`は`FN-*`と1:1ではない。