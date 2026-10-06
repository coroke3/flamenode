# FlameNode CURRENT Route Inventory

> Status: Active / CURRENT route source of truth
> Last updated: 2026-10-07
> Scope: 現行productionでユーザー・運営者・管理者・開発者が到達する画面URL
> Evidence: `app/` current route tree + current code

この文書はUIデザイン案ではない。移行・リデザインで画面/URLを落とさないためのCURRENT route棚卸しである。

## Rules

- routeの存在、role、purpose、primary actionはCURRENT codeから確認する。
- visual designの正本にはしない。
- target UIは `UI_REFERENCE.md` に後から登録されるHTML mockを使う。
- route削除/統合は、関連`UX-*`を全て移行し、URL互換性のdispositionを記録し、必要なら明示承認を得るまで行わない。
- route数とUX capability数は1:1ではない。

## Public — 16

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/` | `app/(public)/page.tsx` | 閲覧者 | 新着・注目・イベント・お知らせ等から作品/イベントへ進む |
| `/[id]` | `app/(public)/[id]/page.tsx` | 閲覧者/ログイン利用者 | 作品再生、詳細、interaction、chapter等を利用する |
| `/about` | `app/(public)/about/page.tsx` | 閲覧者 | FlameNodeを理解し主要導線へ進む |
| `/event` | `app/(public)/event/page.tsx` | 閲覧者/参加者 | イベントを検索・絞込して開く |
| `/event/[id]` | `app/(public)/event/[id]/page.tsx` | 閲覧者/参加者 | イベント概要、募集状態、作品を確認する |
| `/event/[id]/release` | `app/(public)/event/[id]/release/page.tsx` | 閲覧者 | 公開順/イベント文脈で作品を連続閲覧する |
| `/event/[id]/slots` | `app/(public)/event/[id]/slots/page.tsx` | 閲覧者/参加者 | 公開可能な枠状況を確認する |
| `/groups` | `app/(public)/groups/page.tsx` | 閲覧者 | イベントグループを探す |
| `/groups/[slug]` | `app/(public)/groups/[slug]/page.tsx` | 閲覧者 | グループ所属イベントを確認する |
| `/list` | `app/(public)/list/page.tsx` | 閲覧者 | 作品を検索・filter・sort・paginateする |
| `/recommend` | `app/(public)/recommend/page.tsx` | 閲覧者 | おすすめ作品を探す |
| `/rules` | `app/(public)/rules/page.tsx` | 全ユーザー | 現行ルール/規約を確認する |
| `/trending` | `app/(public)/trending/page.tsx` | 閲覧者 | 注目作品/順位を確認する |
| `/user` | `app/(public)/user/page.tsx` | 閲覧者 | creatorを検索・探索する |
| `/user/[id]` | `app/(public)/user/[id]/page.tsx` | 閲覧者 | creator profile、works、collab等を見る |
| `/user/[id]/portfolio` | `app/(public)/user/[id]/portfolio/page.tsx` | 閲覧者 | creator作品をportfolio文脈で閲覧する |

## Personal — 6

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/dashboard` | `app/(auth)/dashboard/page.tsx` | ログインユーザー | 自分の状態・必要作業・作品へ進む |
| `/dashboard/edit/[id]` | `app/(auth)/dashboard/edit/[id]/page.tsx` | owner/共同編集者等 | 作品情報・member・chapter等を権限範囲内で編集する |
| `/dashboard/edit/[id]/permissions` | `app/(auth)/dashboard/edit/[id]/permissions/page.tsx` | owner/権限保有者 | 共同編集権限を確認・変更する |
| `/dashboard/library` | `app/(auth)/dashboard/library/page.tsx` | ログインユーザー | like/save/自作品/共同編集/chapterを一覧する |
| `/dashboard/settings` | `app/(auth)/dashboard/settings/page.tsx` | ログインユーザー | profile/X ID/account関連設定を管理する |
| `/dashboard/youtube-playlists` | `app/(auth)/dashboard/youtube-playlists/page.tsx` | ログインユーザー | 自分に関係するYouTube playlist状態を確認する |

## Entry — 3

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/entry` | `app/(auth)/entry/page.tsx` | 未ログイン/ログイン/参加者 | login・条件確認・event/slot/通常投稿の次行動を選ぶ |
| `/entry/slotted` | `app/(auth)/entry/slotted/page.tsx` | 枠確保済み参加者 | 予約枠へ作品を提出する |
| `/entry/unslotted` | `app/(auth)/entry/unslotted/page.tsx` | 投稿者 | 枠なしで作品を登録する |

## Manage — 12

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/manage` | `app/(manage)/manage/page.tsx` | event staff/admin | 担当イベントと要対応を把握する |
| `/manage/events/[id]` | `app/(manage)/manage/events/[id]/page.tsx` | event staff/admin | event運用workspaceを開く |
| `/manage/events/[id]/audience` | `app/(manage)/manage/events/[id]/audience/page.tsx` | 許可されたevent staff/admin | audience情報を確認する |
| `/manage/events/[id]/edit` | `app/(manage)/manage/events/[id]/edit/page.tsx` | 許可されたevent staff/admin | event設定を編集する |
| `/manage/events/[id]/review` | `app/(manage)/manage/events/[id]/review/page.tsx` | reviewer等 | review queueを処理する |
| `/manage/events/[id]/slots` | `app/(manage)/manage/events/[id]/slots/page.tsx` | 許可されたevent staff/admin | slotを確認・運用する |
| `/manage/events/[id]/staff` | `app/(manage)/manage/events/[id]/staff/page.tsx` | owner/許可されたstaff/admin | staff/role/permissionを管理する |
| `/manage/events/[id]/videos` | `app/(manage)/manage/events/[id]/videos/page.tsx` | 許可されたevent staff/admin | event作品を検索・管理する |
| `/manage/events/[id]/videos/[videoId]` | `app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx` | 許可されたevent staff/admin | 作品1件の運用処理を行う |
| `/manage/events/[id]/youtube-playlist` | `app/(manage)/manage/events/[id]/youtube-playlist/page.tsx` | 許可されたevent staff/admin | playlist sync状態を確認・操作する |
| `/manage/notifications` | `app/(manage)/manage/notifications/page.tsx` | 許可された運営者/admin | notification失敗・状態を確認/再試行する |
| `/manage/x-link-requests` | `app/(manage)/manage/x-link-requests/page.tsx` | 許可された運営者/admin | X link requestを処理する |

## Admin — 45

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/admin` | `app/(admin)/admin/page.tsx` | admin | 全体の対応待ち/管理入口 |
| `/admin/announcements` | `app/(admin)/admin/announcements/page.tsx` | admin | announcement一覧・管理 |
| `/admin/announcements/[id]/edit` | `app/(admin)/admin/announcements/[id]/edit/page.tsx` | admin | announcement編集 |
| `/admin/announcements/new` | `app/(admin)/admin/announcements/new/page.tsx` | admin | announcement作成 |
| `/admin/api-endpoints` | `app/(admin)/admin/api-endpoints/page.tsx` | admin | API endpoint設定/状態管理 |
| `/admin/audit` | `app/(admin)/admin/audit/page.tsx` | admin | audit検索 |
| `/admin/audit/[id]` | `app/(admin)/admin/audit/[id]/page.tsx` | admin | audit詳細/差分確認 |
| `/admin/audit/restore` | `app/(admin)/admin/audit/restore/page.tsx` | admin | audit restoreを確認・実行 |
| `/admin/audit/settings` | `app/(admin)/admin/audit/settings/page.tsx` | admin | audit設定管理 |
| `/admin/cost-guard` | `app/(admin)/admin/cost-guard/page.tsx` | admin | operation/cost guard mode確認・変更 |
| `/admin/event-groups` | `app/(admin)/admin/event-groups/page.tsx` | admin | event group一覧/管理 |
| `/admin/event-groups/[id]/edit` | `app/(admin)/admin/event-groups/[id]/edit/page.tsx` | admin | event group編集 |
| `/admin/event-groups/new` | `app/(admin)/admin/event-groups/new/page.tsx` | admin | event group作成 |
| `/admin/events` | `app/(admin)/admin/events/page.tsx` | admin | 全event検索/管理 |
| `/admin/events/[id]` | `app/(admin)/admin/events/[id]/page.tsx` | admin | event管理詳細 |
| `/admin/events/[id]/edit` | `app/(admin)/admin/events/[id]/edit/page.tsx` | admin | event設定編集 |
| `/admin/events/[id]/slots` | `app/(admin)/admin/events/[id]/slots/page.tsx` | admin | event slot確認/管理 |
| `/admin/events/[id]/staff` | `app/(admin)/admin/events/[id]/staff/page.tsx` | admin | event staff確認/管理 |
| `/admin/events/new` | `app/(admin)/admin/events/new/page.tsx` | admin | event作成 |
| `/admin/events/templates` | `app/(admin)/admin/events/templates/page.tsx` | admin | event template管理 |
| `/admin/health` | `app/(admin)/admin/health/page.tsx` | admin | service health診断 |
| `/admin/health/integrity` | `app/(admin)/admin/health/integrity/page.tsx` | admin | data integrity診断 |
| `/admin/history` | `app/(admin)/admin/history/page.tsx` | admin | history閲覧 |
| `/admin/import` | `app/(admin)/admin/import/page.tsx` | admin | legacy import preview/apply |
| `/admin/moderation` | `app/(admin)/admin/moderation/page.tsx` | admin | moderation case処理 |
| `/admin/notifications` | `app/(admin)/admin/notifications/page.tsx` | admin | notification状態/再試行管理 |
| `/admin/permissions/simulator` | `app/(admin)/admin/permissions/simulator/page.tsx` | admin | permission判定を検証する |
| `/admin/rules` | `app/(admin)/admin/rules/page.tsx` | admin | rules/terms一覧/管理 |
| `/admin/rules/[id]/edit` | `app/(admin)/admin/rules/[id]/edit/page.tsx` | admin | rules/terms編集 |
| `/admin/rules/new` | `app/(admin)/admin/rules/new/page.tsx` | admin | rules/terms作成 |
| `/admin/security` | `app/(admin)/admin/security/page.tsx` | admin | security診断 |
| `/admin/spreadsheet` | `app/(admin)/admin/spreadsheet/page.tsx` | admin | DB table browsing / permitted write operations |
| `/admin/static-builds` | `app/(admin)/admin/static-builds/page.tsx` | admin | static build job状態/再試行管理 |
| `/admin/users` | `app/(admin)/admin/users/page.tsx` | admin | user検索/管理 |
| `/admin/users/[id]` | `app/(admin)/admin/users/[id]/page.tsx` | admin | user詳細/管理操作 |
| `/admin/users/[id]/edit` | `app/(admin)/admin/users/[id]/edit/page.tsx` | admin | user編集 |
| `/admin/videos` | `app/(admin)/admin/videos/page.tsx` | admin | video検索/管理 |
| `/admin/videos/[id]` | `app/(admin)/admin/videos/[id]/page.tsx` | admin | video管理詳細 |
| `/admin/videos/[id]/members` | `app/(admin)/admin/videos/[id]/members/page.tsx` | admin | video member管理 |
| `/admin/workers` | `app/(admin)/admin/workers/page.tsx` | admin | Worker/job状態監視 |
| `/admin/x-id-merges` | `app/(admin)/admin/x-id-merges/page.tsx` | admin | X ID merge確認/実行 |
| `/admin/x-link-requests` | `app/(admin)/admin/x-link-requests/page.tsx` | admin | X link request処理 |
| `/admin/youtube-quota` | `app/(admin)/admin/youtube-quota/page.tsx` | admin | YouTube quota状態確認 |
| `/admin/youtube-sync` | `app/(admin)/admin/youtube-sync/page.tsx` | admin | YouTube sync job管理 |
| `/admin/youtube-sync/playlists` | `app/(admin)/admin/youtube-sync/playlists/page.tsx` | admin | playlist sync管理 |

## System / operational — 4

| Route | Current file | Role | Purpose / primary action |
| --- | --- | --- | --- |
| `/dev/ui-surfaces` | `app/(public)/dev/ui-surfaces/page.tsx` | developer | CURRENT UI surface確認 |
| `/maintenance` | `app/(public)/maintenance/page.tsx` | all/admin exception | maintenance/cost-guard状態と次行動を案内 |
| `/onboarding` | `app/(auth)/onboarding/page.tsx` | new/incomplete account | 初期条件を満たす |
| `/auth/complete` | `app/(auth-complete)/auth/complete/page.tsx` | authenticating user | safeな認証完了遷移 |

## Coverage invariant

```text
Public      16
Personal     6
Entry        3
Manage      12
Admin       45
System       4
----------------
USER_SCREEN 86
```

MIG-0010で各USER_SCREENとcross-route shellを`UX-*`へ完全mappingする。

## CURRENT technical compatibility routes

これらは独立したユーザー機能ではないが、logical URLのUXを支えるためreplacement evidenceなしに削除しない。

| Logical URL | CURRENT technical route | Contract |
| --- | --- | --- |
| `/list?...` | `/list/~query` | search/filter/sort/page/query/deep-link semantics |
| `/user?...` | `/user/~query` | creator search/sort/page/query semantics |
| `/event?...` | `/event/~query` | event search/status/sort/query semantics |
| `/user/[id]?worksPage=...&collabPage=...` | `/user/[id]/paged` | tab pagination/deep-link/back-forward semantics |

## Global surfaces

以下は86 screenとは別のcross-cutting contract。

- `app/error.tsx`: recoverable route error
- `app/global-error.tsx`: catastrophic root error
- route-group `error.tsx`: auth/group context error
- `app/not-found.tsx`: 404 / non-public entity handling
- `app/robots.ts`: crawler policy
- `app/sitemap.ts`: public URL discovery

MIG-0010で関連`UX-GLOBAL-*` / cross-cutting acceptanceへ紐付ける。