import React from "react";
import { ErrorCallout } from "@flamenode/ui";
import { SiteAdapterProvider } from "./SiteAdapterProvider.ts";

/**
 * Wrapper for React Islands on the Astro static site (MIG-0402).
 *
 * Use it inside a React component that Astro hydrates (`client:load`,
 * `client:visible`), never around children written in a `.astro` file: Astro
 * renders such children as a static `<astro-slot>`, so they are not hydrated
 * and do not see this provider or this boundary. See `ButtonIsland.ts`.
 *
 * The file is `.ts` with `React.createElement` (not `.tsx` as in the Work
 * Order) so that `node --test --experimental-strip-types` can load it.
 */

export const ISLAND_ERROR_MESSAGE = "この領域の読み込みに失敗しました。";

export interface IslandErrorBoundaryProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

interface IslandErrorBoundaryState {
  hasError: boolean;
}

export class IslandErrorBoundary extends React.Component<
  IslandErrorBoundaryProps,
  IslandErrorBoundaryState
> {
  state: IslandErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): IslandErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[IslandErrorBoundary]", error, errorInfo.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // Shared ErrorCallout (role=alert), styled by @flamenode/ui styles/components.css.
    return React.createElement(ErrorCallout, {
      message: ISLAND_ERROR_MESSAGE,
      className: "fn-island-error",
    });
  }
}

export interface IslandWrapperProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Gives one Island its own Context adapters (Link / Image / Navigator) and an
 * error boundary. A thrown error replaces only this Island; the static HTML
 * around it stays. The provider is outside the boundary so the fallback also
 * uses the site adapters.
 */
export function IslandWrapper({ children, fallback }: IslandWrapperProps): React.ReactElement {
  return React.createElement(
    SiteAdapterProvider,
    null,
    React.createElement(IslandErrorBoundary, { fallback }, children),
  );
}

export default IslandWrapper;
