# 実装レシピ（移行先コードの決まった形）

> Status: Active / 移行先コードの形の正本
> Last updated: 2026-10-15
> 使い方: 各 Work Order の `- **Recipe:**` 行が、この文書の節（`R-...`）を指す。`npm run migration:next` の packet にも該当節が入る。
> 優先順位: CURRENT の挙動・権限・可視性 > [`ZERO_1102.md`](ZERO_1102.md) の予算 > この文書の形 > [`CODE_QUALITY.md`](CODE_QUALITY.md) の一般規則。形が合わない場合は形を崩さず STOP し、lead がこの文書を直す。

この文書の目的は、どのモデルが書いても同じ形のコードになることである。小型モデルは、ここに無い構造（新しい層、共通基盤、汎用関数、設定項目）を作らない。

## 全レシピ共通

- 1 file = 1 つの責務。file 名は中身の domain 用語にする（`utils.ts`、`helpers.ts`、`common.ts` を作らない）。
- 呼び出し元が1つしかない抽象（interface、factory、registry、汎用関数、option 引数）を作らない。2つ目の呼び出し元が同じ意味で必要になったときに共通化する（[`CODE_QUALITY.md`](CODE_QUALITY.md) の「共通化」）。
- CURRENT で使われていない export・引数・分岐は移植しない。移す file に `node scripts/find-unused-exports.mjs <file>...` を実行して結果を PR に貼る（判定は [`CODE_QUALITY.md`](CODE_QUALITY.md) の「移行で守る簡潔さ」の 2）。
- 相対 import は拡張子 `.ts` / `.tsx` を付ける（Node の `--experimental-strip-types` は拡張子なしの相対 import を解決しない）。
- コメントは「なぜ」「不変条件」「platform の制約」「いつ消すか」だけ。コードを言い換えるコメントを書かない。
- test は `node:test` + `node:assert/strict` の `*.test.mjs`。`node --test --experimental-strip-types` で直接動く形にする。

## R-DOMAIN: CURRENT の判断ロジックを `packages/domain` へ移す

使う task: MIG-0301〜0306、0308。形は MIG-0301 の PoC（2026-10-15、本 PR で確認）で決めた。

配置:

```text
packages/domain/src/<area>/<name>.ts      ← 実装（CURRENT から意味を変えずに移す）
packages/domain/src/index.ts              ← export * from "./<area>/<name>.ts"; を1行ずつ
packages/domain/test/<name>.test.mjs      ← package 名で import する test
src/lib/<CURRENT path>.ts                 ← CURRENT の呼び出し元のための bridge（re-export だけ）
```

`packages/domain/package.json` の `exports` に、移した module を1行ずつ足す:

```json
"exports": {
  ".": "./src/index.ts",
  "./slots/reservationLimit": "./src/slots/reservationLimit.ts"
}
```

bridge（CURRENT 側。中身はこれだけ）:

```ts
export {
  MAX_SLOT_RESERVATIONS_PER_XID,
  normalizeSlotReservationLimit,
  slotReservationLimitMessage,
} from "@flamenode/domain/slots/reservationLimit";
```

test:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSlotReservationLimit } from "@flamenode/domain/slots/reservationLimit";

test("normalizeSlotReservationLimit clamps to 0..100", () => {
  assert.deepEqual([null, -1, 2.9, 150, NaN].map(normalizeSlotReservationLimit), [0, 0, 2, 100, 0]);
});
```

確認済みの解決経路（PoC）: `node --test --experimental-strip-types`（package の self-reference と workspace の symlink）、root の `tsc --noEmit`、`packages/domain` の `tsc`（`rewriteRelativeImportExtensions: true` で `.ts` → `.js` に書き換えて emit）、`next build` の compile。

禁止: `packages/domain` から `next/*`、`react`、`hono`、`astro`、`server-only`、`@/...`、`src/...` を import しない。DB が必要な関数は、引数で DB を受け取る（Tier 2。MIG-0308 の後）。

DONE に足す項目: 既存 test が移動前と同じ件数 PASS / 移した関数の挙動を変えていない（diff は移動と bridge だけ）。

Runtime: `N`（domain 自体は実行種別を持たない。呼び出す側の予算に入る）。

## R-API: Hono の API を1つ足す

使う task: MIG-0601〜0605、0608、0802、0803。形は 2026-10-15 に hono 4.13.13 + `@cloudflare/workers-types` で typecheck と `node:test` を確認した。

配置:

```text
apps/api/src/env.ts                 ← AppEnv（Bindings / Variables の型）。1つだけ
apps/api/src/app.ts                 ← route をまとめる。export const app
apps/api/src/index.ts               ← export default app（Worker の入口）
apps/api/src/routes/<resource>.ts   ← resource ごとに1 file
apps/api/test/<resource>.test.mjs   ← app.request() で叩く
```

`apps/api/src/types/hono.d.ts`（手書きの型 shim。`any` を返す）は本物の hono の型を隠すので、MIG-0601 で削除する。

route の形（参照系 `S2`）:

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";

const MAX_EVENTS_PER_PAGE = 50;

export const eventRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? MAX_EVENTS_PER_PAGE), MAX_EVENTS_PER_PAGE);
  if (!Number.isInteger(limit) || limit < 1) return c.json({ error: "invalid_limit" }, 400);
  const { results } = await c.env.DB
    .prepare("SELECT id, title FROM events ORDER BY id LIMIT ?")
    .bind(limit)
    .all<{ id: string; title: string }>();
  return c.json({ events: results });
});
```

handler の中の順番は固定: 1. 入力の検証（`packages/contracts` の schema）→ 2. session 解決（`S4`、MIG-0608）→ 3. 権限判定（`packages/domain`）→ 4. D1（`LIMIT` 付き）→ 5. DTO へ詰め替え → 6. `c.json`。更新系（`S3`）は 4 を `batch` 1回にし、波及は Queue へ enqueue するだけにする。公開ページに出るデータを変える更新は、同じ `batch` に `UPDATE public_build_state SET requested_at = ? WHERE id = 1` を1つ足す（build 要求の記録。MIG-0410、D-09）。非公開への切替は、さらに gateway の拒否 entry を同じ request の中で書く（MIG-0409 で決める形）。

error の返し方は CURRENT の Server Action / Route Handler の結果に合わせる（[`server-actions/README.md`](server-actions/README.md)、[`route-handlers/README.md`](route-handlers/README.md)）。共通の error 変換 module は、2つ目の route が同じ変換を必要としたときに `apps/api/src/http/errors.ts` として作る。

test の形（D1 は `node:sqlite` の偽物で足りる）:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";

const fakeD1 = (sqlite) => ({
  prepare: (sql) => ({ bind: (...params) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...params) }) }) }),
});

test("GET /api/events caps the page size", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE events (id TEXT, title TEXT)");
  for (let i = 0; i < 60; i++) db.prepare("INSERT INTO events VALUES (?, ?)").run(String(i), "e" + i);
  const res = await app.request("/api/events?limit=999", {}, { DB: fakeD1(db) });
  assert.equal((await res.json()).events.length, 50);
});
```

test に必ず入れるもの: 未ログイン / 権限なし / 他人の resource / 上限ちょうど / 上限超え / 不正入力 / CURRENT と同じ成功結果。

注: 上の `c.env.DB.prepare(...)` は最小の例で、raw D1 を必須にするものではない。監査・transaction・wake を伴う更新は、`packages/server-core`（R-CORE、D-10）の関数に drizzle handle（`drizzle(c.env.DB, { schema })`）と ports を渡して呼んでよい。その場合も handler の順番、`LIMIT`、`c.env` 以外から binding を読まない規則は同じ。

禁止: handler の中で HTML を作る、`LIMIT` の無い query、上限の無い `JSON.parse`、request 中の再生成・通知送信、`c.env` 以外から binding を読む。

DONE に足す項目: [`ZERO_1102.md`](ZERO_1102.md) §5 の計測（MIG-0606 の harness ができる前は「未計測」と書く）/ CURRENT の Server Action と同じ入力で同じ結果になる test。

Runtime: 参照 `S2`、更新 `S3`、session `S4`。

## R-CORE: CURRENT の server 処理を `packages/server-core` へ移す

使う task: MIG-0612〜0618。決定は [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) D-10。R-DOMAIN の server 版で、D1 を引数の drizzle handle として受け取り、transaction・監査・enqueue を含められる点だけが違う。

配置:

```text
packages/server-core/src/<area>/<name>.ts      ← 実装（CURRENT から意味を変えずに移す）
packages/server-core/src/ports.ts              ← 注入する型（env の値、Queue、KV、waitUntil、R2、edge cache、Clock、rethrow）
packages/server-core/package.json              ← exports に移した module を1行ずつ足す（R-DOMAIN と同じ）
packages/server-core/test/<name>.test.mjs      ← package 名で import する test
src/lib/<CURRENT path>.ts                      ← bridge（re-export だけ。呼び出し側は変えない）
src/lib/serverCore/nextPorts.ts                ← Next 側の ports 供給（getEnv / getCloudflareContext を読んでよい唯一の場所）
```

規則:

- D1 は `DrizzleD1Database` を引数で受け取る。module の中で binding・env・request context を取得しない。`getDb` / `getEnv` / `getCloudflareContext` / `process.env` / `server-only` を書かない。
- 外部の資源（Queue、KV、R2、cache、`waitUntil`、`unstable_rethrow`）は `ports.ts` の型の引数で受ける。Next の bridge が既存の関数と同じ signature で ports を埋めるので、呼び出し側（81 箇所の `mutateWithAudit` など）は変えない。
- 順序・strict / CAS の意味・SQL 文と bind の並びを変えない。移動前に golden test（batch の SQL 文字列 + params と `audit_logs` の行。`id` / `created_at` を除く）を commit し、移動後に byte 単位で一致させる。
- `revalidatePath` / `revalidateTag` は core に入れない（Next の Server Action に残す）。`src/lib/publicData/loader.ts` は移さない。
- test は `node --test --experimental-strip-types` か、CURRENT の test と同じ起動方法（tsx）。移した test の件数が移動前と同じであること。

検査: `node scripts/check-server-core-boundaries.mjs`（禁止 import と `process.env` / `getCloudflareContext` の参照）。`node scripts/find-unused-exports.mjs <file>` で `UNUSED` / `TEST_ONLY` を移さない。

禁止: ports を介さない ambient な env 参照、`packages/domain` / `packages/db` から `@flamenode/server-core` への import、call site の変更を伴う signature の変更、挙動を変える改善（PR に proposal として書く）。

Runtime: 呼び出す側の予算に入る（`S3` の更新では「D1 は事前読み3つまで + `batch` 1回」を core が守る）。

## R-PAGE: 公開ページを Astro の静的ページにする

使う task: MIG-0403、0501〜0507。

配置:

```text
apps/site/src/pages/<CURRENT と同じ URL>.astro   ← 動的 segment は getStaticPaths
apps/site/src/lib/publicDataLoader.ts           ← build 時のデータ（MIG-0401 が作る）
apps/site/src/components/<Name>.astro           ← そのページだけの部品
packages/ui/src/...                              ← 複数ページで使う部品（R-UI）
```

形:

- データは frontmatter（`---` の中）で build 時に読む。`export const prerender = false` を書かない（書くと request 時の描画になる）。
- 動きが必要な部分だけを React の Island にし、`client:visible` か `client:idle` を付ける。`client:load` はファーストビューで操作が必要な部品だけ。
- 本人の状態（ログイン、予約済み、いいね）は HTML に焼かず、Island から API（`S2`）で取る。
- build の間隔より速く変わる値（枠の空き、いいね数など。MIG-0409 の分類表で「API」とした項目）も HTML に焼かず、Island から API で取る（D-09）。
- 作品・ユーザー・イベントの個別ページは `getStaticPaths` で全件を出さず、MIG-0411 の Queue が1件ずつ R2 HTML にする（ISR 相当、D-09 の 2026-10-16 改訂）。ページの component は build と Queue の両方から同じものを使う。
- URL・query・redirect・404 は CURRENT と同じにする（[`ROUTE_MATRIX.md`](ROUTE_MATRIX.md)）。

test に必ず入れるもの: build 出力にページの file がある / 非公開の fixture のページが出力されない / CURRENT と同じ title・canonical・OGP / query 付き URL の挙動。

禁止: request 時の描画、ページの中で D1 を読む、mock に無い見た目を作る（D-08）。

Runtime: `S0`（ゲートウェイを通る URL は `S1` も）。

## R-UI: 共有 UI 部品（`packages/ui`）

使う task: MIG-0202〜0205、0402。

- 1 component = 1 file（`packages/ui/src/components/<Name>.tsx`）。props は型で書き、既定値は引数の分割代入で付ける。
- 色・余白・文字は `packages/ui/src/styles/tokens.css`（MIG-0201）の CSS 変数だけを使う。固定の色や px を書かない（mock の例外は [`UI_REFERENCE.md`](UI_REFERENCE.md) に従う）。
- module の top-level に可変の状態を置かない（`packages/ui/src/adapters/index.tsx` の setter は MIG-0203 で Context に置き換える）。
- a11y: button は `type` を明示、アイコンだけの操作は `aria-label`、無効は `disabled` 属性、処理中は `aria-busy="true"`。
- test の実行経路は MIG-0202 U01 で決め、決めたらこの節に追記する。

Runtime: `N`（Island として動くときも browser で動き、Worker の予算に入らない）。

## R-SCREEN: 非公開画面を Vite SPA（`apps/app`）へ移す

使う task: MIG-0701〜0705。

- 画面は `apps/app/src/screens/<Name>.tsx`。データは `fetch` で Hono API を呼び、応答は `packages/contracts` の schema で検証する。
- 権限の判定は API が行う。画面の表示切り替えは見た目だけで、認可にしない（[`CODE_QUALITY.md`](CODE_QUALITY.md) の Permissions）。
- 見た目は CURRENT の UI を移す（非公開画面は CURRENT_UI_REUSE。[`UI_REFERENCE.md`](UI_REFERENCE.md)）。
- 状態管理の library を足さない。React の state と URL の query で足りない場合は STOP。

Runtime: `N`（画面）。呼ぶ API は R-API の予算。

## R-GATEWAY: 公開ゲートウェイ（薄い Worker）

使う task: MIG-0405、0507。

- Worker の `fetch` は「URL → manifest で可視性と HTML の場所を引く → 返す / 404」だけにする。HTML は作らない。
- manifest は build 時（MIG-0404）に作った、件数と byte に上限のあるデータ。request ごとに全体を `JSON.parse` しない（module scope で1回読むか、分割した key を1つ読む）。
- 不明・非公開・manifest の欠落は 404（fail-closed）。D1 は読まない。
- build の後に非公開へ変わったものは、manifest ではなく拒否 entry（更新 API が書く KV の key）で止める。読むのは request ごとに KV 1回まで（D-09）。
- test: 公開 / 非公開 / 不明 / alias / manifest 欠落 / 古い HTML が残っている非公開 の6種を必ず入れる。

Runtime: `S1`。

## R-BUILD: build 時に動く生成処理

使う task: MIG-0201（tokens）、0401（public data）、0404（route map）、0406・0606・0609（計測 script）、0409・0509（D1 から公開データを作る）。

- 純粋関数（入力 → 出力）と、file を読み書きする薄い CLI に分ける。test は純粋関数に対して書く。
- 出力は決定的にする（key の順序を固定、日時を埋め込まない）。同じ入力から同じ byte が出ることを test で確認する。
- 出力の件数と byte を記録し、上限を名前付き定数で持つ（Static Assets は1 version 20,000 files まで。D-06）。

Runtime: `N`。

## R-JOB: 背景処理（Queue consumer / Cron）を1回 8ms 未満にする

使う task: MIG-0410（deploy hook を呼ぶ Cron）、0411（個別ページの R2 HTML 生成）、0610（残る job の分割）。

- 公開データ（一覧、検索索引、JSON artifact）を作らない。それは build 時（R-BUILD、D-09）。
- 仕事の正本は D1 の行にする。Queue の message は「仕事がある」と知らせるだけで、中身を運ばない（[`background-jobs/README.md`](background-jobs/README.md) の最重要原則）。
- 1回の処理量を `MAX_` で始まる名前付き定数で決める（例: `MAX_NOTIFICATIONS_PER_RUN`）。D1 の statement 数、外部 API の呼び出し数、扱う byte のすべてに上限を付ける。残りは D1 に残し、続きの message を1つ enqueue して返す。
- 1つの job = 1つの file。中身は「D1 から上限件数を読む → 純粋関数で決める → D1 に書く・外部へ送る」の順に並べる。判断は純粋関数に分け、test はそれに対して書く。
- 予算は invocation 1回の合計で判定する。Cron 1回の中で複数の job を順に動かすと合計になるので、Cron は job ごとの doorbell を enqueue するだけにする（例外は MIG-0410 の build 要求の確認のような D1 1〜2 statement の処理）。Queue consumer は batch 全体が1回の invocation なので、`max_batch_size` × 1件の最大 CPU < 8ms にする（CURRENT は 10。`workers/*/wrangler.toml`）。
- Cron Trigger は Free で account あたり 5個まで（CURRENT は content 1・fast 1・sync 2 の計4個）。新しい cron 式を足さず、既存の Cron の中で doorbell を増やす。出典: https://developers.cloudflare.com/workers/platform/limits/
- 同じ message が2回届いても結果が同じになるようにする（D1 の条件付き UPDATE と `changes()` の確認で二重処理を防ぐ）。
- 上限の値は推測で決めない。MIG-0609 の計測で、1件あたりの CPU から「上限ちょうどの入力で最大値 < 8ms」になる値を計算し、その計算を定数の上に1行で書く。
- test: 0件 / 上限ちょうど / 上限 + 1（続きが enqueue される）/ 同じ message の2回目 / 外部 API の失敗 の5種を必ず入れる。

Runtime: `B`。

## R-TEST: CURRENT の挙動を test で固定する

使う task: MIG-0801。

- CURRENT のコードは変えない。test と fixture だけを足す。
- fixture に実 token、secret、実在の利用者の情報を入れない。
- 1 test = 1 つの挙動。test 名に挙動を書く（例: `expired session resolves to signed-out`）。

Runtime: `N`。

## R-EVIDENCE: Gate・計測・レビュー・文書だけの task

使う task: Phase Gate（MIG-0206、0307、0407、0508、0607、0706、0806、0906）、MIG-0804（review）、0805（切替の提案）、0902（観測）、0905（文書の整理）。

- 実装コードを書かない（計測の script は R-BUILD）。証跡（merge 済み PR、CI の URL、計測値、レビュー）を文書に集め、未達の項目をそのまま書く。
- 数値は実測だけ。本番の値と非本番の値を分けて書く。
- Gate と本番操作の承認はユーザーだけが行う。agent は「承認待ち」で止まる。

Runtime: `N`。

## R-REMOVE: 旧コードを消す

使う task: MIG-0901（消す前の棚卸し）、0903、0904、0907。

- 消す前に `rg` で呼び出し元が 0件であることを示し、結果を PR に貼る。
- 1 PR で消すのは1系統（例: ある Server Action の群）。消した結果 test が減る場合は、TARGET 側に同じ挙動の test があることを示す。

Runtime: `N`。
