# Frontend UX Ledger — Cross-cutting / Shell / System

> Status: Active baseline
> IDs: `UX-GLOBAL-*`, `UX-SYS-*`
> Evidence state: `CURRENT_OBSERVED` = current code/surfaceで存在確認済み、`AUDIT_REQUIRED` = 詳細contract監査待ち

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-GLOBAL-001 | desktopのmain navigationから主要public routeへ移動 | public header | FN-PUB-025 | CURRENT_OBSERVED |
| UX-GLOBAL-002 | mobile menuを開閉してnavigationを使う | public header | FN-PUB-025 | CURRENT_OBSERVED |
| UX-GLOBAL-003 | 現在routeに対応するnavigation active stateを見る | public header | FN-PUB-025 | CURRENT_OBSERVED |
| UX-GLOBAL-004 | header search panelを開閉する | public header | FN-PUB-026 | CURRENT_OBSERVED |
| UX-GLOBAL-005 | headerから作品検索を送信する | public header → `/list?q=` | FN-PUB-026 | CURRENT_OBSERVED |
| UX-GLOBAL-006 | IME変換中のEnterで誤submitせず検索する | public search forms | FN-PUB-026 | CURRENT_OBSERVED |
| UX-GLOBAL-007 | light/dark themeを切り替える | global/header | FN-PUB-027 | CURRENT_OBSERVED |
| UX-GLOBAL-008 | theme選択をreload後も維持する | global | FN-PUB-027 | CURRENT_OBSERVED |
| UX-GLOBAL-009 | system preferenceを初期themeへ反映する | global | FN-PUB-027 | CURRENT_OBSERVED |
| UX-GLOBAL-010 | ログインpresenceをheaderで認識する | public header | FN-AUTH-009 | CURRENT_OBSERVED |
| UX-GLOBAL-011 | account menuを開き詳細を遅延取得する | public header | FN-AUTH-009 | CURRENT_OBSERVED |
| UX-GLOBAL-012 | account詳細取得中/失敗/再試行状態を見る | public header | FN-AUTH-009 | CURRENT_OBSERVED |
| UX-GLOBAL-013 | account詳細未確認時にadmin/manage linkをfail-closedで隠す | public header | FN-AUTH-009,FN-X-002 | CURRENT_OBSERVED |
| UX-GLOBAL-014 | 未ログイン時に現在routeへ戻れるlogin導線を使う | public header/account | FN-AUTH-001 | CURRENT_OBSERVED |
| UX-GLOBAL-015 | account menu/mobile/search panelがroute change/外側操作等でdismissされる | public header | FN-PUB-025 | CURRENT_OBSERVED |
| UX-GLOBAL-016 | menu/dialogをkeyboard/focusで操作する | public header | FN-PUB-025 | CURRENT_OBSERVED |
| UX-GLOBAL-017 | public footerから補助導線を使う | public layout | FN-PUB-025 | AUDIT_REQUIRED |
| UX-GLOBAL-018 | authenticated routeへdirect URL/reloadで到達してもauth状態を正しく解決する | auth/private layout | FN-AUTH-002 | CURRENT_OBSERVED |
| UX-GLOBAL-019 | query/deep-link/browser back-forwardで検索/タブ/page状態を再現する | public/private routes | FN-X-011 | CURRENT_OBSERVED |
| UX-GLOBAL-020 | mobile/tablet/desktopで主要操作へ到達できる | all frontend | cross-cutting | AUDIT_REQUIRED |
| UX-GLOBAL-021 | keyboardのみで主要interactive controlを操作できる | all frontend | cross-cutting | AUDIT_REQUIRED |
| UX-GLOBAL-022 | focus/aria/disabled/loading stateが操作意味と一致する | all frontend | cross-cutting | AUDIT_REQUIRED |
| UX-GLOBAL-023 | recoverable route errorでblank screenにならず再行動できる | `error.tsx` / route-group errors | cross-cutting | CURRENT_OBSERVED |
| UX-GLOBAL-024 | catastrophic root errorでもfallback UIを表示する | `global-error.tsx` | cross-cutting | CURRENT_OBSERVED |
| UX-GLOBAL-025 | unknown/non-public entityで安全な404を表示する | `not-found.tsx` | FN-PLAT-004,FN-X-010 | CURRENT_OBSERVED |
| UX-GLOBAL-026 | degraded public data時にprivate dataへfallbackせず利用不能状態を案内する | public routes | FN-PLAT-007,FN-X-010 | CURRENT_OBSERVED |
| UX-GLOBAL-027 | public projection反映待ちを必要箇所で明示する | public mutation feedback | FN-PLAT-003 | CURRENT_OBSERVED |
| UX-GLOBAL-028 | cost/operation mode警告を対象画面で確認する | admin/manage/public operational shell | FN-ADM-007,FN-PLAT-011 | CURRENT_OBSERVED |
| UX-GLOBAL-029 | admin consoleとmanage consoleのmode差を明示表示する | console sidebar | FN-MNG-002,FN-ADM-001 | CURRENT_OBSERVED |
| UX-GLOBAL-030 | admin console sidebarから管理領域へ移動する | admin shell | FN-ADM-001 | CURRENT_OBSERVED |
| UX-GLOBAL-031 | manage sidebarに自分が担当するeventだけが出る | manage shell | FN-MNG-001,FN-X-002 | CURRENT_OBSERVED |
| UX-GLOBAL-032 | manageでX link request権限がある時だけ導線が出る | manage shell | FN-MNG-012,FN-X-002 | CURRENT_OBSERVED |
| UX-GLOBAL-033 | Active Xとmanage staff identityが不一致の時に警告を見る | manage shell | FN-MNG-001,FN-AUTH-010 | CURRENT_OBSERVED |
| UX-SYS-001 | maintenance/cost modeの状態と次行動を見る | `/maintenance` | FN-PLAT-011 | CURRENT_OBSERVED |
| UX-SYS-002 | admin例外等のmaintenance access policyが適用される | `/maintenance` | FN-PLAT-011,FN-X-002 | CURRENT_OBSERVED |
| UX-SYS-003 | CURRENT UI surface catalogを開発検証に使う | `/dev/ui-surfaces` | FN-PLAT-012 | CURRENT_OBSERVED |
| UX-SYS-004 | crawlerに公開対象だけをindexさせる | robots/canonical | FN-PUB-022,FN-X-011 | AUDIT_REQUIRED |
| UX-SYS-005 | sitemapで公開URL discoveryを維持する | sitemap | FN-PUB-022 | AUDIT_REQUIRED |

## Contract rule

各行はMIG-0010までにusers/roles、success/loading/empty/error/forbidden/pending、responsive、keyboard/focus、deep-link/history、backend dependencyを詳細化する。