# FlameNode 作品DB整理メモ

最終更新: 2026-05-23

本番運用前の clean schema として、作品本体 `videos` に混在していた投稿者情報、公開状態、YouTube 同期、統計、旧互換、審査・無効化情報を責務ごとに整理する。
実装正本は `src/lib/db/schema.ts`、移行正本は `migrations/0018_simplify_video_schema.sql`、`0019_clean_staff_software_and_disabled_features.sql`、`0020_split_video_core_metadata_stats.sql`、`0024_legacy_import_db_reduction_prep.sql`。

## videos の責務

`videos` は作品本体と公開・予定に必要な最小情報だけを持つ。

| 区分 | カラム |
|---|---|
| identity | `id`, `primary_event_id` |
| 投稿者 | `creator_x_user_id`, `submitted_by_discord_user_id`, `creator_display_name`, `creator_display_name_yomi`, `creator_icon_url` |
| 作品分類 | `collaboration_type`, `source_type` |
| 作品本文 | `title`, `youtube_video_id`, `music`, `music_reference_url`, `credit`, `intro_comment`, `closing_comment`, `highlights`, `production_story`, `used_software_json`, `stage_permission`, `custom_answers` |
| 公開・予定 | `visibility_status`, `scheduling_type`, `scheduled_time` |
| 表示用統計 | `app_like_count`, `score`, `trending_view_count_24h`, `score_updated_at` |
| timestamps | `created_at`, `updated_at` |

`submitted_by_discord_user_id` は投稿操作を行った Discord ユーザーの記録であり、単独では編集権限を与えない。
編集権限の正本は承認済み `creator_x_user_id`、イベント権限、`video_members.can_edit` による共同編集者権限。

## 削除・rename した videos カラム

| 旧カラム | 新しい扱い |
|---|---|
| `creator_id` | `creator_x_user_id` |
| `owner_discord_user_id` | `submitted_by_discord_user_id` |
| `contact_x_id` | 廃止。提出主体 X ID は `creator_x_user_id` |
| `submission_type` | `collaboration_type` と `source_type` に分解 |
| `display_name`, `display_name_yomi`, `icon_url` | `creator_display_name`, `creator_display_name_yomi`, `creator_icon_url` |
| `outro_comment` | `closing_comment` に統一 |
| `declared_experience` | `custom_answers[event_id].declared_experience` または `custom_answers.global.declared_experience` |
| `status`, `is_manual_hidden`, `is_deleted` | `visibility_status` |
| `x_reapply_*`, `void_*` | `video_moderation_cases` |
| `validation_errors` | `history_logs` へ退避 |
| YouTube 同期系 | `video_youtube_metadata` |
| 統計・スコア系 | 新規表示クエリは `videos.app_like_count`, `videos.score`, `videos.trending_view_count_24h`, `videos.score_updated_at` を優先。`video_stats` は worker / 旧DB fallback 用に当面残す |

## collaboration_type / source_type

`submission_type` は制作形態とソース種別が混ざっていたため分解する。

| カラム | 値 |
|---|---|
| `collaboration_type` | `individual`, `collab` |
| `source_type` | `youtube`, `manual`, `external` |

既存フォームの `is_collab` は `collaboration_type` に反映する。
YouTube URL 投稿は `source_type = "youtube"` として保存する。

## visibility_status

| 値 | 意味 |
|---|---|
| `draft` | 下書き |
| `pending` | 承認・公開待ち |
| `public` | 公開一覧に出す |
| `limited` | 直接 URL のみ許可。旧 `unlisted` 相当 |
| `private` | 非公開 |
| `hidden` | 管理上の手動非表示 |
| `archived` | 論理削除・通常導線から除外 |
| `voided` | 無効化 |

公開一覧は `visibility_status = 'public'` のみ。
直接 URL は `public` と `limited` を許可する。
YouTube ID 重複チェックは `visibility_status NOT IN ('archived', 'voided')` を対象にする。

## video_moderation_cases

X ID 再申請、無効化、重複、権利、運営判断などのケース情報を `videos` から分離する。

主な列:

- `case_type`: `x_reapply`, `void`, `duplicate`, `rights`, `operator`
- `status`: `open`, `resolved`, `rejected`, `expired`, `cancelled`
- `public_reason`, `private_note`
- `due_at`, `locked_until`, `attempt_count`
- `related_x_user_id`, `created_by_user_id`, `resolved_by_user_id`

公開・一覧の判定は `visibility_status` で行い、理由や内部メモは `video_moderation_cases` を参照する。

## video_youtube_metadata / video_stats

YouTube 同期結果は `video_youtube_metadata` に分離する。一覧表示用の統計は 0024 以降 `videos.*` を優先するが、score-recalc worker と旧DB fallback のため `video_stats` も当面残す。

`video_youtube_metadata`:

- `video_id`
- `youtube_video_id`
- `youtube_privacy_status`
- `youtube_availability_status`
- `duration_seconds`
- `view_count`
- `synced_at`
- `sync_status`
- `sync_error`
- `updated_at`

`video_stats` (当面の dual-write / fallback):

- `video_id`
- `app_view_count`
- `app_like_count`
- `trending_view_count_24h`
- `score`
- `updated_at`

公開ページ表示時に YouTube API は叩かない。
閲覧数は1再生ごとに D1 へ直接 UPDATE せず、初期本番では低頻度集計・キャッシュ前提にする。
新規表示クエリは `videos.score` を優先し、`video_stats` を即 DROP しない。

## video_members

`video_members` は案Aとして、公開メンバー表示と共同編集者情報を同居させる。

責務:

- 公開メンバー表示
- 非公開共同編集者
- メンバーごとの担当チャプター
- 合作メンバー編集権限

残す権限列:

- `discord_user_id`
- `can_edit`
- `is_public_member`
- `edit_granted_by_user_id`
- `edit_granted_at`
- `edit_updated_at`

`name_for_sort` は廃止し、必要な場合はアプリ側ソートまたは `lower(name)` を使う。
`video_member_chapters` は廃止し、担当チャプターは `video_members.chapters_json` に保存する。

## primary_event_id と video_events

`primary_event_id` は主イベント、`video_events` は追加所属イベントを含む多対多として維持する。

ルール:

- `primary_event_id` がある場合、その `event_id` は必ず `video_events` にも存在する。
- スロット投稿では `slot.event_id` を `primary_event_id` とし、`video_events` にも必ず入れる。
- 更新処理では `primary_event_id` を always include として外れないようにする。
- `/admin/health` で `primary_event_sync` を検出する。

## stage_permission

`videos.stage_permission` は標準入力項目として残す。
表示・必須設定は `events.video_form_settings_json.stage_permission` を参照する。

スロット投稿では `slot.event_id` の設定、自由投稿では選択イベントの設定を集約する。
複数イベントのうち1つでも `enabled = true` なら表示し、1つでも `required = true` なら必須にする。
サーバー側でも同じ判定を行う。

## custom_answers

`custom_answers` はイベント ID キー構造に統一する。

```json
{
  "PVSF2026Sp": {
    "declared_experience": "個人制作3年",
    "favorite_scene": "サビ前"
  },
  "global": {
    "note": "自由投稿共通メモ"
  }
}
```

旧形式は読み取り時に互換対応し、保存時は新形式へ正規化する。

## software

ソフトウェア名の表示正本は `videos.used_software_json`。
`software_catalog` / `software_aliases` / `video_softwares` は旧整理過程の補助テーブルとして当面残る可能性があるが、新規表示クエリでは `used_software_json` を優先する。
