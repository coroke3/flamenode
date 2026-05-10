# FlameNode JSON スキーマ仕様書

## 1. events.custom_questions

イベントごとに設定する動的質問項目の配列。

### スキーマ定義

```typescript
type QuestionType = "text" | "textarea" | "select" | "multi-select" | "number" | "date";

interface CustomQuestion {
  /** 質問の一意なID（custom_answersのキーとして使用） */
  id: string;
  
  /** 質問ラベル（UI表示用） */
  label: string;
  
  /** 入力タイプ */
  type: QuestionType;
  
  /** 必須項目かどうか */
  required: boolean;
  
  /** プレースホルダーテキスト（text/textareaのみ） */
  placeholder?: string;
  
  /** オプション一覧（select/multi-selectのみ） */
  options?: string[];
  
  /** 最小値（numberのみ） */
  min?: number;
  
  /** 最大値（numberのみ） */
  max?: number;
  
  /** 最大文字数（text/textareaのみ） */
  max_length?: number;
  
  /** 表示順序（小さいほど上に表示） */
  order: number;
  
  /** ヘルプテキスト */
  help_text?: string;
}
```

### JSON 構造例

```json
[
  {
    "id": "software",
    "label": "使用ソフト",
    "type": "text",
    "required": true,
    "placeholder": "例: Blender, After Effects",
    "order": 1
  },
  {
    "id": "genre",
    "label": "ジャンル",
    "type": "select",
    "required": true,
    "options": ["Music Video", "Dance", "Animation", "Short Film", "その他"],
    "order": 2
  },
  {
    "id": "collab_note",
    "label": "合作について",
    "type": "textarea",
    "required": false,
    "placeholder": "合作の意図や分工の内容を記載",
    "max_length": 1000,
    "order": 3
  },
  {
    "id": "production_days",
    "label": "制作日数",
    "type": "number",
    "required": false,
    "min": 1,
    "max": 365,
    "order": 4
  }
]
```

---

## 2. videos.custom_answers

`events.custom_questions` の回答をキーバリューペアで保存。

### スキーマ定義

```typescript
interface CustomAnswers {
  /**
   * キーは custom_questions[].id と完全に一致する。
   * 値は質問タイプに応じて型が異なる：
   * - text/textarea: string
   * - select: string
   * - multi-select: string[]
   * - number: number | string
   * - date: string (ISO 8601)
   */
  [questionId: string]: string | string[] | number;
}
```

### JSON 構造例

```json
{
  "software": "Blender",
  "genre": "Music Video",
  "collab_note": "ダンス動画とのクロスオーバー合作",
  "production_days": 30
}
```

### バリデーションルール

1. **キー一致**: `custom_answers` のキーは `custom_questions[].id` と完全に一致する必要がある
2. **必須チェック**: `required: true` の質問に回答がない場合、サーバーサイドでバリデーションエラーを返す
3. **後方互換性**: 質問構造はイベント作成時に変更可能。既存の回答は破棄されない
4. **型チェック**: 入力タイプに応じた型の値が保存される

---

## 3. events.review_settings

イベントごとのレビュー設定。

### スキーマ定義

```typescript
interface ReviewSettings {
  /** 自動公開を有効にするか */
  auto_public: boolean;
  
  /** 必須チェック項目のリスト */
  required_checks: string[];
  
  /** 審査モード（'auto' | 'manual' | 'hybrid'） */
  review_mode: "auto" | "manual" | "hybrid";
  
  /** YouTube 実在確認を必須にするか */
  require_youtube_verification: boolean;
  
  /** 審査完了後の通知メッセージ */
  notification_message?: string;
}
```

### JSON 構造例

```json
{
  "auto_public": true,
  "required_checks": ["discord_auth", "creator_approved", "tos_accepted", "no_ban"],
  "review_mode": "hybrid",
  "require_youtube_verification": true,
  "notification_message": "作品が承認されました"
}
```

---

## 4. events.editable_fields

投稿後にユーザーが編集可能なフィールドのリスト。

### スキーマ定義

```typescript
type EditableField = 
  | "title"
  | "closing_comment"
  | "custom_answers"
  | "highlights"
  | "production_story"
  | "used_software"
  | "music"
  | "credit";

interface EditableFieldsConfig {
  /** 編集可能なフィールドのリスト */
  fields: EditableField[];
  
  /** 編集可能になるタイミング（'immediately' | 'after_approval' | 'after_publication'） */
  unlock_condition: "immediately" | "after_approval" | "after_publication";
  
  /** 編集回数制限（null で無制限） */
  max_edits: number | null;
}
```

### JSON 構造例

```json
{
  "fields": ["title", "closing_comment", "used_software", "custom_answers"],
  "unlock_condition": "after_publication",
  "max_edits": 5
}
```

---

## 5. event_collaborator_permissions.permission_key

イベントごとの協力者に付与する編集権限キー。協力者は全体ロールでも作品単位ロールでもなく、対象イベントの中で許可された権限キーだけを操作できる。

### 設計ルール

- `event_collaborator_permissions` は1権限1行で保持する。
- 同じ協力者へ複数権限を付与する場合は、同じ `event_id` と同じユーザーに対して `permission_key` の異なる行を複数作成する。
- 本人承認は不要。管理者または当該イベントのイベント編集許可者が追加した時点で有効にする。
- イベント側の `events.editable_fields` で禁止された作品項目は、協力者側に対応する `permission_key` があっても編集不可にする。
- `videos.youtube_id`、`videos.primary_event` のような高リスク操作は、通常フィールドとは別の権限キーとして明示する。
- `collaborators.manage` はイベント協力者には付与しない。協力者の追加・削除・権限変更はイベント編集許可者以上に限定する。

### 権限キー一覧

| permission_key | 対象 | 許可される操作 |
| :--- | :--- | :--- |
| `event.basic` | イベント基本情報 | タイトル、説明、画像、開催期間、受付状態の編集 |
| `event.slots` | イベント枠 | スロット作成、編集、公開、確保状況の調整 |
| `event.members` | 運営メンバー | 公開/非公開運営メンバー、役職ラベル、代表者候補の編集 |
| `event.questions` | 入力項目 | `custom_questions`, `review_settings`, `editable_fields` の編集 |
| `videos.title` | イベント内作品 | 作品タイトル、表示名、読み方の編集 |
| `videos.music_credit` | イベント内作品 | 楽曲名、クレジット、楽曲URLの編集 |
| `videos.members` | イベント内作品 | 合作メンバー、役職、コメント、並び順の編集 |
| `videos.review_data` | イベント内作品 | 振り返り上映用データ、制作コメント、使用ソフト、カスタム回答の編集 |
| `videos.youtube_id` | イベント内作品 | YouTube URL / ID の登録・差し替え |
| `videos.primary_event` | イベント内作品 | `primary_event_id` の変更 |
| `collaborators.manage` | イベント協力者 | イベント協力者には付与しない。イベント編集許可者以上の管理操作として扱う |

### レコード例

| event_id | x_user_id | display_name | permission_key | allowed |
| :--- | :--- | :--- | :--- | :---: |
| `PVSF2026Sp` | `coroke3` | `Mochi` | `event.slots` | 1 |
| `PVSF2026Sp` | `coroke3` | `Mochi` | `videos.review_data` | 1 |
| `PVSF2026Sp` | `KenEizo` | `KEN` | `videos.music_credit` | 1 |

---

## 6. CSV インポート設定

CSV 入力欄ごとに列名、必須列、サジェスト対象、既定反映方法を定義する。

- **必須列**: 保存に必要な列。欠落時はプレビューでエラーにする。
- **任意列**: 空でも保存できる列。
- **サジェスト対象列**: 名前または X ID の相互提案に使う列。
- **既定反映方法**: 追記のみ。既存行と同じ X ID や同じ名前がある場合も自動更新しない。

---

## 7. events.repeat_rules

スロットのリピート生成ルール。

### スキーマ定義

```typescript
interface RepeatRule {
  /** ルールの一意なID */
  id: string;
  
  /** ルール名 */
  name: string;
  
  /** 開始日 */
  start_date: string;
  
  /** 終了日（null で無期限） */
  end_date: string | null;
  
  /** 間隔（日数） */
  interval_days: number;
  
  /** 曜日リスト（0=日曜日, 6=土曜日） */
  weekdays: number[];
  
  /** 開始時間（HH:mm） */
  start_time: string;
  
  /** 終了時間（HH:mm） */
  end_time: string;
  
  /** 生成されるスロットの数 */
  max_slots: number;
}

interface RepeatRulesConfig {
  /** ルールのリスト */
  rules: RepeatRule[];
  
  /** リピート生成を有効にするか */
  enabled: boolean;
}
```

### JSON 構造例

```json
{
  "rules": [
    {
      "id": "weekly-mon",
      "name": "毎週月曜日",
      "start_date": "2026-05-01",
      "end_date": "2026-12-31",
      "interval_days": 7,
      "weekdays": [1],
      "start_time": "20:00",
      "end_time": "22:00",
      "max_slots": 24
    }
  ],
  "enabled": true
}
```

---

## 8. system_settings.default_editable_fields

システム全体のデフォルト編集可能フィールド設定。

### JSON 構造例

```json
{
  "fields": ["title", "closing_comment", "used_software"],
  "unlock_condition": "after_publication",
  "max_edits": null
}
```

---

## 9. videos.validation_errors

動画のバリデーションエラーリスト。

### JSON 構造例

```json
{
  "errors": [
    {
      "field": "title",
      "message": "タイトルは必須です",
      "code": "required"
    },
    {
      "field": "genre",
      "message": "ジャンルを選択してください",
      "code": "required"
    }
  ],
  "last_validated_at": 1746048000
}
```

---

## 10. 使用編集ソフト

汎用分類ラベルは採用しない。使用編集ソフトのみ、表記ゆれ対策のため辞書と別名を持つチップ型入力として扱う。

### JSON 構造例

```json
{
  "used_software": ["Blender", "After Effects"],
  "software_candidates": [
    {
      "input": "AE",
      "software_id": "after-effects",
      "name": "After Effects",
      "confidence": 0.96
    }
  ]
}
```

### software_catalog

```json
{
  "id": "after-effects",
  "name": "After Effects",
  "normalized_name": "after effects",
  "category": "composite"
}
```

### software_aliases

```json
{
  "software_id": "after-effects",
  "alias": "AE",
  "normalized_alias": "ae"
}
```

---

## 11. video_chapters

動画詳細ページの時間付き反応、チャプター点、振り返り用マーカーを扱う。独自プレイヤーの再生バーに点表示する情報も、このデータを正とする。

### フィールド方針

- `chapter_time`: 動画先頭からの秒数。YouTube の再生位置と同期する。
- `chapter_label`: 一覧、吹き出し、チャプター点の見出し。
- `note`: 補足メモ。コメント本文そのものは `video_comments` 側に保持する。
- `visibility`: `public` または `private`。非公開は本人と管理者のみ閲覧できる。
- `marker_kind`: `comment`, `chapter`, `review`, `system` のいずれか。再生バー上のチャプター点は `chapter` を優先表示する。
- `show_on_player_bar`: 再生バー上に点表示するか。通常コメント由来の既定は `0`、チャプター指定時の既定は `1` とし、`1` の場合は独自プレイヤーのシークバーに小さなマーカーとして表示する。
- `order_index`: 同一秒数に複数マーカーがある場合の並び順。

### JSON 構造例

```json
{
  "id": "chapter_01HY...",
  "video_id": "video_01HY...",
  "x_user_id": "x_user_01HY...",
  "chapter_time": 83.5,
  "chapter_label": "サビ入り",
  "note": "ここから演出が切り替わる",
  "visibility": "public",
  "marker_kind": "chapter",
  "show_on_player_bar": 1,
  "order_index": 0,
  "created_at": 1746048000,
  "updated_at": 1746048000
}
```

### プレイヤー表示

- `show_on_player_bar = 1` の公開マーカーは、他ユーザーにも再生バー上の点として表示する。
- 自分の非公開マーカーは本人の再生バーにのみ控えめな点として表示してよい。
- 点のホバー、タップ長押し、キーボードフォーカスでは、時刻、ラベル、種別を表示する。
- フレーム画像プレビューは必須にしない。Cloudflare/R2 にプレビュー画像を保存せず、必要な場合でも YouTube 由来で低コストに取得できる範囲に留める。

---

## 12. videos.status_lifecycle

作品状態、X ID 再申請、枠取り直し、無効化の状態遷移を UI と管理画面で共通に扱うための補助構造。

### 状態定義

```typescript
type VideoStatus =
  | "draft"
  | "pending"
  | "x_reapply_required"
  | "public"
  | "unlisted"
  | "private"
  | "voided";

interface XReapplyState {
  status: "not_required" | "required" | "reapplied" | "approved" | "expired";
  rejected_x_user_id?: string;
  reapply_request_id?: string;
  display_name: string;
  public_reason?: string;
  started_at?: number;
  due_at?: number;
  slot_reclaim_priority_until?: number;
  attempt_count?: number;
  locked_until?: number;
  reminder_3days_sent_at?: number;
  reminder_24h_sent_at?: number;
  admin_extended_until?: number;
}

interface VoidedState {
  is_voided: boolean;
  display_label: "不備";
  reason_category?: "x_id_invalid" | "duplicate" | "withdrawn_by_creator" | "operator_decision" | "expired";
  private_detail?: string;
  voided_by_user_id?: string;
  voided_at?: number;
  physical_delete_candidate_at?: number;
  restored_by_user_id?: string;
  restored_at?: number;
  two_step_confirmed: boolean;
  confirm_input?: string;
}
```

### 設計ルール

- `x_reapply_required` は7日以内に対応する。期限切れ、または受付終了までに枠取り直しが完了しない場合は `voided` にする。
- 期限切れの3日前と24時間前にリマインドし、最終確認通知は送らない。管理者は最大 +7日、合計14日まで個別延長できる。
- 再申請が連続3回却下された場合は一時ロックし、管理者への問い合わせを促す。
- 再申請中の主表示は X ID 文字列ではなく名義にする。
- 再申請承認と枠取り直しが完了したら、自動的に `pending` へ戻す。
- `voided` は物理削除ではなく論理無効化であり、公開・一覧・旧形式エクスポート・スコア計算・ランキングから除外する。
- `voided` は本人の通常ダッシュボード一覧から除外し、通知からのみ「不備」として確認させる。
- `voided` 作品の YouTube ID は重複判定から外し、同じ動画の再投稿は別作品として扱う。
- コメント、チャプター、いいね、ブックマークはカスケード無効化で非表示保持するが、再登録作品へは引き継がない。
- `voided` 操作は確認文字列付き二段階確認必須とし、管理者統計ではイベント別・理由カテゴリ別に通常作品と分けて件数を表示する。
- `voided` 復旧は管理者専用。180日経過後は物理削除候補にできる。
- X ID 却下、枠解放、作品状態変更、通知送信、枠取り直し完了は `history_logs` に別イベントとして残す。
