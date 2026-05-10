# FlameNode マイグレーション整合メモ

## 1. 目的

初期SQL `migrations/0000_chief_pet_avengers.sql` と現在の設計資料の差分を、後続マイグレーションで解消するための整理。現在の正は `PVSF-Master-Design.md` と各ページ設計であり、初期SQLに残る旧名・旧カラムは互換元として扱う。

## 2. チャプターと時間付きコメント

### 正規方針

- 正規テーブル名は `video_chapters`。
- `video_timestamps` は使わない。
- コメントは `video_comments.chapter_id` で `video_chapters.id` に紐づける。
- `video_chapters` はチャプター、時間付きコメント用マーカー、振り返り用マーカーをまとめて扱う。

### 追加・変更が必要な定義

- `video_comments.chapter_id text | null`
- `video_comments.chapter_id` は `video_chapters.id` への FK。削除時は `ON DELETE SET NULL`。
- `video_chapters.marker_kind text DEFAULT 'comment'`
- `video_chapters.show_on_player_bar integer DEFAULT 0`
- `video_chapters.order_index integer DEFAULT 0`

### 既存カラムの扱い

- 初期SQLの `video_chapters.chapter_time` は秒数としてそのまま使う。
- 初期SQLの `video_chapters.chapter_label` は表示ラベルとしてそのまま使う。
- 通常コメント由来のチャプターは `show_on_player_bar = 0`。
- 再生バー上の点表示に使う明示的なチャプターは `marker_kind = 'chapter'`, `show_on_player_bar = 1`。

## 3. イベント編集許可者

### 正規方針

- 正規テーブル名は `event_editors`。
- 初期SQLの `event_managers` は旧名。
- 互換ビューや別名テーブルは残さず、移行後は `event_editors` だけを参照する。

### 移行方針

- `event_managers.event_id`, `event_managers.x_user_id` を `event_editors` へ移行する。
- 移行後の既定値は `role = 'editor'`, `is_public = 1`。
- 公開役職、内部メモ、承認者、承認日時は後続カラムとして追加する。
- 移行後、実装・設計・CSV・旧形式エクスポートの参照名を `event_editors` に統一する。

## 4. 初期SQLに不足している主なカラム

### events

- `event_type`
- `accent_color`
- `representative_x_user_id`
- `is_archived`
- `event_group_id`
- `slot_type`
- `slot_visibility_mode`
- `max_consecutive_slots_per_entry`

### slots

- `x_user_id`
- `slot_kind`
- `slot_label`
- `sort_order`
- `reservation_group_id`
- `priority_reclaim_video_id`
- `priority_reclaim_until`

`slots.discord_user_id` は操作したDiscordアカウント、`slots.x_user_id` は実際のクリエイター名義として分離する。承認待ち X ID でも枠確保を許可し、X ID が却下された場合は受付中イベントに属する未提出枠だけを自動解放する。終了した企画、募集終了した企画、提出済み作品に紐づく枠は履歴保持のため残す。
自動解放した元枠は24時間だけ元投稿者へ優先再取得を案内する。新しい予約へ元の `reservation_group_id` は引き継がず、旧枠と新枠の関係は `history_logs` に管理者向け履歴として残す。

### videos

- 初期SQLの `small_thumbnail`, `large_thumbnail`, `tags` は新規UIでは使わない。
- 作品サムネイルは YouTube サムネイルを使う。
- 汎用タグ機能は採用しない。
- `scheduled_time` は複数枠取得時も最初の `slots.start_time` を代表時刻として保持する。
- X ID 却下後に保持する作品のため、`videos.status` に `x_reapply_required` と `voided` を追加する。
- 再申請との紐づけとして `videos.x_reapply_request_id` を追加する。
- 再申請期限と表示制御として `videos.x_reapply_started_at`, `videos.x_reapply_due_at`, `videos.x_reapply_rejected_x_user_id`, `videos.x_reapply_public_reason`, `videos.x_reapply_attempt_count`, `videos.x_reapply_locked_until` を追加する。
- 運営による作品無効化の監査補助として `videos.voided_by_user_id`, `videos.voided_at`, `videos.void_reason`, `videos.void_reason_category`, `videos.void_detail_private`, `videos.void_physical_delete_candidate_at`, `videos.void_restored_by_user_id`, `videos.void_restored_at` を追加する。
- 推薦・急上昇の補助として `videos.youtube_view_count`, `videos.trending_view_count_24h` を追加する。
- `x_reapply_required` は7日以内の対応を求め、期限切れまたは受付終了までの未対応では自動的に `voided` にする。再申請承認と枠取り直し完了後は自動的に `pending` へ戻す。
- `voided` は物理削除ではなく論理無効化であり、公開・一覧・旧形式エクスポート・スコア計算・ランキングから除外し、監査ログと管理者統計に別枠で残す。本人には通常一覧へ出さず、通知からのみ「不備」として見せる。180日経過後は物理削除候補にできる。

## 5. 追加が必要な主なテーブル

- `event_groups`
- `event_editors`
- `event_collaborator_permissions`
- `x_user_icons`
- `x_id_merge_reverts`
- `cost_usage_snapshots`
- `terms_versions`
- `user_tos_consents`
- `software_catalog`
- `software_aliases`

## 6. YouTube同期

- YouTube URL / ID 入力時に即時同期を試行する。
- 保存・提出時にも同期を試行し、成功すれば `youtube_sync_status = 'synced'` にする。
- 一時的な取得失敗またはクォータ節約時は `pending` とし、`youtube-sync` Worker の6時間ごと同期へ回す。削除済みや存在確認失敗が明確な場合は `failed` とする。
- ユーザー本人は自分の作品に限り、1作品につき1日1回まで手動同期要求できる。上限は日本時間 0:00 にリセットする。
- 管理者と担当イベントのイベント編集許可者は、通常ユーザーの1日1回制限の対象外にする。
- クォータ不足時はキュー投入だけ行い、即時同期しない。キューは翌日の日本時間 0:00 以降に自動再実行する。
- Shorts URL、通常URL、共有URLはすべて11桁の YouTube 動画 ID に正規化する。
- 非公開動画は本人に公開設定確認を促す。削除済みや存在確認失敗は `youtube_sync_status = "failed"` のままユーザー修正待ちにする。
- プレミア公開待ち、年齢制限付き動画、埋め込み不可動画は登録自体をブロックしない。
- YouTube API の1日上限クォータを90%消費したら OGP 解析へフォールバックする。
- YouTube側再生数は6時間ごとのバッチで取得し、取得失敗時は前回値を維持する。
- 埋め込み不可または年齢制限で iframe 再生できない場合は、サムネイルと「YouTubeで視聴する」導線を表示する。

## 7. 閲覧数計測

- 再生開始ごとに D1 の `videos.view_count` を直接更新しない。
- `POST /api/videos/[id]/view` は短期集約先へイベントを送るだけにする。
- Durable Object を正の短期集約先として動画ID・時間帯単位に集約し、Cron Worker が1時間ごとに D1 へバルク反映する。
- KV 時間帯バケットは主経路にしない。緊急時のフォールバックで使う場合も1再生1書き込みは禁止し、集約キーへのデバウンス書き込みに限定する。
- 未反映カウントは Durable Object 側で24時間保持する。24時間を超えて反映できない場合は管理者通知と監査ログに残す。
- 1セッションは6時間とし、ログイン状態は重複判定に使わない。自分の作品、管理者、イベント編集許可者の確認再生も除外しない。
- `economy` 以上では既定50%サンプリング、`read_only` 以上では新規計測書き込み停止。停止した閲覧数イベントは後から補完しない。
- `video_score` には FlameNode 内閲覧数だけでなく、YouTube 側再生数を正規化して含める。急上昇は直近24時間のアプリ内閲覧数で集計する。
- YouTube側再生数は `log10(youtube_view_count + 1)` を基本に対数化し、アプリ内閲覧数より低い係数で加算する。
- 再生リスト由来の閲覧はスコア計算上0.5倍にし、関連動画ロジックは `video_score` 40%、文脈近さ60%を目安にする。

## 8. 文字化け対応

- 文字化け疑い行はハイライトする。
- UTF-8 / Shift_JIS / Windows-31J の候補は補助表示に留める。
- 管理者は手動で修正できるが、必須にはしない。確認画面で一括スキップして、原文のまま取り込むこともできる。
