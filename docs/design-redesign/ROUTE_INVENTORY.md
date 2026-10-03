# Route Inventory

`main` の対象 route group にある `page.tsx` を 2026-10-03 時点で棚卸しした。Mock ID は `/dev/redesign/mock/{Mock ID}` で閲覧する。

## Public — 16 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `app/(public)/page.tsx` | 閲覧者 | 新着・注目作品を見つける | 作品を見る | 導入・イベント情報が作品より先に出やすい | `public-home` |
| `/[id]` | `app/(public)/[id]/page.tsx` | 閲覧者 | 作品を視聴し詳細を見る | 映像を再生 | 周辺情報が視聴導線と競合しやすい | `public-id` |
| `/about` | `app/(public)/about/page.tsx` | 閲覧者 | サービスを理解する | 作品を見る | 説明量の整理余地 | `public-about` |
| `/event` | `app/(public)/event/page.tsx` | 閲覧者・参加者 | イベントを探す | イベントを見る | イベントカード依存 | `public-event` |
| `/event/[id]` | `app/(public)/event/[id]/page.tsx` | 閲覧者・参加者 | イベント概要と作品を見る | 作品を見る | 概要と作品の優先度が競合 | `public-event-id` |
| `/event/[id]/release` | `app/(public)/event/[id]/release/page.tsx` | 閲覧者 | 公開順で作品を見る | 連続再生 | 再生中心へさらに絞れる | `public-event-id-release` |
| `/event/[id]/slots` | `app/(public)/event/[id]/slots/page.tsx` | 参加者・閲覧者 | 枠状況を見る | 空き枠を確認 | 表のモバイル探索負荷 | `public-event-id-slots` |
| `/groups` | `app/(public)/groups/page.tsx` | 閲覧者 | イベント群を探す | グループを見る | カード一覧の階層が増えやすい | `public-groups` |
| `/groups/[slug]` | `app/(public)/groups/[slug]/page.tsx` | 閲覧者 | シリーズを追う | イベントを見る | グループ説明と作品探索が競合 | `public-groups-slug` |
| `/list` | `app/(public)/list/page.tsx` | 閲覧者 | 条件から作品を探す | 作品を開く | フィルタと表示切替の整理余地 | `public-list` |
| `/recommend` | `app/(public)/recommend/page.tsx` | 閲覧者 | おすすめ作品を探す | 作品を開く | レール中心で比較しにくい | `public-recommend` |
| `/rules` | `app/(public)/rules/page.tsx` | 全ユーザー | ルールを確認する | 必要項目を確認 | 長文探索の負荷 | `public-rules` |
| `/trending` | `app/(public)/trending/page.tsx` | 閲覧者 | 注目作品を探す | 作品を開く | 順位情報と作品情報の密度調整 | `public-trending` |
| `/user` | `app/(public)/user/page.tsx` | 閲覧者 | 作者を探す | プロフィールを見る | 作者探索のフィルタ余地 | `public-user` |
| `/user/[id]` | `app/(public)/user/[id]/page.tsx` | 閲覧者 | 作者と作品を見る | 作品を見る | プロフィール装飾より作品を優先したい | `public-user-id` |
| `/user/[id]/portfolio` | `app/(public)/user/[id]/portfolio/page.tsx` | 閲覧者 | 作者作品を連続して見る | 作品を見る | 作品以外のUIをさらに抑えられる | `public-user-id-portfolio` |

## Personal — 6 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | `app/(auth)/dashboard/page.tsx` | ログインユーザー | 今必要な作業を判断する | 必要な作業を続ける | KPI・名義情報が行動より先に目立つ | `personal-dashboard` |
| `/dashboard/edit/[id]` | `app/(auth)/dashboard/edit/[id]/page.tsx` | 所有者・共同編集者 | 作品を編集する | 変更を保存 | 長い編集画面で現在地を失いやすい | `personal-dashboard-edit-id` |
| `/dashboard/edit/[id]/permissions` | `app/(auth)/dashboard/edit/[id]/permissions/page.tsx` | 作品所有者 | 権限を管理する | 権限を更新 | 権限の影響が操作前に読み取りにくい | `personal-dashboard-edit-id-permissions` |
| `/dashboard/library` | `app/(auth)/dashboard/library/page.tsx` | ログインユーザー | 関連作品を見る | 作品を開く | 一覧密度を上げられる | `personal-dashboard-library` |
| `/dashboard/settings` | `app/(auth)/dashboard/settings/page.tsx` | ログインユーザー | 名義・設定を管理する | 設定を保存 | 説明と操作の分離余地 | `personal-dashboard-settings` |
| `/dashboard/youtube-playlists` | `app/(auth)/dashboard/youtube-playlists/page.tsx` | ログインユーザー | プレイリストを確認する | プレイリストを見る | 補助機能としての優先度が高く見えやすい | `personal-dashboard-youtube-playlists` |

## Entry — 3 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/entry` | `app/(auth)/entry/page.tsx` | 参加者・投稿者 | 次の参加/提出方法を選ぶ | 期限が近い作業を続ける | ログイン/名義/参加/通常投稿の分岐が同時に見える | `entry-entry` |
| `/entry/slotted` | `app/(auth)/entry/slotted/page.tsx` | 枠確保済み参加者 | 枠へ作品を提出する | 作品を提出 | フォームの段階と提出条件をさらに明確化可能 | `entry-entry-slotted` |
| `/entry/unslotted` | `app/(auth)/entry/unslotted/page.tsx` | 投稿者 | 通常投稿する | 作品を投稿 | 枠投稿との違いを簡潔にしたい | `entry-entry-unslotted` |

## Manage — 12 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/manage` | `app/(manage)/manage/page.tsx` | 運営者 | 担当イベントの問題を把握 | 要対応イベントを開く | イベントカード内のCTAが競合 | `manage-manage` |
| `/manage/events/[id]` | `app/(manage)/manage/events/[id]/page.tsx` | 運営者 | 1イベントを運営 | 要対応タブを開く | 概要・action rail・状態カードの要素量が多い | `manage-manage-events-id` |
| `/manage/events/[id]/audience` | `app/(manage)/manage/events/[id]/audience/page.tsx` | 運営者 | Audience情報を見る | 対象を確認 | event内機能としての位置づけが弱い | `manage-manage-events-id-audience` |
| `/manage/events/[id]/edit` | `app/(manage)/manage/events/[id]/edit/page.tsx` | 権限保有運営者 | イベント設定を更新 | 設定を保存 | 頻用運用と設定がページ遷移で離れる | `manage-manage-events-id-edit` |
| `/manage/events/[id]/review` | `app/(manage)/manage/events/[id]/review/page.tsx` | 審査担当 | 審査を処理 | 次の作品を審査 | 審査キューとしての連続処理を強めたい | `manage-manage-events-id-review` |
| `/manage/events/[id]/slots` | `app/(manage)/manage/events/[id]/slots/page.tsx` | 運営者 | 枠を管理 | 問題のある枠を開く | 状態密度とモバイル表の改善余地 | `manage-manage-events-id-slots` |
| `/manage/events/[id]/staff` | `app/(manage)/manage/events/[id]/staff/page.tsx` | 代表・運営者 | スタッフ管理 | スタッフを管理 | 役割と権限差を表中心にできる | `manage-manage-events-id-staff` |
| `/manage/events/[id]/videos` | `app/(manage)/manage/events/[id]/videos/page.tsx` | 運営者 | 作品を管理 | 要対応作品を開く | 作品一覧を運用密度へ寄せたい | `manage-manage-events-id-videos` |
| `/manage/events/[id]/videos/[videoId]` | `app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx` | 運営者 | 作品1件を処理 | 処理を確定 | 情報と処理操作を近づけたい | `manage-manage-events-id-videos-videoId` |
| `/manage/events/[id]/youtube-playlist` | `app/(manage)/manage/events/[id]/youtube-playlist/page.tsx` | 運営者 | Playlist同期を管理 | 同期状態を確認 | 補助機能の情報量が大きくなりやすい | `manage-manage-events-id-youtube-playlist` |
| `/manage/notifications` | `app/(manage)/manage/notifications/page.tsx` | 運営者 | 通知失敗を処理 | 失敗通知を確認 | イベント/状態フィルタをさらに短くできる | `manage-manage-notifications` |
| `/manage/x-link-requests` | `app/(manage)/manage/x-link-requests/page.tsx` | 権限保有運営者 | X ID申請を処理 | 申請を処理 | 申請キューとして表へ統一できる | `manage-manage-x-link-requests` |

## Admin — 45 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin` | `app/(admin)/admin/page.tsx` | 管理者 | 対応待ち把握 | 最優先キューを開く | 対応待ちがカードグリッド中心 | `admin-admin` |
| `/admin/announcements` | `app/(admin)/admin/announcements/page.tsx` | 管理者 | お知らせ管理 | お知らせを作成 | 管理一覧を表へ統一可能 | `admin-admin-announcements` |
| `/admin/announcements/[id]/edit` | `app/(admin)/admin/announcements/[id]/edit/page.tsx` | 管理者 | お知らせ編集 | 変更を保存 | フォーム共通化余地 | `admin-admin-announcements-id-edit` |
| `/admin/announcements/new` | `app/(admin)/admin/announcements/new/page.tsx` | 管理者 | お知らせ作成 | 公開設定へ進む | フォーム共通化余地 | `admin-admin-announcements-new` |
| `/admin/api-endpoints` | `app/(admin)/admin/api-endpoints/page.tsx` | 管理者 | 公開API状態確認 | endpointを確認 | 情報量を表/詳細へ分離したい | `admin-admin-api-endpoints` |
| `/admin/audit` | `app/(admin)/admin/audit/page.tsx` | 管理者 | 監査検索 | ログを絞り込む | 高密度情報にカードは不向き | `admin-admin-audit` |
| `/admin/audit/[id]` | `app/(admin)/admin/audit/[id]/page.tsx` | 管理者 | 監査詳細確認 | 関連対象を確認 | 変更差分の視線順を整理したい | `admin-admin-audit-id` |
| `/admin/audit/restore` | `app/(admin)/admin/audit/restore/page.tsx` | 管理者 | 復元実行 | 復元内容を確認 | 危険操作の段階をより明確化 | `admin-admin-audit-restore` |
| `/admin/audit/settings` | `app/(admin)/admin/audit/settings/page.tsx` | 管理者 | 監査設定 | 設定を保存 | 設定UI共通化余地 | `admin-admin-audit-settings` |
| `/admin/cost-guard` | `app/(admin)/admin/cost-guard/page.tsx` | 管理者 | mode確認 | モードを確認 | 状態と操作の距離を縮めたい | `admin-admin-cost-guard` |
| `/admin/event-groups` | `app/(admin)/admin/event-groups/page.tsx` | 管理者 | group管理 | グループを作成 | 表中心へ統一可能 | `admin-admin-event-groups` |
| `/admin/event-groups/[id]/edit` | `app/(admin)/admin/event-groups/[id]/edit/page.tsx` | 管理者 | group編集 | 変更を保存 | フォーム共通化余地 | `admin-admin-event-groups-id-edit` |
| `/admin/event-groups/new` | `app/(admin)/admin/event-groups/new/page.tsx` | 管理者 | group作成 | 作成 | フォーム共通化余地 | `admin-admin-event-groups-new` |
| `/admin/events` | `app/(admin)/admin/events/page.tsx` | 管理者 | 全イベント管理 | イベントを開く | AdminとManageの役割境界を明瞭化したい | `admin-admin-events` |
| `/admin/events/[id]` | `app/(admin)/admin/events/[id]/page.tsx` | 管理者 | event管理詳細 | 運営画面を開く | 現場運用をAdminへ重複させない整理が必要 | `admin-admin-events-id` |
| `/admin/events/[id]/edit` | `app/(admin)/admin/events/[id]/edit/page.tsx` | 管理者 | event編集 | 変更を保存 | フォーム共通化余地 | `admin-admin-events-id-edit` |
| `/admin/events/[id]/slots` | `app/(admin)/admin/events/[id]/slots/page.tsx` | 管理者 | 枠確認 | 枠を確認 | Manageとの重複導線を明示したい | `admin-admin-events-id-slots` |
| `/admin/events/[id]/staff` | `app/(admin)/admin/events/[id]/staff/page.tsx` | 管理者 | staff確認 | スタッフを確認 | Manageとの重複導線を明示したい | `admin-admin-events-id-staff` |
| `/admin/events/new` | `app/(admin)/admin/events/new/page.tsx` | 管理者 | event作成 | イベントを作成 | 長いフォームの段階整理余地 | `admin-admin-events-new` |
| `/admin/events/templates` | `app/(admin)/admin/events/templates/page.tsx` | 管理者 | template管理 | テンプレートを選択 | 補助管理の位置づけ整理 | `admin-admin-events-templates` |
| `/admin/health` | `app/(admin)/admin/health/page.tsx` | 管理者 | service診断 | 異常項目を確認 | 診断結果を異常優先へ寄せたい | `admin-admin-health` |
| `/admin/health/integrity` | `app/(admin)/admin/health/integrity/page.tsx` | 管理者 | 整合性確認 | 異常を確認 | 正常項目の視覚ノイズを下げたい | `admin-admin-health-integrity` |
| `/admin/history` | `app/(admin)/admin/history/page.tsx` | 管理者 | 履歴確認 | 履歴を絞り込む | 監査との概念差を明示したい | `admin-admin-history` |
| `/admin/import` | `app/(admin)/admin/import/page.tsx` | 管理者 | legacy import | 検証を実行 | 危険操作のpreviewを強めたい | `admin-admin-import` |
| `/admin/moderation` | `app/(admin)/admin/moderation/page.tsx` | 管理者 | case処理 | 最優先ケースを開く | 優先度順キューへ統一したい | `admin-admin-moderation` |
| `/admin/notifications` | `app/(admin)/admin/notifications/page.tsx` | 管理者 | 通知管理 | 失敗通知を確認 | 高密度queueを表へ統一したい | `admin-admin-notifications` |
| `/admin/permissions/simulator` | `app/(admin)/admin/permissions/simulator/page.tsx` | 管理者 | 権限検証 | 権限を検証 | 入力→結果の1方向フローにできる | `admin-admin-permissions-simulator` |
| `/admin/rules` | `app/(admin)/admin/rules/page.tsx` | 管理者 | 規約管理 | 規約を開く | 表中心へ統一可能 | `admin-admin-rules` |
| `/admin/rules/[id]/edit` | `app/(admin)/admin/rules/[id]/edit/page.tsx` | 管理者 | 規約編集 | 変更を保存 | フォーム共通化余地 | `admin-admin-rules-id-edit` |
| `/admin/rules/new` | `app/(admin)/admin/rules/new/page.tsx` | 管理者 | 規約作成 | 規約を作成 | フォーム共通化余地 | `admin-admin-rules-new` |
| `/admin/security` | `app/(admin)/admin/security/page.tsx` | 管理者 | security確認 | 異常を確認 | 正常情報のノイズを下げたい | `admin-admin-security` |
| `/admin/spreadsheet` | `app/(admin)/admin/spreadsheet/page.tsx` | 管理者 | DB表確認 | データを検索 | 表に対し周辺カードを減らしたい | `admin-admin-spreadsheet` |
| `/admin/static-builds` | `app/(admin)/admin/static-builds/page.tsx` | 管理者 | build job管理 | 失敗jobを確認 | 状態・再実行導線の密度改善 | `admin-admin-static-builds` |
| `/admin/users` | `app/(admin)/admin/users/page.tsx` | 管理者 | user検索管理 | ユーザーを検索 | 多情報をtable/filterへ集約したい | `admin-admin-users` |
| `/admin/users/[id]` | `app/(admin)/admin/users/[id]/page.tsx` | 管理者 | user詳細 | 管理操作を選ぶ | 情報と危険操作の分離余地 | `admin-admin-users-id` |
| `/admin/users/[id]/edit` | `app/(admin)/admin/users/[id]/edit/page.tsx` | 管理者 | user編集 | 変更を保存 | フォーム共通化余地 | `admin-admin-users-id-edit` |
| `/admin/videos` | `app/(admin)/admin/videos/page.tsx` | 管理者 | 作品検索管理 | 要対応作品を開く | 審査/検索/状態をtableへ統合したい | `admin-admin-videos` |
| `/admin/videos/[id]` | `app/(admin)/admin/videos/[id]/page.tsx` | 管理者 | 作品詳細 | 状態を確認 | 詳細と操作の優先順位整理 | `admin-admin-videos-id` |
| `/admin/videos/[id]/members` | `app/(admin)/admin/videos/[id]/members/page.tsx` | 管理者 | member確認 | メンバーを確認 | 権限表へ単純化可能 | `admin-admin-videos-id-members` |
| `/admin/workers` | `app/(admin)/admin/workers/page.tsx` | 管理者 | worker監視 | 異常Workerを確認 | 正常Workerの視覚ノイズを下げたい | `admin-admin-workers` |
| `/admin/x-id-merges` | `app/(admin)/admin/x-id-merges/page.tsx` | 管理者 | X ID統合処理 | 申請を開く | 危険度と状態をqueue表示したい | `admin-admin-x-id-merges` |
| `/admin/x-link-requests` | `app/(admin)/admin/x-link-requests/page.tsx` | 管理者 | X ID連携処理 | 申請を開く | 申請キューへ統一したい | `admin-admin-x-link-requests` |
| `/admin/youtube-quota` | `app/(admin)/admin/youtube-quota/page.tsx` | 管理者 | quota確認 | 使用状況を確認 | 数値カードより閾値中心にしたい | `admin-admin-youtube-quota` |
| `/admin/youtube-sync` | `app/(admin)/admin/youtube-sync/page.tsx` | 管理者 | sync管理 | 失敗同期を確認 | queue/table中心へ統一したい | `admin-admin-youtube-sync` |
| `/admin/youtube-sync/playlists` | `app/(admin)/admin/youtube-sync/playlists/page.tsx` | 管理者 | playlist sync管理 | 同期状態を確認 | queue/table中心へ統一したい | `admin-admin-youtube-sync-playlists` |

## System — 4 screens

| URL | page.tsx | User | Purpose | Primary action | Current issue | Mock ID |
| --- | --- | --- | --- | --- | --- | --- |
| `/dev/ui-surfaces` | `app/(public)/dev/ui-surfaces/page.tsx` | 開発者 | 既存surface確認 | surfaceを確認 | 開発用情報と次期UIを分離したい | `system-dev-ui-surfaces` |
| `/maintenance` | `app/(public)/maintenance/page.tsx` | 全ユーザー | 障害/保守状態理解 | 再確認 | 説明を最小化して次行動を明確にしたい | `system-maintenance` |
| `/onboarding` | `app/(auth)/onboarding/page.tsx` | 新規ユーザー | 初期設定完了 | 初期設定を完了 | 規約/X IDの段階を1方向にしたい | `system-onboarding` |
| `/auth/complete` | `app/(auth-complete)/auth/complete/page.tsx` | 認証中ユーザー | 認証後に戻る | 続行 | system状態として簡潔化可能 | `system-auth-complete` |

## Coverage invariant

- Public 16
- Personal 6
- Entry 3
- Manage 12
- Admin 45
- System 4
- **Total 86**

`app/(redesign)/dev/redesign/_catalog.ts` に同じ86件が存在しない場合、モック実装側の coverage defect とする。
