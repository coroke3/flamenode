# FlameNode Frontend-Exposed Feature Inventory

> Status: Active / Frontend capability source of truth
> Last updated: 2026-10-07
> Scope: CURRENTでユーザー/運営者/管理者/開発者が画面・操作・状態変化として認識できる機能
> Screen source: `docs/design-redesign/ROUTE_INVENTORY.md`
> Detailed backend contracts: `FUNCTION_INVENTORY.md` + `functions/*.md`

リデザイン + framework移行で「画面はあるが機能が消えた」を防ぐための**フロントエンド露出機能の正本**。

画面URLの正本は `docs/design-redesign/ROUTE_INVENTORY.md`、DB/Queue/R2/Audit等の詳細はdomain ledgerを正本とし、この文書へ重複させない。

## Completion invariant

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

## What counts as frontend-exposed

以下をすべてフロント機能として扱う。

- 表示情報、button/link/tab/search/filter/sort/pagination
- create/edit/delete/approve/retry等の操作
- login/logout/session/ban/permission
- loading/empty/error/forbidden/degraded/pending/success state
- validation/toast/confirm/destructive confirmation
- URL/deep link/reload/back-forward/query semantics
- responsive/mobile/tablet/desktopでの操作可能性
- external integrationのprogress/failure/quota
- async side effectの待ち時間/完了/再試行
- public/private visibility
- SEO/canonical/OGP等の外部観測挙動

backend-onlyに見えても、ユーザーが状態・制限・遅延・エラーとして観測するものは対象に含める。

## Required UX contract per capability

`CURRENT_VERIFIED`/`PARITY_VERIFIED`へ上げる際は最低限以下を確認する。

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

---

# Public / discovery / playback — 27

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-PUB-001 | 新着・注目・イベント等を発見 | `/` | 棚の意味・順序・作品到達性 |
| FN-PUB-002 | 作品詳細をURLから開く | `/[id]` | internal/YouTube ID deep link |
| FN-PUB-003 | YouTube作品を再生 | `/[id]` | player/fallback/再生導線 |
| FN-PUB-004 | metadata/説明/credit/music表示 | `/[id]` | 情報欠落禁止、優先順位のみ変更可 |
| FN-PUB-005 | chapter表示・移動 | `/[id]` | public/private境界、時間移動 |
| FN-PUB-006 | view計測 | `/[id]` | UXを阻害せず重複計測契約維持 |
| FN-PUB-007 | like等interaction | `/[id]` | login/pending/retry/idempotency |
| FN-PUB-008 | viewer utility/private overlay | `/[id]` | 認可情報のみ、private leak禁止 |
| FN-PUB-009 | 公開イベント一覧 | `/event` | 公開状態、探索導線 |
| FN-PUB-010 | イベント詳細・作品一覧 | `/event/[id]` | stage/visibility差 |
| FN-PUB-011 | release順で連続閲覧 | `/event/[id]/release` | 順序、前後移動、再生中心UX |
| FN-PUB-012 | 公開枠状況を見る | `/event/[id]/slots` | 空き/使用状態、mobile探索性 |
| FN-PUB-013 | イベントグループ一覧/詳細 | `/groups*` | group→event探索関係 |
| FN-PUB-014 | 作品filter/search/sort/paging | `/list` | query/filter/sort/page semantics |
| FN-PUB-015 | recommend作品を見る | `/recommend` | recommendation意味・作品到達性 |
| FN-PUB-016 | trending作品を見る | `/trending` | 順位/集計意味 |
| FN-PUB-017 | creator一覧から探す | `/user` | searchable/listable対象 |
| FN-PUB-018 | creator profile/作品を見る | `/user/[id]` | profile visibility・作品一覧 |
| FN-PUB-019 | creator portfolioを連続閲覧 | `/user/[id]/portfolio` | 作品順・作品中心navigation |
| FN-PUB-020 | About閲覧 | `/about` | 内容到達性・主要導線 |
| FN-PUB-021 | 現行ルール閲覧 | `/rules` | active version・長文探索 |
| FN-PUB-022 | SEO/canonical/OGP | public pages | URL/metadata互換 |
| FN-PUB-023 | 公開お知らせを見る | `/` | publish対象のみ、本文/順序/空状態 |
| FN-PUB-024 | 公開統計・募集中イベント/空き枠概要を見る | `/` | publicVideos/creators/activeEvents、primary event/slot summary |
| FN-PUB-025 | 全体公開ナビゲーション/モバイルメニューを使う | public layout | active state、dismiss/focus、responsive navigation |
| FN-PUB-026 | 公開ヘッダーから作品検索する | public layout → `/list?q=` | IME-safe GET、query/deep-link、mobile/desktop parity |
| FN-PUB-027 | ライト/ダークテーマを切り替える | global/public UI | localStorage永続化、system preference追従、accessible state |

# Authentication / account — 10

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-AUTH-001 | Discord OAuth login | auth | redirect/failure/retry安全性 |
| FN-AUTH-002 | session復元 | site-wide | 不要な再ログイン回避 |
| FN-AUTH-003 | Discord account linking | auth/settings | duplicate/link失敗時の誤紐付け禁止 |
| FN-AUTH-004 | role/ban状態反映 | authenticated UI | UIとserver認可一致 |
| FN-AUTH-005 | onboarding | `/onboarding` | 必須step/再開性 |
| FN-AUTH-006 | terms同意 | onboarding | version/acceptance意味 |
| FN-AUTH-007 | auth complete redirect | `/auth/complete` | safe redirect/open redirect禁止 |
| FN-AUTH-008 | logout | account UI | session/cookie無効化 |
| FN-AUTH-009 | account presence/details閲覧 | public header/account API | loading/degraded/retry、privileged linkはfull summary確認後のみ |
| FN-AUTH-010 | Active X IDを切り替える | account menu | approvedのみ、pending/error、切替後summary再取得 |

# Personal — 7

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-PER-001 | dashboardで次の作業/作品状態を見る | `/dashboard` | 行動優先度・状態把握 |
| FN-PER-002 | 自分/共同編集作品を編集 | `/dashboard/edit/[id]` | save/validation/permission/recovery |
| FN-PER-003 | 共同編集権限管理 | permissions | owner/共同編集者意味 |
| FN-PER-004 | library閲覧 | `/dashboard/library` | authenticated一覧・作品導線 |
| FN-PER-005 | user settings編集 | `/dashboard/settings` | save/validation/reload反映 |
| FN-PER-006 | personal YouTube playlist確認 | `/dashboard/youtube-playlists` | quota/external/error state |
| FN-PER-007 | X ID登録/変更/申請 | settings | approval/conflict/reapply state |

# Entry / submission / slot — 6

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-ENT-001 | 参加/投稿方法を判断 | `/entry` | auth/event/slotに応じた正しい分岐 |
| FN-ENT-002 | slot確保/状態確認 | entry | capacity/duplicate/conflict説明 |
| FN-ENT-003 | slot付き作品提出 | `/entry/slotted` | deadline/ownership/completion |
| FN-ENT-004 | 通常作品投稿 | `/entry/unslotted` | duplicate/input/visibility default |
| FN-ENT-005 | YouTube quick input | entry/forms | duplicate/quota/fallback |
| FN-ENT-006 | custom question回答 | entry/event | schema/required/validation/re-edit |

# Manage — 12

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-MNG-001 | 担当イベント/要対応把握 | `/manage` | staff scope・優先度 |
| FN-MNG-002 | event workspace運営 | `/manage/events/[id]` | tab context・permission表示 |
| FN-MNG-003 | audience情報確認 | `.../audience` | privacy・対象範囲 |
| FN-MNG-004 | event settings編集 | `.../edit` | stage/permission/validation |
| FN-MNG-005 | review queue審査 | `.../review` | 連続処理・status transition |
| FN-MNG-006 | slot運用 | `.../slots` | state/notification/conflict |
| FN-MNG-007 | staff/権限管理 | `.../staff` | owner最低1人・role差・危険操作 |
| FN-MNG-008 | event作品一覧管理 | `.../videos` | filter/status/要対応探索 |
| FN-MNG-009 | event作品1件処理 | `.../videos/[videoId]` | edit/status/audit result |
| FN-MNG-010 | event playlist同期管理 | `.../youtube-playlist` | sync/quota/error/retry |
| FN-MNG-011 | 通知失敗/再試行管理 | `/manage/notifications` | scope/retry/重複防止 |
| FN-MNG-012 | X link request処理 | `/manage/x-link-requests` | delegated permission/audit |

# Admin — 31

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-ADM-001 | admin dashboard対応待ち | `/admin` | 優先度・状態把握 |
| FN-ADM-002 | announcements CRUD/publish | `/admin/announcements*` | publish/preview/audit |
| FN-ADM-003 | API endpoint設定/状態管理 | `/admin/api-endpoints` | security boundary/有効状態 |
| FN-ADM-004 | audit検索/詳細 | `/admin/audit*` | 検索/差分/関連対象導線 |
| FN-ADM-005 | audit restore | `/admin/audit/restore` | 確認/結果/audit |
| FN-ADM-006 | audit settings | `/admin/audit/settings` | 設定影響/save result |
| FN-ADM-007 | cost guard確認/変更 | `/admin/cost-guard` | mode/CAS conflict/反映 |
| FN-ADM-008 | event group CRUD | `/admin/event-groups*` | slug/relation/validation/audit |
| FN-ADM-009 | event CRUD/admin detail | `/admin/events*` | owner/stage/audit/danger |
| FN-ADM-010 | event template管理 | `/admin/events/templates` | integrity/apply result |
| FN-ADM-011 | event staff admin | admin/manage | owner/permission invariant |
| FN-ADM-012 | dangerous event operations | event admin | explicit confirm/audit/rollback |
| FN-ADM-013 | health dashboard | `/admin/health` | read-only診断/状態意味 |
| FN-ADM-014 | integrity checks | `/admin/health/integrity` | default read-only/problem定位 |
| FN-ADM-015 | history閲覧 | `/admin/history` | auditとの意味差/時系列 |
| FN-ADM-016 | legacy import | `/admin/import` | preview/専用境界/recovery |
| FN-ADM-017 | moderation cases | `/admin/moderation` | transition/判断履歴 |
| FN-ADM-018 | notification admin/retry | `/admin/notifications` | retry/idempotency/result |
| FN-ADM-019 | permission simulator | `/admin/permissions/simulator` | real permission core一致 |
| FN-ADM-020 | rules/terms CRUD | `/admin/rules*` | versioning/acceptance impact |
| FN-ADM-021 | security diagnostics | `/admin/security` | secret/private leak禁止 |
| FN-ADM-022 | spreadsheet/DB browser | `/admin/spreadsheet` | read/write境界/confirm/audit |
| FN-ADM-023 | static build/rebuild管理 | `/admin/static-builds` | queue/job/idempotency/result |
| FN-ADM-024 | users search/detail/edit | `/admin/users*` | auth state/ban/role impact |
| FN-ADM-025 | videos search/detail/admin | `/admin/videos*` | status/permission/audit/visibility |
| FN-ADM-026 | video members admin | `/admin/videos/[id]/members` | membership/permission |
| FN-ADM-027 | workers monitoring | `/admin/workers` | worker/job health/failure |
| FN-ADM-028 | X ID merge | `/admin/x-id-merges` | destructive preview/audit/confirm |
| FN-ADM-029 | X link requests | `/admin/x-link-requests` | approval/audit/transition |
| FN-ADM-030 | YouTube quota | `/admin/youtube-quota` | counters/threshold/reset |
| FN-ADM-031 | YouTube sync管理 | `/admin/youtube-sync*` | retry/quota/idempotency/progress |

# System / operational frontend — 2

| ID | User-visible capability | Main surfaces | UX preservation contract |
| --- | --- | --- | --- |
| FN-PLAT-011 | maintenance状態を全ユーザーへ案内 | `/maintenance` | operation modeに応じた正確な状態/次行動、admin例外 |
| FN-PLAT-012 | 既存UI surfaceを開発者が確認 | `/dev/ui-surfaces` | dev-only。production機能と混同せず検証可能性を維持 |

`/onboarding` と `/auth/complete` はSystem screenでもあるが、能力としてはFN-AUTH-005/FN-AUTH-007へ統合して二重計上しない。

---

# Capability count

```text
Public                   27
Authentication/account   10
Personal                  7
Entry                     6
Manage                   12
Admin                    31
System/operational        2
---------------------------
Total                    95
```

86 screensと95 capabilitiesは1:1ではない。
1機能が複数画面へ跨り、1画面が複数機能を持つ。
公開layout/headerのようなcross-route機能もscreen countとは独立してcapabilityとして保持する。

MIG-0010で**全86 screen + cross-route layout → required capability IDs**を完全mappingする。

---

# Technical compatibility routes are not separate user capabilities

CURRENTにはFree 10ms対策等のため、ユーザー向けURLと別に`~query` twin route等が存在する。
例: `/list/~query`, `/event/~query`。

これらは独立したユーザー機能として数えないが、query/filter/pagination semanticsを支える**CURRENT technical compatibility surface**としてROUTE_MATRIXへ記録し、targetで不要になる場合もreplacement evidenceなしに削除しない。

---

# Redesign preservation rules

変更してよい:

- information hierarchy/layout/visual density
- component composition/navigation placement
- mobile-specific arrangement/progressive disclosure
- 意味を変えないwording

明示承認なしに変更しない:

- capabilityの存在
- permission/role semantics
- destructive operationの意味
- validation/business rule
- public/private visibility
- URL/canonical compatibility
- async side-effect/retry/idempotency semantics
- auditability/external integration outcome

workflow変更が必要な最適化は`BACKEND_OPTIMIZATION.md`へUX impactを記録して別判断する。

---

# Audit progression

- `MIG-0002`: 86 screen/page/route + 95 frontend capability baseline
- `MIG-0003`: Server Actions / inline actions
- `MIG-0004`: Route Handlers/API
- `MIG-0007`: static/visibility
- `MIG-0008`: auth/permission
- `MIG-0009`: background jobs
- `MIG-0010`: 86 screens + cross-route layout ↔ capability IDs complete mapping
- `MIG-0011`: gap scan + backend optimization/blocker assessment

**MIG-0011完了までは「全機能棚卸し完了」と宣言しない。**
