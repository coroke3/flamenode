# FlameNode Frontend Feature Inventory

> Status: Active / Frontend-visible behavior source of truth
> Last updated: 2026-10-06
> Progress: [`STATUS.md`](STATUS.md)
> Function implementation detail: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md) + `functions/*.md`
> Route inventory: [`ROUTE_MATRIX.md`](ROUTE_MATRIX.md) / `docs/design-redesign/ROUTE_INVENTORY.md`

この文書は、リデザイン・framework移行・backend再設計の過程で**ユーザーから見える機能・使い心地・状態遷移を落とさないための正本**。

実装方式は変更してよい。以下は明示承認なしに退化させない。

- 利用可能な操作
- 操作できる条件 / 権限
- 入力できる情報
- 表示される情報
- 完了後の結果とfeedback
- loading / empty / error / forbidden / partial-failure状態
- URL / navigation / reload / back-forward semantics
- destructive actionの確認
- accessibility / keyboard / mobileでの主要操作到達性
- 公開/非公開・privacy境界

**コード行数、framework都合、backendの美しさを理由にfrontend capabilityを削除しない。**

---

# 1. Frontend parity model

各frontend-visible functionは以下を確認する。

```text
Function ID
Visible surface(s)
User / role
User goal
Primary action
Secondary actions
Inputs
Visible outputs
Availability / permission
Happy path
Loading
Empty
Validation error
Server/external error
Forbidden
Partial failure / retry
Success feedback
Navigation / URL
Mobile / responsive
Accessibility / keyboard
Destructive confirmation
Frontend-observable side effects
Current evidence
Target evidence
Parity state
```

`PARITY_VERIFIED` は見た目が似ているだけでは不可。

---

# 2. Public / discovery / playback

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-PUB-001` | ホームで新着・注目・イベント等から作品を発見 | 棚/優先順位、作品へ到達、イベント導線、空状態 |
| `FN-PUB-002` | 作品詳細を開く | internal ID / YouTube ID alias、404/非公開、canonical URL |
| `FN-PUB-003` | YouTube作品を再生 | player開始、再生不能時feedback、モバイル視聴性 |
| `FN-PUB-004` | title/作者/説明/credit/music等を確認 | 情報欠損時表示、リンク、SEOと画面内容の整合 |
| `FN-PUB-005` | chapterを閲覧・移動 | chapter有無、公開/private境界、時間位置への移動 |
| `FN-PUB-006` | 視聴がviewとして反映される | ユーザー操作を邪魔しない、重複抑制、失敗で再生を壊さない |
| `FN-PUB-007` | like等の作品interaction | 未ログイン時導線、現在状態、成功/失敗feedback、idempotency |
| `FN-PUB-008` | viewer utility / private overlayを利用 | 権限に応じた表示、private data非漏洩、取得失敗時の安全な縮退 |
| `FN-PUB-009` | イベント一覧を探す | 開催状態/時期の理解、対象イベントへ到達、空状態 |
| `FN-PUB-010` | イベント詳細・作品一覧を見る | event visibility/stage、概要→作品導線、作品状態 |
| `FN-PUB-011` | イベント作品をrelease順に連続閲覧 | 順序、前後移動、公開済みのみ、再生中心UX |
| `FN-PUB-012` | 公開枠状況を見る | 空き/予約/提出等の状態理解、privacy-safe情報のみ |
| `FN-PUB-013` | イベントグループ一覧/シリーズを見る | group→event導線、slug/visibility、空状態 |
| `FN-PUB-014` | 作品一覧をfilter/searchする | query/filter semantics、URL復元、0件、pagination/infinite behavior |
| `FN-PUB-015` | おすすめ作品を見る | 作品へ到達、候補不足時、順序の説明可能性を壊さない |
| `FN-PUB-016` | trendingを見る | 順位/作品情報、対象不足、更新されても操作を壊さない |
| `FN-PUB-017` | creator一覧から作者を探す | public-listableのみ、検索/探索、空状態 |
| `FN-PUB-018` | creator profileと作品を見る | profile visibility、作者→作品導線、作品なし状態 |
| `FN-PUB-019` | portfolioを作品中心で閲覧 | 作品順・移動、作品外UIを邪魔にしない |
| `FN-PUB-020` | Aboutを読む | サービス理解、主要public導線 |
| `FN-PUB-021` | Rules/Termsを読む | active version、長文探索、必要箇所への到達 |
| `FN-PUB-022` | 検索/SNSから正しい公開ページへ到達 | title/description/canonical/OGP/visibility整合 |

### Public cross-screen contracts

- public→private変更後に古い画面を公開し続けない。
- entity not found / blocked / unavailableを区別できなくても、private dataを返さない。
- navigation/header/footerから主要public面へ到達できる。
- global error / not-found / degraded / maintenance状態で次の行動が分かる。
- 作品再生は周辺機能の失敗に巻き込まれない。

---

# 3. Authentication / onboarding

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-AUTH-001` | Discordでログイン | ログイン開始/復帰、callback失敗feedback、安全なorigin |
| `FN-AUTH-002` | 再訪時にログイン状態が復元 | 不必要な再ログインを避ける、期限切れ時の自然な導線 |
| `FN-AUTH-003` | Discord account linking | 重複/競合時の安全なfeedback、誤結合防止 |
| `FN-AUTH-004` | role/banned状態に応じた画面・操作 | forbidden state、権限外操作をUIでも理解可能にする |
| `FN-AUTH-005` | onboardingを完了 | 未完項目表示、途中状態、完了後の次導線 |
| `FN-AUTH-006` | 規約に同意 | version/必須同意、未同意時の制限、成功feedback |
| `FN-AUTH-007` | 認証完了後に元の作業へ戻る | safe redirect、canonical host、失敗時の戻り先 |
| `FN-AUTH-008` | logout | session終了、完了feedback、private画面残留防止 |
| `FN-AUTH-009` | 自分のaccount情報を利用 | private dataのみ、loading/error、未認証時safe failure |

---

# 4. Personal dashboard / owned video

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-PER-001` | dashboardで次に必要な作業を判断 | owned/related data、priority、0件時、期限/状態理解 |
| `FN-PER-002` | 自分/共同編集作品を編集 | 現在値、validation、dirty/saving/success/error、権限差 |
| `FN-PER-003` | 共同編集者と権限を管理 | current members、権限差、危険変更確認、owner保護 |
| `FN-PER-004` | libraryを見る | 保存/関連作品の意味、一覧/空状態、作品遷移 |
| `FN-PER-005` | profile/account settingsを変更 | current values、validation、保存feedback、X/session連携 |
| `FN-PER-006` | 自分に関連するYouTube playlistを確認 | external loading/error/quota、playlistへ到達 |
| `FN-PER-007` | X IDを登録/変更/申請 | current state、申請中/承認/拒否、重複制約、feedback |

---

# 5. Entry / submission / slot

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-ENT-001` | 参加/枠提出/通常投稿の次行動を選ぶ | event/slot/auth状態に応じた分岐、期限/利用不可理由 |
| `FN-ENT-002` | slotを確保・状態確認 | 空き/確保/競合、重複防止、成功/満枠/競合feedback |
| `FN-ENT-003` | 確保済みslotへ作品提出 | slot ownership、deadline、確認、validation、提出完了 |
| `FN-ENT-004` | event slot外で通常作品投稿 | duplicate、入力、公開初期値、完了後作品導線 |
| `FN-ENT-005` | YouTube URLからquick input | metadata取得中/失敗、重複検知、手動補正可能性 |
| `FN-ENT-006` | event custom questionへ回答 | question schema、required/optional、validation、再表示 |

---

# 6. Event management

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-MNG-001` | 担当イベントと要対応を把握 | staff scope、priority、0件/問題なし状態 |
| `FN-MNG-002` | event workspace全体を把握 | stage/status、主要task/tabs、権限差 |
| `FN-MNG-003` | audience情報を確認 | privacy/permission、空状態、対象へのdrill-down |
| `FN-MNG-004` | event settingsを編集 | current values、stage制約、validation、保存feedback |
| `FN-MNG-005` | review queueを連続処理 | next item、status transition、空queue、戻る/保留 |
| `FN-MNG-006` | slotを運用 | 一覧/状態/filter、個別操作、通知結果、競合 |
| `FN-MNG-007` | staff/role/permissionを管理 | owner最低1人、role差、危険変更確認、反映結果 |
| `FN-MNG-008` | event作品一覧を管理 | 状態/filter/search、要対応作品への到達 |
| `FN-MNG-009` | event作品1件を処理 | 情報/審査/状態操作の近接、権限、audit対象操作のfeedback |
| `FN-MNG-010` | event playlist同期を見る/操作 | sync状態、quota、retry/error、外部playlist導線 |
| `FN-MNG-011` | 失敗/保留通知を確認・再処理 | event scope、retry結果、二重送信を誘発しないUI |
| `FN-MNG-012` | X link requestを処理 | request内容、approve/reject、権限、audit、完了状態 |

---

# 7. Administration

| Function ID | Frontend-visible capability | Must preserve |
| --- | --- | --- |
| `FN-ADM-001` | 全体の対応待ち/障害兆候を把握 | priority queue、正常時状態、各管理面へ到達 |
| `FN-ADM-002` | announcements CRUD | list/search/new/edit/publish state、validation、audit |
| `FN-ADM-003` | API endpoint設定/状態を確認 | exposed endpoint、security-sensitive controls、確認 |
| `FN-ADM-004` | auditを検索・詳細確認 | filter、actor/target/diff、immutable表示 |
| `FN-ADM-005` | auditから復元 | preview/impact、明示確認、成功/部分失敗、再実行安全性 |
| `FN-ADM-006` | audit設定を管理 | current settings、validation、保存/audit feedback |
| `FN-ADM-007` | cost guard状態/モードを管理 | current mode、競合、変更確認、結果 |
| `FN-ADM-008` | event group CRUD | list/new/edit/delete相当、relation/slug constraints |
| `FN-ADM-009` | event CRUD/admin detail | list/detail/edit、stage、owner invariant、danger operations導線 |
| `FN-ADM-010` | event template管理 | list/edit/applyに必要な状態、integrity |
| `FN-ADM-011` | event staffをadmin管理 | owner/permission invariant、変更結果 |
| `FN-ADM-012` | dangerous event operation | impact説明、二段確認、audit、失敗時復旧情報 |
| `FN-ADM-013` | health dashboardを見る | subsystem状態、正常/警告/障害、drill-down |
| `FN-ADM-014` | integrity checkを見る/実行 | read-only default、結果詳細、修復との区別 |
| `FN-ADM-015` | historyを見る | auditとの差、時系列、対象へ到達 |
| `FN-ADM-016` | legacy importをpreview/実行 | preview、validation、専用境界、失敗/partial state |
| `FN-ADM-017` | moderation caseを処理 | queue/filter/detail、status transition、audit |
| `FN-ADM-018` | notification admin/retry | status/filter/retry、idempotency、結果確認 |
| `FN-ADM-019` | permission simulator | 入力主体/対象/操作、実permission coreと同じ判定、説明 |
| `FN-ADM-020` | rules/terms CRUD/version管理 | version、active状態、同意影響、publish確認 |
| `FN-ADM-021` | security diagnostics | secretを露出せず状態を理解、actionable warning |
| `FN-ADM-022` | spreadsheet/DB browser | filter/read/write境界、危険編集確認、permission |
| `FN-ADM-023` | static build/rebuildを監視/再試行 | queue/build state、target、retry、失敗理由 |
| `FN-ADM-024` | usersを検索/詳細/編集 | search/filter/detail、role/ban等の危険変更確認 |
| `FN-ADM-025` | videosを検索/詳細/admin操作 | filters/detail/status、visibility/ownershipへの影響 |
| `FN-ADM-026` | video membersを管理 | member list/role/permission、owner safety |
| `FN-ADM-027` | Workers/job状態を監視 | worker/job/queue health、失敗箇所、再処理導線 |
| `FN-ADM-028` | X ID mergeを実行 | source/target確認、impact preview、不可逆性、audit |
| `FN-ADM-029` | X link requestをadmin処理 | queue/detail/approve/reject/audit |
| `FN-ADM-030` | YouTube quotaを見る | usage/limit/threshold、警告、更新時刻 |
| `FN-ADM-031` | YouTube syncを管理 | target/state/retry/quota/idempotency、error detail |

---

# 8. System-level UX contracts

Function IDだけでは抜けやすいため、以下もfrontend parity対象にする。

| Surface | Required experience |
| --- | --- |
| global `not-found` | 何が無いかを漏洩せず説明し、主要導線へ戻れる |
| global error | 再試行/戻る導線、traceは安全な短縮値のみ、private detail非漏洩 |
| loading | 操作可能と誤認させない。長時間処理では進行/待機理由を示す |
| empty | 「0件」と「取得失敗」を区別し、次の行動を示す |
| forbidden | login不足/権限不足/ban等を可能な範囲で安全に区別する |
| maintenance | 利用不可理由と再確認方法を提示する |
| degraded | 一部機能だけ劣化した場合、利用可能部分を壊さず明示する |
| stale/conflict | 編集競合・古い状態で上書きしない。必要なら再読込/再試行を促す |
| external failure | YouTube/Discord/X/Drive等が失敗しても、可能な限りFlameNode側の作業を保持する |
| destructive confirm | 削除/復元/merge/owner変更等は影響対象を確認してから実行する |

---

# 9. Redesign completion rule

リデザイン画面は以下が揃うまでDONEにしない。

1. 画面に関連するfunction IDが列挙済み
2. primary / secondary / destructive actionが全てmap済み
3. role/permission差がmap済み
4. loading / empty / validation / server error / forbidden / partial failureがmap済み
5. mobile/tablet/desktopで主要操作へ到達可能
6. current URL / deep link / reload / history semanticsを維持または明示変更承認済み
7. backend side effectの実装方式が変わってもfrontend resultが同等以上
8. 削除機能は`REMOVED_APPROVED`のみ

見た目だけ完成した場合は `UI_DONE_FUNCTIONS_PENDING`。

---

# 10. Inventory completion / blocker reporting

全frontend機能棚卸し完了後、backend効率化の障害となるfrontend contractがあれば、削除・変更を勝手に行わず以下で報告する。

```text
Function ID:
Current frontend behavior:
Why it blocks/splits backend optimization:
Optimization otherwise possible:
Option A — preserve behavior / backend cost:
Option B — frontend change / exact user impact:
Option C — defer optimization:
Affected roles/screens:
Data/security implications:
Recommendation:
Approval required: yes
```

原則は**frontend behaviorを維持したままbackendを最適化する案を先に選ぶ**。
