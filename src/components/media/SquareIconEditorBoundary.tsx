"use client";

import * as React from "react";

type SquareIconEditorBoundaryProps = {
  children: React.ReactNode;
  onError?: () => void;
};

type SquareIconEditorBoundaryState = {
  error: Error | null;
  resetKey: number;
};

export class SquareIconEditorBoundary extends React.Component<
  SquareIconEditorBoundaryProps,
  SquareIconEditorBoundaryState
> {
  state: SquareIconEditorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<SquareIconEditorBoundaryState> {
    return { error };
  }

  componentDidCatch(): void {
    this.props.onError?.();
  }

  private reset = (): void => {
    this.setState((prev) => ({
      error: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
            画像エディタで問題が発生しました
          </p>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" onClick={this.reset}>
            やり直す
          </button>
        </div>
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
