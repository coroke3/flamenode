# Discord Webhook API設計 (`/api/webhooks/discord`)

## 1. 役割
Discord からのメンバー状態更新、通知応答、ギルド関連イベントを受け取る。

## 2. 署名検証
- `X-Signature-Ed25519` と `X-Signature-Timestamp` を必須とする。
- Discord 公開鍵で Ed25519 署名を検証する。
- 署名不正または欠落時は 401 を返す。

## 3. 入力
- Discord Interaction または guild member update 相当の JSON。
- イベント種別ごとに処理を分岐し、未知のイベントは成功応答のみで無視できる。

## 4. 出力
- 正常受信時は `{ success: true }`。
- 設定不備は 500、署名不正は 401、処理不能な入力は 400。

## 5. 監査
- 受信イベント種別、Discord ID、処理結果、失敗理由を記録する。
