# 認証API設計 (`/api/auth/[...nextauth]`)

## 1. 役割
Discord OAuth を利用したログイン、セッション発行、ユーザー状態のセッション反映を行う。

## 2. 認証
- Auth.js を使用し、Discord Provider を基本ログイン手段とする。
- OAuth state と PKCE を有効化する。
- ログイン時に Discord ID、表示名、アバターを `user` に同期する。

## 3. セッション出力
- `session.user.id`
- `session.user.role`
- `session.user.accepted_terms_version_id`
- `session.user.terms_reaccept_required`
- `session.user.is_banned`
- `session.user.active_x_user_id`

## 4. エラー
- OAuth 失敗時はログイン画面へ戻し、再試行導線を表示する。
- BAN、規約再同意が必要な状態、ギルド未参加などは個別の説明画面または投稿前の再同意導線へ誘導する。

## 5. 監査
- 初回ログイン、再ログイン、BAN ユーザーのアクセス試行を履歴またはセキュリティログへ記録する。
