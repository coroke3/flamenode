# Frontend UX Ledger — Auth / Personal / Entry

> Status: Active baseline
> Evidence state: `CURRENT_OBSERVED` = current code/surfaceで存在確認、`AUDIT_REQUIRED` = 詳細contract監査待ち

## Authentication / account / X identity

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-AUTH-001 | Discord OAuthでloginを開始する | entry/account | FN-AUTH-001 | CURRENT_OBSERVED |
| UX-AUTH-002 | login後に安全なnext URLへ戻る | auth complete/entry | FN-AUTH-001,FN-AUTH-007 | CURRENT_OBSERVED |
| UX-AUTH-003 | invalid/open-redirectになるnextを拒否する | auth flow | FN-AUTH-007 | CURRENT_OBSERVED |
| UX-AUTH-004 | existing sessionをreload/navigation後も復元する | authenticated routes | FN-AUTH-002 | CURRENT_OBSERVED |
| UX-AUTH-005 | auth一時障害時に誤logout/誤権限表示せず案内する | header/private routes | FN-AUTH-002,FN-AUTH-009 | CURRENT_OBSERVED |
| UX-AUTH-006 | Discord account linkingを安全に行う | auth/settings | FN-AUTH-003 | AUDIT_REQUIRED |
| UX-AUTH-007 | account重複/link conflictを誤統合せず表示する | auth/settings | FN-AUTH-003 | AUDIT_REQUIRED |
| UX-AUTH-008 | banned状態で制限された操作が利用不能になる | authenticated UI | FN-AUTH-004 | CURRENT_OBSERVED |
| UX-AUTH-009 | roleに応じadmin/manage導線と権限が反映される | authenticated UI | FN-AUTH-004,FN-X-002 | CURRENT_OBSERVED |
| UX-AUTH-010 | logoutしてsession/cookieを終了する | account menu | FN-AUTH-008 | CURRENT_OBSERVED |
| UX-AUTH-011 | onboarding未完了時に必要stepを見る | `/onboarding` | FN-AUTH-005 | CURRENT_OBSERVED |
| UX-AUTH-012 | onboardingを中断後に再開する | `/onboarding` | FN-AUTH-005 | AUDIT_REQUIRED |
| UX-AUTH-013 | current terms versionへ同意する | onboarding/rules | FN-AUTH-006 | CURRENT_OBSERVED |
| UX-AUTH-014 | terms再同意が必要な時にinteraction等が適切にgateされる | site-wide | FN-AUTH-006 | CURRENT_OBSERVED |
| UX-AUTH-015 | linked X IDsとapproval stateを見る | settings/account | FN-PER-007,FN-AUTH-009 | CURRENT_OBSERVED |
| UX-AUTH-016 | X ID登録/連携申請を行う | `/dashboard/settings` | FN-PER-007 | CURRENT_OBSERVED |
| UX-AUTH-017 | X ID conflict/重複/approval待ち/errorを見る | settings | FN-PER-007 | CURRENT_OBSERVED |
| UX-AUTH-018 | rejected X IDを状態に応じて再申請/修正する | settings | FN-PER-007 | AUDIT_REQUIRED |
| UX-AUTH-019 | approved X IDだけをActive X候補として選ぶ | account/settings | FN-AUTH-010 | CURRENT_OBSERVED |
| UX-AUTH-020 | Active X IDを切り替える | account menu | FN-AUTH-010 | CURRENT_OBSERVED |
| UX-AUTH-021 | Active X切替中のpending/errorを見る | account menu | FN-AUTH-010 | CURRENT_OBSERVED |
| UX-AUTH-022 | Active X切替後にaccount summaryと依存UIが再取得される | site-wide | FN-AUTH-010,FN-AUTH-009 | CURRENT_OBSERVED |
| UX-AUTH-023 | approved X IDがない時に必要な設定導線を見る | entry/chapter/dashboard | FN-PER-007,FN-AUTH-010 | CURRENT_OBSERVED |

## Dashboard / personal overview

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-DASH-001 | dashboardで自分の現在状態を見る | `/dashboard` | FN-PER-001 | CURRENT_OBSERVED |
| UX-DASH-002 | 対応が必要な作品/参加作業へ進む | `/dashboard` | FN-PER-001 | AUDIT_REQUIRED |
| UX-DASH-003 | 自分に関係する作品をdashboardから開く | `/dashboard` | FN-PER-001 | CURRENT_OBSERVED |
| UX-DASH-004 | dashboardのempty/degraded/auth状態を見る | `/dashboard` | FN-PER-001 | AUDIT_REQUIRED |
| UX-DASH-005 | 自分/共同編集可能なvideo edit画面を開く | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_OBSERVED |
| UX-DASH-006 | video title/metadata等を編集・保存する | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_OBSERVED |
| UX-DASH-007 | musicとcreditを独立fieldとして編集する | `/dashboard/edit/[id]` | FN-PER-002 | AUDIT_REQUIRED |
| UX-DASH-008 | intro/highlight/story/closing等の作品説明を編集する | `/dashboard/edit/[id]` | FN-PER-002 | AUDIT_REQUIRED |
| UX-DASH-009 | visibility/statusを権限・state ruleに従って変更する | `/dashboard/edit/[id]` | FN-PER-002,FN-PLAT-004 | AUDIT_REQUIRED |
| UX-DASH-010 | creator/member情報を編集する | `/dashboard/edit/[id]` | FN-PER-002 | AUDIT_REQUIRED |
| UX-DASH-011 | memberのrole/comment/public/editability等を管理する | `/dashboard/edit/[id]` | FN-PER-002,FN-PER-003 | AUDIT_REQUIRED |
| UX-DASH-012 | member chapter情報を編集/表示する | `/dashboard/edit/[id]` | FN-PER-002 | AUDIT_REQUIRED |
| UX-DASH-013 | owner/admin等がchapter CSV一括登録を行う | `/dashboard/edit/[id]` | FN-PER-002,FN-PUB-005 | CURRENT_OBSERVED |
| UX-DASH-014 | edit validation/save pending/success/errorを見る | `/dashboard/edit/[id]` | FN-PER-002 | CURRENT_OBSERVED |
| UX-DASH-015 | 権限がないedit direct URLを安全に拒否される | `/dashboard/edit/[id]` | FN-PER-002,FN-X-002 | CURRENT_OBSERVED |
| UX-DASH-016 | video permission pageを開く | `/dashboard/edit/[id]/permissions` | FN-PER-003 | CURRENT_OBSERVED |
| UX-DASH-017 | collaborator/member permissionを確認する | permissions | FN-PER-003 | CURRENT_OBSERVED |
| UX-DASH-018 | collaborator permissionを変更する | permissions | FN-PER-003 | CURRENT_OBSERVED |
| UX-DASH-019 | owner保護等のpermission invariantにより危険変更を拒否される | permissions | FN-PER-003,FN-X-001 | AUDIT_REQUIRED |

## Library

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-LIB-001 | likeした作品tabを見る | `/dashboard/library?tab=like` | FN-PER-004,FN-PUB-007 | CURRENT_OBSERVED |
| UX-LIB-002 | bookmark/saveした作品tabを見る | `/dashboard/library?tab=bookmark` | FN-PER-004,FN-PUB-007 | CURRENT_OBSERVED |
| UX-LIB-003 | Active X名義の自分の作品tabを見る | `/dashboard/library?tab=mine` | FN-PER-004,FN-AUTH-010 | CURRENT_OBSERVED |
| UX-LIB-004 | approved X IDsで共同編集可能な作品tabを見る | `/dashboard/library?tab=collab` | FN-PER-004,FN-PER-003 | CURRENT_OBSERVED |
| UX-LIB-005 | 自分が投稿したchapter/comment tabを見る | `/dashboard/library?tab=chapters` | FN-PER-004,FN-PUB-005 | CURRENT_OBSERVED |
| UX-LIB-006 | 各library tabをpaginateする | `/dashboard/library` | FN-PER-004 | CURRENT_OBSERVED |
| UX-LIB-007 | library tab/page queryをdeep-link/reload/back-forwardで維持する | `/dashboard/library` | FN-PER-004,FN-X-011 | CURRENT_OBSERVED |
| UX-LIB-008 | like/bookmark一覧からplaylist文脈で最初の作品を再生する | `/dashboard/library` → video | FN-PER-004,FN-PUB-008 | CURRENT_OBSERVED |
| UX-LIB-009 | Active X未設定時に「自分の作品」tabの説明を見る | `/dashboard/library` | FN-PER-004,FN-AUTH-010 | CURRENT_OBSERVED |
| UX-LIB-010 | approved Xなしでcollab tabが空になる理由を見る | `/dashboard/library` | FN-PER-004 | CURRENT_OBSERVED |
| UX-LIB-011 | 各tab固有のempty stateを見る | `/dashboard/library` | FN-PER-004 | CURRENT_OBSERVED |
| UX-LIB-012 | D1/data unavailable時にretry/reload案内を見る | `/dashboard/library` | FN-PER-004 | CURRENT_OBSERVED |

## Personal settings / playlist

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-SET-001 | personal settingsを表示する | `/dashboard/settings` | FN-PER-005 | CURRENT_OBSERVED |
| UX-SET-002 | profile/account表示情報を編集・保存する | `/dashboard/settings` | FN-PER-005 | AUDIT_REQUIRED |
| UX-SET-003 | X ID管理UIを使う | `/dashboard/settings` | FN-PER-007 | CURRENT_OBSERVED |
| UX-SET-004 | settings validation/pending/success/errorを見る | `/dashboard/settings` | FN-PER-005,FN-PER-007 | AUDIT_REQUIRED |
| UX-SET-005 | `next`付きsettings導線から元の作業へ戻る | `/dashboard/settings` | FN-PER-005 | AUDIT_REQUIRED |
| UX-SET-006 | personal YouTube playlist一覧/状態を見る | `/dashboard/youtube-playlists` | FN-PER-006,FN-JOB-005 | CURRENT_OBSERVED |
| UX-SET-007 | playlist外部/作品導線を利用する | `/dashboard/youtube-playlists` | FN-PER-006 | AUDIT_REQUIRED |
| UX-SET-008 | playlist sync/quota/degraded/error状態を見る | `/dashboard/youtube-playlists` | FN-PER-006,FN-JOB-005 | AUDIT_REQUIRED |

## Entry decision / prerequisites

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-ENTRY-001 | entry入口を未ログインで開きloginへ進む | `/entry` | FN-ENT-001,FN-AUTH-001 | CURRENT_OBSERVED |
| UX-ENTRY-002 | login後にentryの元のnextへ復帰する | `/entry` | FN-ENT-001,FN-AUTH-007 | CURRENT_OBSERVED |
| UX-ENTRY-003 | terms未同意時に必要な同意導線を見る | `/entry` | FN-ENT-001,FN-AUTH-006 | AUDIT_REQUIRED |
| UX-ENTRY-004 | X identity/Active X要件が不足している時に設定導線を見る | `/entry` | FN-ENT-001,FN-AUTH-010 | AUDIT_REQUIRED |
| UX-ENTRY-005 | 参加可能event/slot/通常投稿から次行動を選ぶ | `/entry` | FN-ENT-001 | CURRENT_OBSERVED |
| UX-ENTRY-006 | event stage/deadline/募集状態に応じ利用可能な投稿経路が変わる | `/entry` | FN-ENT-001,FN-MNG-004 | AUDIT_REQUIRED |
| UX-ENTRY-007 | entry auth temporarily unavailableを明示する | `/entry` | FN-ENT-001,FN-AUTH-002 | CURRENT_OBSERVED |

## Slot reservation / slotted entry

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-SLOT-001 | available slot一覧/候補を見る | entry/event | FN-ENT-002 | AUDIT_REQUIRED |
| UX-SLOT-002 | slotを予約する | entry | FN-ENT-002 | CURRENT_OBSERVED |
| UX-SLOT-003 | capacity/duplicate/conflictで予約不可理由を見る | entry | FN-ENT-002 | CURRENT_OBSERVED |
| UX-SLOT-004 | 自分の予約slot stateを確認する | entry/dashboard | FN-ENT-002 | CURRENT_OBSERVED |
| UX-SLOT-005 | slotをrelease/cancelする | entry/manageable reservation | FN-ENT-002 | AUDIT_REQUIRED |
| UX-SLOT-006 | 許可される場合slot期限/予約を延長する | entry/manageable reservation | FN-ENT-002 | AUDIT_REQUIRED |
| UX-SLOT-007 | 連続枠/part numbering等のslot ruleに従う | entry | FN-ENT-002 | AUDIT_REQUIRED |
| UX-SLOT-008 | slot deadline超過/無効化後にsubmitを拒否される | `/entry/slotted` | FN-ENT-003 | AUDIT_REQUIRED |
| UX-SLOT-009 | reserved slotへslotted submission画面を開く | `/entry/slotted` | FN-ENT-003 | CURRENT_OBSERVED |

## Submission form / YouTube / metadata

| UX ID | User-visible capability | Surface | Related FN | Evidence |
| --- | --- | --- | --- | --- |
| UX-SUB-001 | unslotted submission画面を開く | `/entry/unslotted` | FN-ENT-004 | CURRENT_OBSERVED |
| UX-SUB-002 | YouTube URL/IDをquick inputする | entry forms | FN-ENT-005 | CURRENT_OBSERVED |
| UX-SUB-003 | YouTube metadataを取得して入力補助に使う | entry forms | FN-ENT-005,FN-JOB-005 | CURRENT_OBSERVED |
| UX-SUB-004 | YouTube metadata取得中/失敗/quota状態を見る | entry forms | FN-ENT-005,FN-JOB-005 | AUDIT_REQUIRED |
| UX-SUB-005 | duplicate YouTube/videoをsubmit前に検出される | entry forms | FN-ENT-005 | CURRENT_OBSERVED |
| UX-SUB-006 | titleを入力/確認する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_OBSERVED |
| UX-SUB-007 | musicを入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_OBSERVED |
| UX-SUB-008 | credit/composerをmusicと独立して入力する | entry forms | FN-ENT-003,FN-ENT-004 | CURRENT_OBSERVED |
| UX-SUB-009 | music reference URL等の関連metadataを入力する | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-010 | intro/highlights/story/closing等の説明を入力する | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-011 | software情報を選択/入力する | entry forms | FN-ENT-003,FN-ENT-004,FN-API-007 | AUDIT_REQUIRED |
| UX-SUB-012 | creator/display identityをActive X等から確認する | entry forms | FN-ENT-003,FN-ENT-004,FN-AUTH-010 | AUDIT_REQUIRED |
| UX-SUB-013 | member rowsを追加/編集/削除する | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-014 | member role/comment/editability/public stateを入力する | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-015 | member/chapter batch input等の補助入力を使う | entry/edit | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-016 | event custom questionを表示する | slotted/event entry | FN-ENT-006 | CURRENT_OBSERVED |
| UX-SUB-017 | required custom questionへ回答しvalidationされる | entry | FN-ENT-006 | CURRENT_OBSERVED |
| UX-SUB-018 | custom answerを再編集/確認する | entry/edit | FN-ENT-006 | AUDIT_REQUIRED |
| UX-SUB-019 | submission formのfield validation errorを位置/意味付きで確認する | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-020 | submit中のpending/二重送信防止状態を見る | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-021 | slotted作品をfinal submitする | `/entry/slotted` | FN-ENT-003 | CURRENT_OBSERVED |
| UX-SUB-022 | unslotted作品をcreate/submitする | `/entry/unslotted` | FN-ENT-004 | CURRENT_OBSERVED |
| UX-SUB-023 | submit成功後に作品/次行動へ進む | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-024 | submit failure時に入力を失わず再試行できる | entry forms | FN-ENT-003,FN-ENT-004 | AUDIT_REQUIRED |
| UX-SUB-025 | visibility default/event ruleが正しく適用された結果を見る | entry | FN-ENT-003,FN-ENT-004,FN-PLAT-004 | AUDIT_REQUIRED |
| UX-SUB-026 | part番号/slot由来scheduled time等のevent ruleがsubmit結果へ反映される | slotted entry | FN-ENT-003 | AUDIT_REQUIRED |

## Notes

古い設計文書に存在するdraft/autosave、original-work、連続slot等は、CURRENT codeで確認できるまで`REQUIREMENT_ONLY`/`AUDIT_REQUIRED`として扱う。存在を決めつけてtargetへ実装しない一方、監査せず捨てもしない。