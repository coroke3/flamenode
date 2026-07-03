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

`events.custom_questions` の回答を、イベント ID をキーにした JSON で保存する。
複数イベントに所属する作品でも回答が混ざらないよう、イベント由来の回答は `custom_answers[event_id]` に、イベント不明・自由投稿共通の回答は `custom_answers.global` に入れる。

### スキーマ定義

```typescript
type CustomAnswerValue = string | string[] | number | boolean | null;

interface EventScopedCustomAnswers {
  [questionId: string]: CustomAnswerValue;
}

interface CustomAnswers {
  [eventIdOrGlobal: string]: EventScopedCustomAnswers;
}
```

### JSON 構造例

```json
{
  "PVSF2026Sp": {
    "software": "Blender",
    "genre": "Music Video",
    "declared_experience": "個人制作3年"
  },
  "global": {
    "collab_note": "ダンス動画とのクロスオーバー合作",
    "production_days": 30
  }
}
```

### バリデーションルール

1. **イベントスコープ**: イベント由来の回答は `custom_answers[event_id][question_id]` に保存する。
2. **global スコープ**: イベント不明、または自由投稿共通の回答は `custom_answers.global[question_id]` に保存する。
3. **キー一致**: 各スコープ内のキーは `custom_questions[].id` と完全に一致する必要がある。
4. **必須チェック**: `required: true` の質問に回答がない場合、サーバーサイドでバリデーションエラーを返す。
5. **後方互換性**: 旧形式 `{ "question_id": "answer" }` は読み取り時に `global` へ寄せ、保存時は新形式へ正規化する。
6. **型チェック**: 入力タイプに応じた型の値が保存される。

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

## 5. events.video_form_settings_json

イベントごとの動画投稿フォーム設定。標準項目のうち、イベント単位で聞く/聞かないを切り替える設定を JSON で保持する。
現在は `stage_permission` を正式項目として扱う。

### スキーマ定義

```typescript
interface StagePermissionFieldSettings {
  enabled: boolean;
  required: boolean;
  label: string;
  description?: string;
  placeholder?: string;
}

interface VideoFormSettings {
  stage_permission?: StagePermissionFieldSettings;
}
```

### JSON 構造例

```json
{
  "stage_permission": {
    "enabled": true,
    "required": false,
    "label": "ステージ・素材・権利まわりの使用許可",
    "description": "ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。",
    "placeholder": "例：自作ステージ / 利用規約確認済み / 権利者許可済み など"
  }
}
```

### 表示・保存ルール

1. スロット投稿では `slot.event_id` の `events.video_form_settings_json` を参照する。
2. 自由投稿では選択された `event_ids` のうち1つでも `stage_permission.enabled = true` なら表示する。
3. 複数イベントのうち1つでも `stage_permission.required = true` なら必須にする。
4. 非表示の場合は `videos.stage_permission` に新規値を書き込まない。
5. サーバー側でも同じ required 判定を行い、UIだけに依存しない。

---

## 6. event_staff.permission_mask

イベント運営メンバーの操作権限は `event_staff.permission_preset` / `event_staff.permission_mask` / `event_staff.custom_permission_keys_json` を正本にする。`event_staff_permissions` は移行元としてのみ扱い、新規書き込みしない。
スタッフ権限は対象イベントにスコープする。全体ロールでも作品単位ロールでもなく、対象イベントと権限キーが一致する範囲だけを操作できる。

### 設計ルール

- `event_staff` は人物・表示・内部メモ・権限割り当てを保持する。
- 複数権限は `event_staff.permission_mask` の bit として保持する。
- `custom_permission_keys_json` は `permission_preset = "custom"` の補助入力に限定し、不正 JSON は空配列扱いにする。
- `event_staff_permissions` は参照が消えるまで移行元としてだけ読み取り可能にする。
- adminOnly 権限は owner / manager preset に自動付与しない。
- 旧 `videos.*` キーは正本 `video.*` キーへの片道 alias として扱う。
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
| `collaborators.manage` | イベントスタッフ | 通常スタッフには付与しない。管理者または明示的な管理権限保持者の操作として扱う |

### レコード例

| event_staff_id | event_id | x_user_id | display_name | permission_key | allowed |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `staff_01HY...` | `PVSF2026Sp` | `coroke3` | `Mochi` | `event.slots` | 1 |
| `staff_01HY...` | `PVSF2026Sp` | `coroke3` | `Mochi` | `videos.review_data` | 1 |
| `staff_01HZ...` | `PVSF2026Sp` | `KenEizo` | `KEN` | `videos.music_credit` | 1 |

---

## 7. CSV インポート設定

CSV 入力欄ごとに列名、必須列、サジェスト対象、既定反映方法を定義する。

- **必須列**: 保存に必要な列。欠落時はプレビューでエラーにする。
- **任意列**: 空でも保存できる列。
- **サジェスト対象列**: 名前または X ID の相互提案に使う列。
- **既定反映方法**: 追記のみ。既存行と同じ X ID や同じ名前がある場合も自動更新しない。

---

## 8. events.repeat_rules

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

## 9. system_settings.default_editable_fields

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

## 10. history_logs.validation_result

動画投稿・更新時の検証エラー退避先。`videos.validation_errors` は clean schema から削除し、一時的な検証結果は作品本体に持たない。
移行時に旧 `videos.validation_errors` に値がある場合は、`history_logs` に検証ログとして退避する。

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

## 11. 使用編集ソフト

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

## 12. video_chapters

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
- `video_members.chapters_json` の担当チャプターとは混ぜない。`video_chapters` は通常の動画チャプター・コメント・レビュー用マーカーだけを扱う。

---

## 13. video_members.chapters_json

公開メンバーや共同編集者ごとの担当範囲を表すチャプター配列。独立テーブル `video_member_chapters` は廃止し、メンバー属性として `video_members.chapters_json` に保持する。

### スキーマ定義

```typescript
interface VideoMemberChapter {
  time_seconds: number;
  label: string;
  note?: string;
}

type VideoMemberChaptersJson = VideoMemberChapter[];
```

### JSON 構造例

```json
[
  {
    "time_seconds": 12.5,
    "label": "イントロ担当",
    "note": "冒頭演出"
  },
  {
    "time_seconds": 48,
    "label": "サビ背景",
    "note": ""
  }
]
```

### 設計ルール

- メンバー担当チャプターは、通常の `video_chapters` とは別物として扱う。
- `VideoMembersField` / `replaceVideoMembers` は、メンバー配列と一緒に `chapters_json` を読み書きする。
- 公開動画詳細ページのメンバー担当表示は `chapters_json` から生成する。
- 空配列または `null` は担当チャプターなしとして扱う。

---

## 14. videos.status_lifecycle

作品状態、X ID 再申請、枠取り直し、無効化の状態遷移を UI と管理画面で共通に扱うための補助構造。
状態の正本は `videos.visibility_status` と `video_moderation_cases` に分ける。

### 状態定義

```typescript
type VideoVisibilityStatus =
  | "draft"
  | "pending"
  | "public"
  | "limited"
  | "private"
  | "hidden"
  | "archived"
  | "voided";

type VideoModerationCaseType =
  | "x_reapply"
  | "void"
  | "duplicate"
  | "rights"
  | "operator";

type VideoModerationCaseStatus =
  | "open"
  | "resolved"
  | "rejected"
  | "expired"
  | "cancelled";

interface VideoModerationCase {
  id: string;
  video_id: string;
  case_type: VideoModerationCaseType;
  status: VideoModerationCaseStatus;
  public_reason?: string | null;
  private_note?: string | null;
  due_at?: number | null;
  locked_until?: number | null;
  attempt_count?: number;
  related_x_user_id?: string | null;
  created_by_user_id?: string | null;
  resolved_by_user_id?: string | null;
  created_at: number;
  resolved_at?: number | null;
}
```

### 設計ルール

- `public` は公開一覧に出す。
- `limited` は直接 URL で見られるが公開一覧には出さない。旧 `unlisted` 相当。
- `hidden` は管理上の手動非表示。旧 `is_manual_hidden` 相当。
- `archived` は論理削除・通常導線から除外。旧 `is_deleted` 相当。
- `voided` は無効化。重複、X ID 不正、投稿取り下げ、運営判断などに使う。
- X ID 再申請や無効化の理由・期限・試行回数・内部メモは `video_moderation_cases` に残す。
- YouTube ID 重複チェックは `visibility_status NOT IN ('archived', 'voided')` を対象にする。
- `voided` 作品の YouTube ID は重複判定から外し、同じ動画の再投稿は別作品として扱う。
- コメント、チャプター、いいね、ブックマークはカスケード無効化で非表示保持するが、再登録作品へは引き継がない。
- `voided` 操作は確認文字列付き二段階確認必須とし、管理者統計ではイベント別・理由カテゴリ別に通常作品と分けて件数を表示する。
- X ID 却下、枠解放、作品状態変更、通知送信、枠取り直し完了は `history_logs` に別イベントとして残す。
