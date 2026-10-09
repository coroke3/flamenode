# FlameNode UI コンポーネント移植・Next.js 脱却ガイドライン

> Status: Active / UI migration architecture guide
> Last updated: 2026-10-09

## 1. 概要と課題認識

現行コードベース（`src/` 配下）では、Next.js 固有の API に依存しているファイルが多数存在します：
- `next/link`, `next/image`, `next/navigation` のインポート: **196ファイル**
- CSS Modules (`*.module.css`): **70ファイル**

移行先では、以下の3つの異なるランタイム環境で UI を稼働させる必要があります：
1. **`apps/site`**: Astro による SSG + React Islands
2. **`apps/app`**: Vite + React Router による SPA
3. **現行 Next.js (`src/`)**: 段階移行中の並行稼働（ロールバック対象）

これらを両立しつつ、`packages/ui` を「フレームワーク非依存の純粋 React コンポーネント集」として安全に抽出するための統一設計パターンを定めます。

---

## 2. プラットフォーム非依存アダプターアーキテクチャ (`@flamenode/ui`)

`packages/ui` では、フレームワーク依存 API（ルーティング、画像最適化）を抽象化するアダプターを提供します（[`packages/ui/src/adapters/index.tsx`](../../packages/ui/src/adapters/index.tsx)）。

### 2.1 Link コンポーネント (`Link`)
- **デフォルト挙動**: 通常の `<a href="..." {...props}>` として動作（Astro SSG や静的プレビューでそのまま機能）。
- **SPA 向け注入**: `apps/app` では初期化時に `react-router-dom` の `Link` を `setLinkComponent` に注入。
  ```tsx
  import { setLinkComponent } from "@flamenode/ui";
  import { Link as RouterLink } from "react-router-dom";

  setLinkComponent(({ href, ...props }) => <RouterLink to={href} {...props} />);
  ```
- **移行手順**: コンポーネント内の `import Link from 'next/link'` を `import { Link } from '@flamenode/ui'` に置換するだけで、全ランタイムで動作可能になります。

### 2.2 Image コンポーネント (`Image`)
- **デフォルト挙動**: 標準の `<img src="..." alt="..." style={...} />` として動作。`fill`, `priority` などの主要 props を CSS `object-fit: cover` 等へ安全にフォールバック。
- **SPA / Astro 向け拡張**: 必要に応じて Cloudflare Images やカスタムローダーを `setImageComponent` に注入可能。
- **移行手順**: `import Image from 'next/image'` を `import { Image } from '@flamenode/ui'` に置換。

### 2.3 Navigation フック (`useNavigateAdapter`)
- **デフォルト挙動**: `window.location`（ブラウザ標準）を利用した `push`, `replace`, `back`。
- **SPA 向け注入**: `apps/app` で `react-router-dom` の `useNavigate` をラッパーして注入。
  ```tsx
  import { setNavigatorAdapter } from "@flamenode/ui";
  import { useNavigate } from "react-router-dom";

  // App 初期化時
  const navigate = useNavigate();
  setNavigatorAdapter({
    push: (href) => navigate(href),
    replace: (href) => navigate(href, { replace: true }),
    back: () => navigate(-1),
  });
  ```
- **移行手順**: `useRouter` や `usePathname` の依存を `useNavigateAdapter` または props / URL パラメータ受け渡しに切り替え。

---

**Adapter安全性**: `setLinkComponent` / `setNavigatorAdapter` のmodule-global setterは初期PoC用。SSRの複数request/React root混在やrouter外利用に対して安全ではない。Phase 4/7の本移行時はReact Provider/Context等でrootごとに注入し、画像の`fill`/`priority`/幅高さやprefetchの意味論はE2Eで比較する。単なる`next/image`→`img`の機械置換をparity合格と扱わない。

## 3. CSS Modules の移行方針

- **ネイティブサポート**: Vite (`apps/app`) および Astro (`apps/site`) は、標準で `*.module.css` を追加プラグインなしでネイティブ解釈・スコープ化します。
- **配置規約**:
  - 各コンポーネントに対応する `Foo.module.css` は、コンポーネントファイルと同階層に配置。
  - グローバルスタイル（リセットCSS、テーマ変数等）は `packages/ui/src/styles/globals.css` に集約。
- **バンドル再構築の不要化**:
  - コンポーネントが自身の `import styles from './Foo.module.css'` を保持したまま `packages/ui` へ移動可能。
  - `packages/ui/package.json` で `exports` に CSS ファイルを含めるか、パッケージビルド時にスタイルシートを結合出力します。

---

## 4. 同一ドメインにおける静的アセット衝突防止規約

同一ドメイン (`flamenode.net`) 配下で複数 Worker を同居させる際のパス分離ルール：

| アプリケーション | 担当領域 | 静的アセットパス | ルーティングルール |
| --- | --- | --- | --- |
| `flamenode-site` (Astro) | 公開閲覧画面 (SSG) | `/_astro/*` | `/`, `/:id`, `/event/*`, `/groups/*`, `/user/*`, `/list`, `/recommend`, `/trending` 等 |
| `flamenode-app` (Vite) | 管理・マイページ (SPA) | `/_app_assets/*` | `/dashboard/*`, `/entry/*`, `/manage/*`, `/admin/*`, `/onboarding` |
| `flamenode-api` (Hono) | バックエンド API | (静的アセットなし) | `/api/<移行済みの明示パス>` |
| `flamenode-web` (現行Next) | 移行中暫定フォールバック | `/_next/*`, `/static/*` | `/api/auth/*` (Phase 8まで), 未移行API/画面 |

- **衝突防止措置**: `apps/app/vite.config.ts` で `base: "/"`, `build.assetsDir: "_app_assets"` とし、同じSPAを `/dashboard`, `/entry`, `/manage`, `/admin`, `/onboarding` で配信する。アセットルーティングとrootパスでのSPA fallbackは統合テスト必須。プレフィックス分離だけでCache-Controlやアクセス制御を証明したとは扱わない。
