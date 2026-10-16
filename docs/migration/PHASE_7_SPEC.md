# FlameNode Phase 7 タスク仕様書（Private SPA Spec）

> 状態: Active / Phase 7 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Personal 6, Entry 3, Manage 12, Admin 45 に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-05)
> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

---

# 1. Private SPA の基本方針

1. **React + Vite による2つの独立SPA**:
   - Personal SPA: `apps/app`（`/dashboard`, `/entry`, `/onboarding`）、Ops SPA: `+apps/ops`（`/manage`, `/admin`）。どちらもCloudflare Workers Static Assetsから配信し、rootのHTML shell・error boundary・buildは独立。
   - ルーティングは `react-router-dom` を使用し、ブラウザ遷移で高速に動作。
2. **デザイン適用戦略（案A）の遵守**:
   - 管理・マイページ・登録画面はデザイン全面刷新を行わず、現行の UI/コンポーネント資産（`packages/ui`）を流用して移行効率を最大化。
   - `@flamenode/ui` のルーターアダプターを各SPA rootのContext/Providerで注入。module-global `setLinkComponent` / `setNavigatorAdapter` はPoC互換に限定。
3. **2 SPAルーティング・パス分離（D-05決定済み）**:
   - `apps/app`: `/dashboard`, `/dashboard/*`, `/entry`, `/entry/*`, `/onboarding`。既存作品編集 `/dashboard/edit/*` もPersonalに所属。
   - `+apps/ops`: `/manage`, `/manage/*`, `/admin`, `/admin/*`。Opsはroot SPA shell/entrypoint/Worker/static assetsを独立させる。
   - `base:'/'`を両方で使用するが、アセットprefixは `/_personal_assets/*` と `/_ops_assets/*` を分離。`assetsDir`だけでなくビルド出力とCloudflare Worker Routeの実URLを検査する。
   - 各SPAの内部ではReact Router、両SPA間は通常のHTTPフルナビゲーション。Cookie/sessionは同一origin、権限は必ずHonoで再検証。redirect/direct reload/404/asset/cacheをE2E確認。
   - Ops専用chunkがPersonal bundleに混在しないこと、権限がないユーザーがOpsのprivate DTOにアクセスできないことをテスト。

---

# 2. Phase 7 タスク別詳細仕様書（実ルート対応）

### Phase 7 共通契約（MIG-0701〜0706）

- 見た目は CURRENT の UI を移植する（案A。`UI_REFERENCE.md`）。private mock は参考で、Gate 条件にしない。
- データと mutation は Phase 6 の Hono API だけを使う。SPA から D1 や Server Action を呼ばない。権限は Hono 側で必ず再検証する。
- Adapter は各SPA root の Provider で注入する（MIG-0203）。
- 本番の Route 切替は各MIGの DONE 後に人間の明示承認を得て別操作として行う。
- 共通のコマンド: `npm run build --workspace=@flamenode/app`（Ops は `--workspace=@flamenode/ops`）, `npm run typecheck`, `npm run check:project-docs`。
- 共通の Rollback: PRをrevert。本番 Route を切り替えた後の戻しは `ROUTING_AND_DEPLOY_PLAN.md` の手順で、その実行も明示承認事項。

### MIG-0701: dashboard read-only（Personal 参照系画面）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0601 と MIG-0608（session 読み取り）の merge 後
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0102, MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(auth)/dashboard/page.tsx`, `app/(auth)/dashboard/library/page.tsx`, `app/(auth)/dashboard/settings/page.tsx`, `app/(auth)/dashboard/youtube-playlists/page.tsx`（COMPAT_REDIRECT）, `app/(auth)/onboarding/page.tsx`（`FILE_MIGRATION_MATRIX.md` で MIG-0701 所有）。
- `apps/app/vite.config.ts`: `base: "/"`, `assetsDir: "_personal_assets"`。`apps/app/src/App.tsx` は疎通用 Button のみ。`react-router-dom` `^7.0.0` は依存に入っている。
- 認証まわりの状態（loading / BAN / X 未連携）の契約は `frontend/AUTH_PERSONAL_ENTRY.md`。
#### Owned paths
- 変更: `apps/app/src/App.tsx`, `apps/app/src/main.tsx`
- 新規: `+apps/app/src/routes/dashboard/*.tsx`, `+apps/app/src/routes/onboarding.tsx`, `+apps/app/src/api/*.ts`
- 触らない: `app/(auth)/**`
#### Micro-units
- **U01 router shell**: React Router と error boundary、未ログイン時の挙動（CURRENT と同じ遷移先）。
- **U02 dashboard / library**: Active X 単位の表示。`no-store`。
- **U03 settings / onboarding / youtube-playlists redirect**: 表示のみ（更新は MIG-0702）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | X 0件 / 1件 / 複数 | CURRENT と同じ表示 |
| T02 | 未ログインで直接URL | CURRENT と同じ遷移 |
| T03 | 再読込・戻る・進む | 状態が壊れない |
| T04 | BAN された利用者 | CURRENT と同じ表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の5ページ行を IN_PROGRESS（target は `apps/app/src/routes/*`）。
#### DONE checklist
- [ ] 5ルートの状態が CURRENT と一致
- [ ] SPA から Server Action や D1 を呼んでいない
#### STOP
- 必要な API が Phase 6 に無い場合は止めて lead へ返す。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0702: dashboard mutations（Personal 更新系機能）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602・MIG-0605・MIG-0701 の merge 後（Active X / profile の API は MIG-0605）
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0602, MIG-0605, MIG-0701 / **Decisions:** D-03 DECIDED, D-04 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- SA-098〜105（`src/lib/actions/xid.ts`: `setActiveXId`, `requestXIdLink`, `cancelXIdLinkRequest`, `requestXIdMergeRevert`, `updateXIdProfile`, `deleteLinkedXId`, `setXIdIcon`, `uploadXIdIcon`）、SA-076 `acceptOnboardingTerms`（`src/lib/actions/terms.ts`）。
- 通知の「既読化」は CURRENT に無い。追加しない。
#### Owned paths
- 新規: `+apps/app/src/routes/dashboard/settings/*.tsx`（更新フォーム）, `+apps/app/src/components/ActiveXLinkModal.tsx`
- 触らない: `src/lib/actions/**`
#### Micro-units
- **U01 profile / X**: SA-102〜105。
- **U02 Active X / link**: SA-098〜101。未連携ユーザーの登録誘導モーダル。
- **U03 onboarding**: SA-076。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 二重送信 | 1回だけ反映 |
| T02 | 承認待ちの連携 | CURRENT と同じ表示 |
| T03 | manager 権限だけの X | CURRENT と同じ可否 |
| T04 | X 0件でいいね | 誘導モーダル |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-076, 098〜105 に SPA 側の呼び出し元。
#### DONE checklist
- [ ] U01〜U03 が DONE
- [ ] CURRENT に無い mutation を追加していない
#### STOP
- D-04（Active X 一斉切替）の実行が必要に見えたら止める（別承認）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0703: entry（Entry 画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0702 の後。作品投稿は MIG-0603、枠は MIG-0604 の API を使う
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0603, MIG-0604, MIG-0702 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(auth)/entry/page.tsx`, `app/(auth)/entry/slotted/page.tsx`, `app/(auth)/entry/unslotted/page.tsx`, `app/(auth)/dashboard/edit/[id]/page.tsx`, `app/(auth)/dashboard/edit/[id]/permissions/page.tsx`。
- フォーム: `src/components/forms/VideoForm.tsx`, `UnslottedPostForm.tsx`, `CustomQuestionFields.tsx`, `VideoMembersField.tsx`（契約テスト `src/components/forms/*.contract.test.mjs` 5件）。
- SA-086〜089（投稿・更新）。編集権限は PR #265 の一本化した判定。
#### Owned paths
- 新規: `+apps/app/src/routes/entry/*.tsx`, `+apps/app/src/routes/dashboard/edit/*.tsx`
- 触らない: `src/components/forms/**`（移植元。Phase 9 まで残す）
#### Micro-units
- **U01 entry**: `/entry` と slotted / unslotted。
- **U02 edit**: `/dashboard/edit/:id` と permissions。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 投稿済みの枠で再投稿 | CURRENT と同じ拒否 |
| T02 | 不正な YouTube URL・重複 | CURRENT と同じエラー |
| T03 | collaborator が権限ページ | CURRENT と同じ可否 |
| T04 | 編集中の再読込 | CURRENT と同じ |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run typecheck
npm run test:unit
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の5ページ行を IN_PROGRESS。
#### DONE checklist
- [ ] 5ルートのフォーム状態と副作用が SA ごとに CURRENT と一致
#### STOP
- 権限判定を SPA 側で決める必要が出たら止める（Hono が正）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0704: manage（Manage イベント運営画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0604 と MIG-0703 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0604, MIG-0703 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT（12ファイル）: `app/(manage)/manage/page.tsx`, `app/(manage)/manage/events/[id]/{page,edit/page,audience/page,slots/page,staff/page,videos/page,videos/[videoId]/page,youtube-playlist/page,review/page}.tsx`, `app/(manage)/manage/notifications/page.tsx`, `app/(manage)/manage/x-link-requests/page.tsx`。
- `apps/ops` はまだ無い（`FILE_MIGRATION_MATRIX.md` の Future files 表で NOT_CREATED）。
- 部品: `src/components/manage/**`, `src/components/layout/ManageSidebarNav.tsx`, `ManageActiveXNotice.tsx`。
#### Owned paths
- 新規: `+apps/ops/package.json`（`@flamenode/ops`）, `+apps/ops/index.html`, `+apps/ops/tsconfig.json`, `+apps/ops/vite.config.ts`（`assetsDir: "_ops_assets"`）, `+apps/ops/src/**`
- 変更: `package-lock.json`, `.github/workflows/migration-docs-check.yml`（Ops の build を追加）
- 触らない: `app/(manage)/**`, `apps/app/**`
#### Micro-units
- U01〜U05 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0704 のとおり。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Personal と Ops の build | CSS/JS が互いに混ざらない |
| T02 | 担当外イベントの URL | 拒否 |
| T03 | 最後の owner の解任 | 拒否 |
| T04 | `/manage/events/[id]/review` | `videos?status=pending` へ互換 redirect |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run typecheck
npm run check:event-owners
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Manage 12行を IN_PROGRESS、`apps/ops/**` 行を追加。
#### DONE checklist
- [ ] U01〜U05 と Final audit が DONE
- [ ] Ops の build が CI で動く
#### STOP
- Ops の Worker / Route を本番に作る必要が出たら止める（明示承認事項）。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0705: admin（Admin 全体管理者画面群）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0605 と MIG-0704 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0705
- **Recipe:** R-SCREEN
- **Runtime:** N
- **Depends on:** MIG-0605, MIG-0704 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(admin)/**/page.tsx` 45件（`CURRENT_ROUTES.md` Admin 45）。部品は `src/components/admin/**`。
- 危険操作（spreadsheet 書き込み、X merge、audit restore、BAN）は strict audit と確認が必要（`server-actions/README.md`）。
#### Owned paths
- 新規: `+apps/ops/src/routes/admin/**`（lazy chunk）
- 触らない: `app/(admin)/**`, `apps/app/**`
#### Micro-units
- U01〜U08 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0705 のとおり。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | guest / user / moderator / owner / admin × 45ルート | CURRENT と同じ可否 |
| T02 | spreadsheet の import 途中失敗 | 全件ロールバック |
| T03 | 発行 token | ブラウザに渡らない |
| T04 | Personal bundle | admin のコードが入っていない |
#### Commands
```bash
npm run build --workspace=@flamenode/ops
npm run build --workspace=@flamenode/app
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Admin 45行を IN_PROGRESS。
#### DONE checklist
- [ ] U01〜U08 と Final audit が DONE
- [ ] 危険操作が独立レビューを通っている
#### STOP
- 任意SQLを実行できる画面が必要に見えたら止める。
#### Rollback
Phase 7 共通契約のとおり。

### MIG-0706: Phase 7 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0705 / **Decisions:** D-05 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- Personal 6 + `/onboarding`、Entry 3、Manage 12、Admin 45（`CURRENT_ROUTES.md`）と MIG-0701〜0705 の merge 済みPR。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_7_GATE.md`
- 変更: `docs/migration/ROUTE_MATRIX.md`, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 全ルートの対応・権限・404・再読込・SPA間遷移の証跡をまとめる。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 2つの SPA の build | 両方成功、asset prefix が分離 |
| T02 | 権限の無い利用者が Ops の DTO | 拒否 |
| T03 | 未移行の Server Action | 0件 |
#### Commands
```bash
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0706 を DONE。
#### DONE checklist
- [ ] 全ルートの証跡
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
- [ ] Ops の bundle が存在する
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate のPRをrevert。
