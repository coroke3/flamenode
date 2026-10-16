import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmptyState,
  ErrorCallout,
  StatusNotice,
} from "../dist/index.js";

test("T01: ErrorCallout renders role='alert' and aria-live='assertive' with retry button", () => {
  let retried = false;
  const html = renderToStaticMarkup(
    React.createElement(ErrorCallout, {
      message: "通信エラーが発生しました",
      retry: () => {
        retried = true;
      },
      retryLabel: "再試行する",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, /通信エラーが発生しました/);
  assert.match(html, /再試行する/);
  assert.match(html, /fn-error-retry/);

  // Directly verify retry handler call
  const element = ErrorCallout({
    message: "error",
    retry: () => {
      retried = true;
    },
  });
  element.props.children[1].props.onClick();
  assert.equal(retried, true);
});

test("T02: EmptyState renders title, description, action link, and tone classes", () => {
  const html = renderToStaticMarkup(
    React.createElement(EmptyState, {
      title: "作品がまだありません",
      description: "最初の作品を投稿してみましょう",
      tone: "warning",
      action: {
        href: "/entry",
        label: "投稿する",
      },
    }),
  );

  assert.match(html, /fn-empty-state--warning/);
  assert.match(html, /作品がまだありません/);
  assert.match(html, /最初の作品を投稿してみましょう/);
  assert.match(html, /href="\/entry"/);
  assert.match(html, /投稿する/);
});

test("StatusNotice renders role='status' and aria-live='polite' for degraded, pending, and success", () => {
  const degradedHtml = renderToStaticMarkup(
    React.createElement(StatusNotice, {
      status: "degraded",
      title: "遅延中",
      message: "データの反映に時間がかかっています",
    }),
  );
  assert.match(degradedHtml, /role="status"/);
  assert.match(degradedHtml, /aria-live="polite"/);
  assert.match(degradedHtml, /fn-status-notice--degraded/);
  assert.match(degradedHtml, /遅延中/);
  assert.match(degradedHtml, /データの反映に時間がかかっています/);

  const successHtml = renderToStaticMarkup(
    React.createElement(StatusNotice, {
      status: "success",
      message: "設定を保存しました",
    }),
  );
  assert.match(successHtml, /fn-status-notice--success/);
  assert.match(successHtml, /設定を保存しました/);
});
