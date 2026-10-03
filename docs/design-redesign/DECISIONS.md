# Decisions

## D-001 — Production pages are out of scope

**Decision:** 本番の `app/(public)`, `(auth)`, `(manage)`, `(admin)` は変更しない。

**Reason:** 今回は次期UIの比較・レビューが目的。機能・権限・DB副作用を巻き込まずデザイン判断だけを検証する。

## D-002 — Mock route group is isolated

**Decision:** `app/(redesign)/dev/redesign` を使う。

**Reason:** URLは `/dev/redesign` に保ちつつ、既存Public/Auth/Manage/Admin layoutから独立させる。mock側でDB/API/authを呼ばない。

## D-003 — Route catalog is data-driven

**Decision:** 86個のpage componentを複製せず `_catalog.ts` で全routeを列挙し、役割ごとのlayout archetypeへ割り当てる。

**Reason:** 「全ページを対象」にしながら、ページ専用component乱造を避ける。coverageの差分も1一覧で検出しやすい。

## D-004 — FlameNode Sans remains the brand font

**Decision:** brand / heading / short UI actionへ `var(--font-brand)` を使い、bodyは `var(--font-body)`。

**Reason:** ブランド性を維持しつつ、長文可読性を犠牲にしない。

## D-005 — Existing color tokens are reused

**Decision:** 新規paletteを作らない。Background / Surface / Text / Muted / Border / Accent / Danger / Warning / Successへ整理して既存tokenを参照する。

**Reason:** redesignが別製品に見えることを防ぎ、Light/Dark互換を維持する。

## D-006 — Cards are not the default container

**Decision:** list/table/definition row/dividerを優先する。

**Reason:** FlameNodeは情報量が多く、1情報=1cardは比較速度と画面密度を下げる。

## D-007 — Public first viewport shows works

**Decision:** Homeは新着作品をfirst viewportの主役にし、active eventはcompact stripへ下げる。

**Reason:** 公開画面の主役はUIではなく映像作品。

## D-008 — Dashboard stats move down

**Decision:** KPIを削除せず、Next Actionより下へ移す。

**Reason:** Dashboardの目的は分析ではなく行動開始。数値は補助情報。

## D-009 — Entry is prioritized by current state

**Decision:** reserved/not-submitted slot → active event → unslotted postの順。

**Reason:** 期限と未完了作業を優先し、選択肢を同時に並べすぎない。現行の機能条件は維持する。

## D-010 — Manage uses event workspace tabs

**Decision:** Overview / Videos / Slots / Review / Audience / Staff / Settingsをevent文脈内のTabsとして扱う。

**Reason:** eventを選び直す回数、sidebar探索、ページ間の文脈切替を減らす。

## D-011 — Admin navigation is six semantic groups

**Decision:** Content / Events / Users / Moderation / Operations / System。

**Reason:** route名ではなく管理対象で探索できるようにする。現行の細分化されたgroupを読む負荷を減らす。

## D-012 — Admin home becomes a priority queue

**Decision:** count cardsではなくpriority tableを主役にする。

**Reason:** 異常件数を横比較し、最優先のqueueへ直接移動しやすい。

## D-013 — Mobile tables become labeled rows

**Decision:** 390pxでは通常tableを単純縮小せず key/value rowへ変形する。

**Reason:** 横スクロールと小さいtap targetを減らす。ただし列横比較が本質のtableはtable内部scrollを許可する。

## D-014 — Mobile console navigation is a rail in the mock

**Decision:** 768px以下でsidebarをhorizontal railへ変形する。

**Reason:** mockで情報階層を検証しやすい最小構成。本番移植時は項目数・focus managementを見てaccessible drawerと比較する。

## D-015 — Important states live outside the normal mock viewport

**Decision:** Empty / Loading / Error / Disabled / Permission denied / Success等はState Labで確認する。

**Reason:** Normal画面に状態サンプルを混ぜてUIを汚さず、レビュー対象としては欠落させない。

## D-016 — No production Cloudflare action

**Decision:** Cloudflare production resourceはread-only確認のみ。deploy / secret / Remote D1変更は行わない。

**Reason:** UI mock作成にproduction mutationは不要で、AGENTS.mdの運用境界にも一致する。

## Open decisions before production migration

1. Manage/Admin mobile navigationをrailかdrawerのどちらに確定するか。
2. Public topの現行loop shelf interactionを次期UIでも維持するか、静的grid優先にするか。
3. Admin `Rules` をContentかSystemのどちらへ置くか。
4. Admin Events内のslots/staff routeを残しつつManageへのhandoffをどこまで強くするか。
5. Personal YouTube playlistをDashboard secondary sectionに統合するか、独立routeをnavigation上だけ隠すか。

いずれもroute/function削除ではなく、navigationとpresentationの決定として扱う。
