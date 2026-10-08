# FlameNode Phase 1 タスク仕様書 & デザイン適用戦略

> 状態: Active / Phase 1 実行向け詳細仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md), [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)

このドキュメントは、**Luna や Flash などの軽量モデルでも一切迷わずに実装できるよう、各タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書**である。

---

# 1. デザイン入れ替えの最適タイミング戦略

### 前提方針: 現行デザイン（CURRENT UI）の使い回しを最優先
ロジック・フレームワーク移行（Next.js 脱却 → Astro/Vite/Hono）とデザイン全面刷新（CSS/マークアップ変更）を同時に行うと、不具合の原因切り分けが困難になり、既存 432 件の UX 挙動を損なうリスクがある。
したがって、**移行初期〜中期は現行の React コンポーネントおよび CSS を `packages/ui` へ移植してそのまま使い回す方針**が最も安全である。

### デザイン刷新の適切な 2 つのタイミング

```text
【移行工程】
Phase 0 (棚卸し) ──> Phase 1 (境界スケルトン) ──> Phase 3 (ドメイン分離)
                                                         │
               ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
               ▼                                                                                    ▼
【タイミング案 A: 公開画面移行時】（推奨）                                   【タイミング案 B: 全画面移行完了後】（最安全）
Phase 4 (Public PoC) / Phase 5 (Public 移行) の着手時に                       全ルートを現行デザインのまま Astro + Vite + Hono へ
HTML モックを適用して新デザインで構築。                                      完全移行・安定稼働（1102 解消）させた後、
管理画面（Phase 7）は現行デザインをそのまま使い回す。                       `packages/ui` を HTML モックのデザインに一括差し替え。
```

| パターン | タイミング | メリット | デメリット・留意点 |
| --- | --- | --- | --- |
| **案 A（推奨）** | **Phase 4 (Public PoC) 〜 Phase 5 (Public 移行)** | 公開閲覧画面（トップ・動画詳細・イベント）という最もデザイン刷新の恩恵が大きい画面を最初から新デザインで提供できる。管理画面は現行流用で工数を抑えられる。 | HTML モックの提供が Phase 4 着手前までに必要。 |
| **案 B（最安全）** | **全フェーズ移行完了後（Phase 9 以降）** | フレームワーク移行の安定性を完全に確認してから見た目だけを安全に差し替えられる。バグの原因切り分けが最も容易。 | 一旦現行デザインを新環境で動かすための移植工数が二重に発生する。 |

---

# 2. Phase 1 タスク別詳細仕様書（Zero-Ambiguity Spec）

各エージェント（特に Luna / Flash）は、担当するタスクの仕様をそのまま適用すること。

---

### MIG-0012: Phase 0 Gate（完了判定）

- **目的**: Phase 0（棚卸し・台帳統合・不整合解消）の全条件が満たされたことを確認し、Phase 1 をアンブロックする。
- **作業内容**:
  1. `docs/migration/STATUS.md` を更新:
     - `Current Phase: 1 — Repository boundaries`
     - `Current Task: MIG-0101`
     - `MIG-0012` の状態を `READY` から `DONE` へ変更
     - `MIG-0101` の状態を `BLOCKED` から `READY` へ変更
     - Phase 0 Gate の State を `CLOSED` から `OPEN`（または `PASSED`）へ変更
- **検証コマンド**:
  ```bash
  node scripts/check-migration-docs.mjs
  npm run test:unit
  ```

---

### MIG-0101: workspace/boundary PoC design（モノレポ境界設計）

- **目的**: npm workspaces をルート `package.json` に設定し、パッケージ間の依存解決と TypeScript paths の基盤を作る。
- **編集ファイル**:
  1. `package.json` (ルート):
     ```json
     {
       "workspaces": [
         "packages/*",
         "apps/*"
       ]
     }
     ```
  2. `tsconfig.base.json` (ルート新規作成):
     ```json
     {
       "compilerOptions": {
         "target": "ES2022",
         "module": "ESNext",
         "moduleResolution": "bundler",
         "esModuleInterop": true,
         "strict": true,
         "skipLibCheck": true,
         "declaration": true,
         "declarationMap": true,
         "sourceMap": true
       }
     }
     ```
- **禁止事項**: 既存の `src/` や `app/`、既存スクリプトを壊さないこと。
- **検証コマンド**:
  ```bash
  npm run typecheck
  node scripts/check-migration-docs.mjs
  ```

---

### MIG-0102: `packages/ui` skeleton

- **目的**: フレームワーク非依存（Next.js/Hono/Astro 非依存）の共有 React コンポーネント用パッケージの雛形を作成する。
- **作成ファイル**:
  1. `packages/ui/package.json`:
     ```json
     {
       "name": "@flamenode/ui",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "main": "./dist/index.js",
       "types": "./dist/index.d.ts",
       "scripts": {
         "build": "tsc",
         "typecheck": "tsc --noEmit"
       },
       "peerDependencies": {
         "react": "^18.3.1 || ^19.0.0",
         "react-dom": "^18.3.1 || ^19.0.0"
       },
       "devDependencies": {
         "@types/react": "^18.3.0",
         "@types/react-dom": "^18.3.0",
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `packages/ui/tsconfig.json`:
     ```json
     {
       "extends": "../../tsconfig.base.json",
       "compilerOptions": {
         "jsx": "react-jsx",
         "outDir": "./dist",
         "rootDir": "./src"
       },
       "include": ["src/**/*"]
     }
     ```
  3. `packages/ui/src/index.ts`:
     ```typescript
     export * from "./components/Button";
     ```
  4. `packages/ui/src/components/Button.tsx`:
     ```tsx
     import React from "react";

     export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
       variant?: "primary" | "secondary";
     }

     export function Button({ variant = "primary", children, ...props }: ButtonProps) {
       return (
         <button data-variant={variant} {...props}>
           {children}
         </button>
       );
     }
     ```
- **禁止事項**:
  - `next/*` (例: `next/link`, `next/navigation`, `next/image`) のインポート禁止。
  - `"use server"`、Server Actions の定義禁止。
  - D1, R2, KV 等のバックエンドリソースへの直接アクセス禁止。
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/ui typecheck
  ```

---

### MIG-0103: `packages/contracts` skeleton

- **目的**: API リクエスト/レスポンス、公開データ DTO、ドメイン間で共有する Zod スキーマ・型定義パッケージの雛形を作成する。
- **作成ファイル**:
  1. `packages/contracts/package.json`:
     ```json
     {
       "name": "@flamenode/contracts",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "main": "./dist/index.js",
       "types": "./dist/index.d.ts",
       "scripts": {
         "build": "tsc",
         "typecheck": "tsc --noEmit"
       },
       "dependencies": {
         "zod": "^3.23.0"
       },
       "devDependencies": {
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `packages/contracts/tsconfig.json`:
     ```json
     {
       "extends": "../../tsconfig.base.json",
       "compilerOptions": {
         "outDir": "./dist",
         "rootDir": "./src"
       },
       "include": ["src/**/*"]
     }
     ```
  3. `packages/contracts/src/index.ts`:
     ```typescript
     export * from "./video";
     ```
  4. `packages/contracts/src/video.ts`:
     ```typescript
     import { z } from "zod";

     export const VideoSummaryDtoSchema = z.object({
       id: z.string(),
       title: z.string(),
       youtubeId: z.string().nullable(),
       creatorXName: z.string(),
       visibilityStatus: z.enum(["public", "unlisted", "private", "voided"]),
     });

     export type VideoSummaryDto = z.infer<typeof VideoSummaryDtoSchema>;
     ```
- **禁止事項**: UI コンポーネント、フレームワーク依存コードの混入禁止。
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/contracts typecheck
  ```

---

### MIG-0104: `packages/domain` skeleton

- **目的**: 純粋なビジネスロジック、権限判定、バリデーション等を管理するフレームワーク非依存パッケージの雛形を作成する。
- **作成ファイル**:
  1. `packages/domain/package.json`:
     ```json
     {
       "name": "@flamenode/domain",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "main": "./dist/index.js",
       "types": "./dist/index.d.ts",
       "scripts": {
         "build": "tsc",
         "typecheck": "tsc --noEmit"
       },
       "dependencies": {
         "@flamenode/contracts": "*"
       },
       "devDependencies": {
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `packages/domain/tsconfig.json`:
     ```json
     {
       "extends": "../../tsconfig.base.json",
       "compilerOptions": {
         "outDir": "./dist",
         "rootDir": "./src"
       },
       "include": ["src/**/*"]
     }
     ```
  3. `packages/domain/src/index.ts`:
     ```typescript
     export * from "./permissions";
     ```
  4. `packages/domain/src/permissions.ts`:
     ```typescript
     export function canEditVideo(params: {
       isOwner: boolean;
       isCollabEditor: boolean;
       isEventStaff: boolean;
     }): boolean {
       return params.isOwner || params.isCollabEditor || params.isEventStaff;
     }
     ```
- **禁止事項**: Next.js / Astro / Hono のリクエストオブジェクトや Cookie、ブラウザ API のインポート禁止。
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/domain typecheck
  ```

---

### MIG-0105: `apps/site` Astro skeleton（公開画面）

- **目的**: 公開閲覧用の Astro SSG プロジェクト雛形を作成する。
- **作成ファイル**:
  1. `apps/site/package.json`:
     ```json
     {
       "name": "@flamenode/site",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "scripts": {
         "dev": "astro dev",
         "build": "astro build",
         "preview": "astro preview",
         "typecheck": "astro check"
       },
       "dependencies": {
         "@flamenode/contracts": "*",
         "@flamenode/ui": "*",
         "@astrojs/react": "^4.2.0",
         "astro": "^5.0.0",
         "react": "^19.0.0",
         "react-dom": "^19.0.0"
       }
     }
     ```
  2. `apps/site/astro.config.mjs`:
     ```javascript
     import { defineConfig } from "astro/config";
     import react from "@astrojs/react";

     export default defineConfig({
       output: "static",
       integrations: [react()],
     });
     ```
  3. `apps/site/src/pages/index.astro`:
     ```astro
     ---
     import { Button } from "@flamenode/ui";
     ---
     <html lang="ja">
       <head>
         <meta charset="utf-8" />
         <title>FlameNode Site</title>
       </head>
       <body>
         <h1>FlameNode Public SSG</h1>
         <Button client:load variant="primary">疎通確認</Button>
       </body>
     </html>
     ```
- **禁止事項**: リクエスト時 SSR（`output: "server"`）の設定禁止。
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/site build
  ```

---

### MIG-0106: `apps/app` React/Vite skeleton（管理・プライベート画面）

- **目的**: 管理画面・マイページ用の React + Vite SPA プロジェクト雛形を作成する。
- **作成ファイル**:
  1. `apps/app/package.json`:
     ```json
     {
       "name": "@flamenode/app",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "scripts": {
         "dev": "vite",
         "build": "tsc && vite build",
         "preview": "vite preview"
       },
       "dependencies": {
         "@flamenode/contracts": "*",
         "@flamenode/ui": "*",
         "react": "^19.0.0",
         "react-dom": "^19.0.0",
         "react-router-dom": "^7.0.0"
       },
       "devDependencies": {
         "@vitejs/plugin-react": "^4.3.0",
         "vite": "^6.0.0",
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `apps/app/vite.config.ts`:
     ```typescript
     import { defineConfig } from "vite";
     import react from "@vitejs/plugin-react";

     export default defineConfig({
       plugins: [react()],
       base: "/dashboard/",
     });
     ```
  3. `apps/app/index.html`:
     ```html
     <!DOCTYPE html>
     <html lang="ja">
       <head>
         <meta charset="UTF-8" />
         <title>FlameNode App</title>
       </head>
       <body>
         <div id="root"></div>
         <script type="module" src="/src/main.tsx"></script>
       </body>
     </html>
     ```
  4. `apps/app/src/main.tsx` & `apps/app/src/App.tsx`: React Router のエントリーポイント。
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/app build
  ```

---

### MIG-0107: `apps/api` Hono skeleton（API層）

- **目的**: Cloudflare Workers 上で動作する Hono API サーバー雛形を作成する。
- **作成ファイル**:
  1. `apps/api/package.json`:
     ```json
     {
       "name": "@flamenode/api",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "scripts": {
         "typecheck": "tsc --noEmit"
       },
       "dependencies": {
         "@flamenode/contracts": "*",
         "@flamenode/domain": "*",
         "hono": "^4.6.0"
       },
       "devDependencies": {
         "@cloudflare/workers-types": "^4.20250109.0",
         "typescript": "^5.7.0"
       }
     }
     ```
  2. `apps/api/src/index.ts`:
     ```typescript
     import { Hono } from "hono";

     const app = new Hono();

     app.get("/health", (c) => {
       return c.json({ status: "ok", timestamp: Date.now() });
     });

     export default app;
     ```
- **検証コマンド**:
  ```bash
  npm run --workspace=@flamenode/api typecheck
  ```

---

### MIG-0108: Phase 1 Gate（境界疎通検証）

- **目的**: 全パッケージ・アプリのスケルトンが正しく配置され、型チェックとビルドが全体で成立することを確認する。
- **判定基準**:
  - `packages/*` (`ui`, `contracts`, `domain`) の型チェックとビルドが成功すること
  - `apps/*` (`site`, `app`, `api`) のスケルトンが独立してビルドできること
  - 既存の Next.js 本番コード（`npm run typecheck`, `npm run test:unit`）に一切影響を与えていないこと
- **作業内容**:
  - `docs/migration/STATUS.md` の Phase 1 を `DONE` に更新
  - Phase 1 Gate を `OPEN` / `PASSED` に更新
- **検証コマンド**:
  ```bash
  npm run typecheck
  node scripts/check-migration-docs.mjs
  npm run test:unit
  ```
