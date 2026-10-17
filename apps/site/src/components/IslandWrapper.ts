import React from "react";
import { SiteAdapterProvider } from "./SiteAdapterProvider.ts";

export interface IslandErrorBoundaryProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

interface IslandErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class IslandErrorBoundary extends React.Component<
  IslandErrorBoundaryProps,
  IslandErrorBoundaryState
> {
  constructor(props: IslandErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): IslandErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (typeof console !== "undefined" && console.error) {
      console.error("[IslandErrorBoundary] Caught error in Island:", error.message, errorInfo.componentStack);
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return React.createElement(
        "div",
        {
          className: "fn-island-error",
          role: "alert",
          style: {
            padding: "1rem",
            margin: "0.5rem 0",
            borderRadius: "0.375rem",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "#ef4444",
            fontSize: "0.875rem",
            border: "1px solid rgba(239, 68, 68, 0.2)",
          },
        },
        React.createElement("p", { style: { margin: 0 } }, "この領域の読み込みに失敗しました。")
      );
    }
    return this.props.children;
  }
}

export interface IslandWrapperProps {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
}

/**
 * IslandWrapper integrates React Islands inside Astro static pages.
 * It provides Context-based UI adapters (SiteAdapterProvider) and an Error Boundary
 * so that any client-side exception in the Island does not collapse or hide the surrounding static HTML.
 */
export function IslandWrapper({
  children,
  fallback,
  className,
}: IslandWrapperProps): React.ReactElement {
  const content = className
    ? React.createElement("div", { className }, children)
    : children;

  return React.createElement(
    IslandErrorBoundary,
    { fallback },
    React.createElement(SiteAdapterProvider, null, content)
  );
}

export default IslandWrapper;
