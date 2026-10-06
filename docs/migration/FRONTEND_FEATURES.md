# FlameNode Frontend-Exposed Feature Inventory

> Status: Active / Frontend capability source of truth
> Last updated: 2026-10-06
> Scope: CURRENTでユーザーが画面・操作・状態変化として認識できる機能
> Screen source: `docs/design-redesign/ROUTE_INVENTORY.md`
> Detailed backend contracts: `FUNCTION_INVENTORY.md` + `functions/*.md`

この文書は、リデザインとframework移行で「画面はあるが機能が消えた」を防ぐための**フロントエンド露出機能の正本**。

画面URLの正本は `docs/design-redesign/ROUTE_INVENTORY.md`、backendのinput/auth/effect/test詳細はdomain ledgerを正本とし、この文書へ重複させない。

## Completion invariant

移行完了時、以下をすべて満たす。

```text
Frontend capabilities without screen mapping = 0
Frontend capabilities without UX-state mapping = 0
Frontend capabilities without permission mapping = 0
Frontend capabilities without backend disposition = 0
Screens with visual-only completion = 0
Intentional removals without approval = 0
```

**見た目の再現より、使い心地・機能・権限・状態遷移の維持を優先する。**

コード行数削減は目標にしない。共通化や簡潔化は、機能とUXを維持・改善した結果としてのみ評価する。

---

# 1. What counts as a frontend-exposed feature

以下はすべて「フロント機能」として扱う。

- 画面に表示される情報
- ボタン、リンク、検索、filter、sort、tab、pagination
- 作成、編集、削除、承認、再試行などの操作
- ログイン、ログアウト、権限不足、ban、session復元
- loading / empty / error / forbidden / degraded state
- toast、validation、確認dialog、危険操作の二段階確認
- URL、deep link、reload、back/forward、query parameter
- mobile/tablet/desktopでの操作可能性
- 外部連携の進捗・失敗・quota表示
- 非同期処理のpending/success/failure/retry表示
- 公開/非公開の見え方
- SEO/canonical/OGPのように外部ユーザーが観測する挙動

「backendにしか存在しない」と判断する前に、ユーザーが状態・制限・遅延・エラーとして観測できないか確認する。

---

# 2. Required UX contract per capability

各機能を`FRONTEND_VERIFIED`相当に扱うには、最低限以下を確認する。

```text
Capability ID
Users/Roles
Current screen(s)
Entry point / primary action
Inputs
Success result
Loading state
Empty state
Validation state
Error state
Forbidden/permission state
Pending/async state
Destructive confirmation (if any)
Responsive/mobile behavior
Keyboard/focus behavior where relevant
Deep-link/reload/history behavior
Current backend dependency
Backend side effects visible to user
Current tests/evidence
Target screen/component
Parity acceptance
```

詳細なDB/Queue/R2/Audit契約はdomain ledgerへ記録する。

---

# 3. Public / discovery / playback — 22 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見する | `/` | 棚の意味・順序・作品への到達性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-002 | 作品詳細をURLから開く | `/[id]` | internal ID / YouTube ID双方のdeep linkを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-003 | YouTube作品を再生する | `/[id]` | player、再生導線、失敗時fallbackを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-004 | 作品metadata・説明・credit・musicを見る | `/[id]` | 情報欠落禁止、優先順位のみ再設計可 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-005 | chapterを見る・移動する | `/[id]` | public/private境界と時間移動UXを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-006 | viewが計測される | `/[id]` | ユーザー操作を阻害せず重複計測契約を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-007 | like等の作品interactionを行う | `/[id]` | login前後・pending・retry・idempotency UXを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-008 | viewer utility/private overlayを利用する | `/[id]` | 認可された情報だけ表示、private leak禁止 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-009 | 公開イベント一覧を探す | `/event` | 公開状態・探索導線を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-010 | イベント詳細と作品を見る | `/event/[id]` | stage/visibilityによる表示差を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-011 | 公開順で作品を連続閲覧する | `/event/[id]/release` | release順、前後移動、再生中心UXを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-012 | 公開枠状況を見る | `/event/[id]/slots` | 空き/使用/状態の判別性、mobile探索性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-013 | イベントグループ一覧・詳細を見る | `/groups*` | group→event探索関係を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-014 | 作品一覧をfilter/searchする | `/list` | query/filter/sort/pagination意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-015 | recommend作品を見る | `/recommend` | recommendationの意味と作品到達性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-016 | trending作品を見る | `/trending` | 順位/集計契約と表示意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-017 | creator一覧から作者を探す | `/user` | searchable/listable対象を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-018 | creator profileと作品を見る | `/user/[id]` | profile visibility・作品一覧を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-019 | creator portfolioを連続閲覧する | `/user/[id]/portfolio` | 作品順と作品中心navigationを維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-020 | Aboutを見る | `/about` | 内容到達性と主要導線を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-021 | 現行ルールを閲覧する | `/rules` | active versionと長文探索性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-022 | 検索・SNS共有向けmetadataが正しく出る | public pages | canonical/OGP/SEO URL互換を維持 | DETAIL_AUDIT_REQUIRED |

---

# 4. Authentication / account — 9 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-AUTH-001 | Discordでログインする | auth/login | redirect・失敗・再試行の安全性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-002 | 再訪時にsessionが復元される | site-wide | 不要な再ログインを発生させない | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-003 | Discord accountが安全にlinkされる | auth/settings | duplicate/link失敗時に誤紐付けしない | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-004 | role/ban状態がUIと操作可否へ反映される | authenticated UI | UI表示とserver認可を一致させる | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-005 | onboardingを完了する | `/onboarding` | 必須step・戻り方・再開性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-006 | termsへ同意する | onboarding/terms | versionと同意状態の意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-007 | 認証完了後に安全に元の導線へ戻る | `/auth/complete` | open redirect禁止・期待URLへ戻る | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-008 | logoutする | account UI | cookie/sessionが確実に無効化される | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-009 | 自分のaccount情報を見る | account UI/API | private dataのみ本人へ表示 | DETAIL_AUDIT_REQUIRED |

---

# 5. Personal dashboard / owned videos — 7 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-PER-001 | dashboardで次に必要な作業と作品状態を見る | `/dashboard` | 行動優先順位と状態把握を維持/改善 | DETAIL_AUDIT_REQUIRED |
| FN-PER-002 | 自分/共同編集可能な作品を編集する | `/dashboard/edit/[id]` | 保存、validation、権限、失敗復旧を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PER-003 | 作品の共同編集権限を管理する | permissions page | owner/共同編集者の意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PER-004 | libraryを閲覧する | `/dashboard/library` | authenticated一覧と作品導線を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PER-005 | user settingsを編集する | `/dashboard/settings` | 保存状態・validation・再読込反映を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PER-006 | personal YouTube playlist状態を見る | `/dashboard/youtube-playlists` | external/quota/失敗状態を理解できる | DETAIL_AUDIT_REQUIRED |
| FN-PER-007 | X IDを登録・変更・申請する | settings | 承認状態・競合・失敗・再申請UXを維持 | DETAIL_AUDIT_REQUIRED |

---

# 6. Entry / submission / slot — 6 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-ENT-001 | entry入口で参加/投稿方法を判断する | `/entry` | auth/event/slot状態に応じた正しい分岐を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ENT-002 | slotを確保し状態を見る | entry/slot UI | capacity/duplicate/競合時の説明を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ENT-003 | slotへ作品を提出する | `/entry/slotted` | deadline/slot ownership/完了状態を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ENT-004 | 枠なし通常作品を投稿する | `/entry/unslotted` | duplicate/input/visibility defaultを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ENT-005 | YouTube URLからmetadataを素早く入力する | entry/video forms | 重複検知・quota・取得失敗時fallbackを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ENT-006 | event custom questionへ回答する | entry/event forms | schema/required/validation/再編集を維持 | DETAIL_AUDIT_REQUIRED |

---

# 7. Manage — 12 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-MNG-001 | 担当イベントと要対応を把握する | `/manage` | staff scopeと優先度を維持/改善 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-002 | event workspaceでイベントを運営する | `/manage/events/[id]` | tab間のcontext保持と権限表示を維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-003 | audience情報を見る | `.../audience` | privacyと対象範囲を維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-004 | event settingsを編集する | `.../edit` | stage/permission/validationを維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-005 | review queueで審査する | `.../review` | 連続処理・status transitionを維持/改善 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-006 | slotを運用する | `.../slots` | slot状態・通知・競合処理を維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-007 | staffと権限を管理する | `.../staff` | owner最低1人、role差、危険操作を明示 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-008 | event作品一覧を管理する | `.../videos` | filter/状態/要対応探索を維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-009 | event作品1件を処理する | `.../videos/[videoId]` | edit/status/audit結果を明確に維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-010 | event YouTube playlist同期を管理する | `.../youtube-playlist` | sync/quota/error/retryを理解できる | DETAIL_AUDIT_REQUIRED |
| FN-MNG-011 | 通知失敗と再試行状態を管理する | `/manage/notifications` | event scope・retry結果・重複防止を維持 | DETAIL_AUDIT_REQUIRED |
| FN-MNG-012 | X link requestを処理する | `/manage/x-link-requests` | delegated permissionと判断履歴を維持 | DETAIL_AUDIT_REQUIRED |

---

# 8. Admin — 31 capabilities

| ID | User-visible capability | Main surfaces | UX preservation priority | Audit state |
| --- | --- | --- | --- | --- |
| FN-ADM-001 | 管理者dashboardで対応待ちを見る | `/admin` | 優先度と状態把握を維持/改善 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-002 | announcementsを作成・編集・公開する | `/admin/announcements*` | publish state/preview/auditを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-003 | API endpoint設定/状態を管理する | `/admin/api-endpoints` | security boundaryと有効状態を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-004 | auditを検索し詳細を見る | `/admin/audit*` | 高密度検索・差分・関連対象導線を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-005 | auditから復元する | `/admin/audit/restore` | 危険操作の確認・結果・auditを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-006 | audit設定を変更する | `/admin/audit/settings` | 設定影響・保存結果を明示 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-007 | cost guard modeを確認・変更する | `/admin/cost-guard` | 現在mode・CAS競合・反映状態を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-008 | event groupをCRUDする | `/admin/event-groups*` | slug/relation/validation/auditを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-009 | eventをCRUD・管理する | `/admin/events*` | owner/stage/audit/危険操作を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-010 | event templateを管理する | `/admin/events/templates` | template integrityと適用結果を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-011 | event staffを管理する | admin/manage staff | owner invariantとpermission差を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-012 | dangerous event operationを実行する | event admin danger | 明示確認・audit・rollback可能性を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-013 | health dashboardを見る | `/admin/health` | read-only診断と状態意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-014 | integrity checkを実行/確認する | `/admin/health/integrity` | default read-only、問題箇所を特定可能 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-015 | historyを見る | `/admin/history` | auditとの意味差と時系列を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-016 | legacy data importをpreview/実行する | `/admin/import` | preview・専用境界・失敗復旧を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-017 | moderation caseを処理する | `/admin/moderation` | state transition・判断履歴を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-018 | notificationを管理・再試行する | `/admin/notifications` | retry/idempotency/結果表示を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-019 | permission simulatorを使う | `/admin/permissions/simulator` | 実permission coreと結果一致 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-020 | rules/termsをCRUDする | `/admin/rules*` | versioningと既存同意への影響を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-021 | security diagnosticsを見る | `/admin/security` | secret/private dataを漏らさず診断可能 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-022 | spreadsheet/DB browserを使う | `/admin/spreadsheet` | read/write境界・確認・監査を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-023 | static build/rebuildを監視・再実行する | `/admin/static-builds` | queue/job state・idempotency・結果表示を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-024 | usersを検索・詳細表示・編集する | `/admin/users*` | auth state・ban/role等の影響を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-025 | videosを検索・詳細表示・管理する | `/admin/videos*` | status/permission/audit/visibilityを維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-026 | video membersを管理する | `/admin/videos/[id]/members` | membership/permissionの意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-027 | Workers状態を監視する | `/admin/workers` | job/worker healthと失敗把握を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-028 | X ID mergeを実行する | `/admin/x-id-merges` | destructive mergeのpreview/audit/確認を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-029 | X link requestを処理する | `/admin/x-link-requests` | approval/audit/状態遷移を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-030 | YouTube quotaを確認する | `/admin/youtube-quota` | counter/threshold/reset意味を維持 | DETAIL_AUDIT_REQUIRED |
| FN-ADM-031 | YouTube syncを管理・再試行する | `/admin/youtube-sync*` | retry/quota/idempotency/進捗表示を維持 | DETAIL_AUDIT_REQUIRED |

---

# 9. Frontend capability count

初期frontend-exposed capability数:

```text
Public                 22
Authentication/account  9
Personal                7
Entry                   6
Manage                 12
Admin                  31
-------------------------
Total                  87
```

86 screensと87 capabilitiesは1:1ではない。1機能が複数画面へ跨る場合、1画面が複数機能を持つ場合がある。

MIG-0010で**全86 screen → required capability IDs**を完全mappingする。

---

# 10. Redesign preservation rules

リデザインで変更してよい:

- information hierarchy
- layout
- visual density
- component composition
- navigation placement
- mobile-specific arrangement
- progressive disclosure
- wording（意味を変えない範囲）

明示承認なしに変更してはいけない:

- capabilityの存在
- permission/role semantics
- destructive operationの意味
- validation/business rule
- public/private visibility
- URL/canonical compatibility
- asynchronous side-effect semantics
- retry/idempotency behavior
- auditability
- external integration outcome

UXを改善するためにworkflow自体を変更する必要がある場合は、`BACKEND_OPTIMIZATION.md`にUX impactを記録し、別判断とする。

---

# 11. Audit progression

この文書の87 capabilitiesは**存在とユーザー価値の初期baseline**。

詳細確認は以下で進める。

- `MIG-0002`: screens/routes + frontend capability baseline
- `MIG-0003`: Server Actions / inline actions
- `MIG-0004`: Route Handlers/API
- `MIG-0007`: static/visibility
- `MIG-0008`: auth/permission
- `MIG-0009`: background jobs
- `MIG-0010`: 86 screens ↔ capability IDs complete mapping
- `MIG-0011`: gap scan + backend optimization/blocker assessment

**MIG-0011完了までは「全機能棚卸し完了」と宣言しない。**
