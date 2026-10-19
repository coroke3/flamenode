# Phase 2 Acceptance Gate (MIG-0206)

> Status: **PASSED** — オーナー（Yugo）が 2026-10-18T16:38:49Z にプロジェクトチャットで承認（"すべて承認してよい　進めて"）。見た目と REPRESENTATIVE_SCREENS.md §4 の意図的な差分の受け入れを含む。独立レビューは無いまま承認された
> Task: MIG-0206（Recipe R-EVIDENCE）
> Work Order: [`PHASE_2_SPEC.md`](../PHASE_2_SPEC.md) `### MIG-0206`
> Decision: D-08 DECIDED（登録済み HTML mock）
> Last verified: 2026-10-18（origin/main `c47b9620`）

エージェントは Gate を承認しない。この文書は判定材料の一覧で、承認は PR #321 に人間が記録する。証跡が欠けている項目は「未達」とし、該当 MIG へ差し戻す。

## 1. 前提: MIG-0201..0205 の merge

| MIG | 内容 | 状態（2026-10-18） | 根拠 |
| --- | --- | --- | --- |
| MIG-0200 | mock 登録 | merge 済み | `726ca7c`（#284） |
| MIG-0201 | tokens 抽出 | merge 済み | `a5d1963` |
| MIG-0202 | primitives | merge 済み | `11b1cda`（#306）, `5f3526c` |
| MIG-0203 | 公開ナビゲーション・レイアウト | merge 済み | `d8b86ba`（#309） |
| MIG-0204 | フォーム・フィードバック・データ表示 | merge 済み | `a996b5d`（#311 squash） |
| MIG-0205 | 代表3画面 | merge 済み | `c47b9620`（#317 squash） |

→ Work Order の「MIG-0201..0205 の merge 後に証跡をまとめる」は **達成**（MIG-0200〜0205 全件が main に merge 済み）。

## 2. Gate 項目（Work Order U01 / Test cases）

| 項目 | 結果 | 証跡 |
| --- | --- | --- |
| T01 mock 版の一致 | 達成 | `UI_REFERENCE.md:9,43` の Version/hash `1792048584-12ca` と `mock/README.md` の書き出し版 `1792048584-12ca` が一致。`mock/` は本 stack で未変更（`git diff origin/main -- docs/migration/mock` が空） |
| T02 対応表が公開 VISUAL_SCREEN を網羅 | 達成 | `CURRENT_ROUTES.md` Public 16行のうち VISUAL_SCREEN 14件（`/`, `/[id]`, `/about`, `/event`, `/event/[id]`, `/event/[id]/release`, `/event/[id]/slots`, `/list`, `/recommend`, `/rules`, `/trending`, `/user`, `/user/[id]`, `/user/[id]/portfolio`）すべてが `UI_REFERENCE.md` の対応表に PUBLIC_MOCK で載り、参照先 mock の `site/` `static/` `screenshots/*.{desktop,mobile}.jpg` が全件存在。残り2件 `/groups*` は COMPAT_REDIRECT |
| T03 UX ID の削除 0件 | 達成 | `docs/migration/frontend/**` と `screen-mapping/**` の UX ID は origin/main と同じ 432件（差分 0。`git diff origin/main -- docs/migration/frontend docs/migration/screen-mapping docs/migration/mock` は空）。代表3画面の未対応・次MIG は [`REPRESENTATIVE_SCREENS.md`](REPRESENTATIVE_SCREENS.md) に UX ID ごとに記録 |
| primitive の状態テスト | 達成 | `npm run test --workspace=@flamenode/ui` 60件全件 PASS（本 PR head で再実行）（Button disabled/loading・名前必須、Badge、Dialog の Esc/フォーカス復元/入れ子/StrictMode、scroll lock、Pagination、TableScroll、ImeSafeGetForm の IME Enter、AutoSubmitSelect、ErrorCallout、StatusNotice、EmptyState、header の mobile menu、代表3画面）。`forms.dom.test.mjs` のタイマー依存の2件は #311 の `fc75e0c` / `5648f63` で同期化し、`a996b5d` として main に入った |
| 代表3画面のスクリーンショット | 達成（オーナーが 2026-10-18 に受け入れ） | 1440px / 390px の全ページ画像を mock の画像と並べて `project-files/migration-review/pr317-screens/` に保存。横はみ出し 0（scrollWidth = 幅）・Tab 順を計測した LOG=`project-files/migration-review/pr317-screens-browser.log`。GitHub への画像添付は人間が行う |
| 未対応 UX ID と次MIG | 達成 | `REPRESENTATIVE_SCREENS.md` 1〜3章（作品詳細の操作系は MIG-0507、イベントのライブ枠は MIG-0502、クリエイターの query は MIG-0504、可視性は MIG-0405、head/JSON-LD は MIG-0403） |
| 独立レビュー APPROVE | **なし** | 独立レビューは記録されていない。オーナーは独立レビュー無しで Gate を承認した |
| CI green | **達成** | PR #321 head `58da4f8b`（origin/main `c47b9620` merge 済み）にて run `39125431381`（migration-contract, migration-workspaces）全件 green 達成 |
| 人間の Phase Gate 承認 | 達成 | オーナーが 2026-10-18T16:38:49Z にプロジェクトチャットで承認（"すべて承認してよい　進めて"）。PR #321 のコメントに記録 |

## 3. Phase 2 で見つかった持ち越し

- MIG-0202 / MIG-0204 の primitive に CSS が無かった（`fn-btn` などのクラスだけ出していた）。#317 で `packages/ui/src/styles/components.css` を追加し、mock の `components.css` の Button / Status / Row / VideoCard / Progress と、mock に規則の無い Pagination / TableScroll / EmptyState を補った。
- スマホ（≤640px）で固定 header の高さ分の余白（mock `fn.css` の `.p-root:has(.hd2){padding-top:52px}`）は `layout.css` に無い。ページの外枠（Phase 4/5 の page shell）で入れる。
- mock の Creator スマホ表示は About の下に大きな空きがある（mock の CSS のまま）。直すかどうかは人間の判断。

## 4. Yugo が決めること

1. 代表3画面のスクリーンショット（`pr317-screens/`）を mock と見比べて、見た目を受け入れるか。
2. mock との意図した差（`REPRESENTATIVE_SCREENS.md` 4章: イベントの導線を CURRENT と同じ1つにした、作品詳細の見出しを見せる、スマホ固定プレーヤーと dock は Island と一緒）を受け入れるか。
3. 代表3画面（#317）の merge 完了（`c47b9620`）と PR #321 現 head の CI green を確認した上で Gate を承認するか。承認後の統合で `STATUS.md` の MIG-0206 を DONE にし、MIG-0402 の依存を解く。
