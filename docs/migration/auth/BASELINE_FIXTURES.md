# Auth baseline (MIG-0801)

> Work Order: `MIG-0801` in `PHASE_8_9_SPEC.md`
> Test: `src/lib/auth/authBaseline.characterization.test.mjs`
> Fixture: `src/lib/auth/authBaseline.fixture.mjs`（合成データと、記録した Set-Cookie）

## 測り方

テストは CURRENT の `buildAuthConfig()`（`src/lib/auth/index.ts`）を `@auth/core` の `Auth()` にそのまま渡し、`https://flamenode.example` 宛ての Request を送る。D1 は `migrations/0000_flame_node_baseline.sql` を流した in-memory SQLite。`@opennextjs/cloudflare` だけを差し替え、secret はすべて `synthetic-` で始まる偽値。auth のロジックはテスト側で書き直していないので、CURRENT が変わればテストが落ちる（`redirect` の既定先と `session` callback の `is_banned` を書き換えると T03 と U02 が落ちることを確認済み）。

## Cookie（https, next-auth 5.0.0-beta.32 / @auth/core 0.41.3, `cookies` の上書き無し）

| 場面 | Cookie | 属性 |
| --- | --- | --- |
| `GET /api/auth/csrf` | `__Host-authjs.csrf-token` | `HttpOnly; Path=/; SameSite=Lax; Secure`（Expires 無し） |
| `GET /api/auth/session`（有効な session） | `__Secure-authjs.session-token` | `HttpOnly; Path=/; SameSite=Lax; Secure; Expires=約30日後`（読むたびに延長） |
| `POST /api/auth/signout` | `__Secure-authjs.session-token` | 値は空、`Max-Age=0; HttpOnly; Path=/; SameSite=Lax; Secure`。D1 の session 行も消える |

## Session の解決（`GET /api/auth/session`）

| 入力 | CURRENT の結果 |
| --- | --- |
| 有効な session | `user.id`, `role`, `is_banned`, `active_x_user_id` が D1 の user 行から入る |
| 期限切れ | `null`。session cookie を空にし、D1 の行を消す |
| D1 に無い token | `null` |
| BAN された user | session は返る（`is_banned: 1`）。拒否は route 側（`routeGuard` など）で行う |
| X が0件 / 複数 | `active_x_user_id` は user 行の値そのまま（0件なら `null`） |

## Discord 連携（`linkDiscordAccountAtomically` を実 D1 で実行）

- 別の user が持つ Discord ID を連携すると `AUTH_DISCORD_ID_CONFLICT`。
- 同じ user への再連携は成功し、account 行は増えない。
- token を保存しない、audit と通知の扱いは既存の `accountLinkAdapter.execution.test.mjs` が固定している。

## Redirect callback

- `/` で始まる path は auth origin に連結（query も保持）。
- 同じ origin の絶対 URL はそのまま。
- 別 host、`https://flamenode.example.evil.example/` のような偽装、`javascript:` は `/dashboard`。
- `//evil.example/x` は `/` で始まるので `https://flamenode.example//evil.example/x` になる。host は変わらないが、MIG-0802 で同じ挙動にするかは決めること。
