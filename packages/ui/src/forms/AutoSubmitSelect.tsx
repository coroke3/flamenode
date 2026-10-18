import React from "react";
import { useNavigateAdapter } from "../adapters/index.js";

/** Where a GET form leads (CURRENT query string contract); null when it is the current URL. */
export function getFormNavigationHref(form: HTMLFormElement): string | null {
  const action = form.getAttribute("action")?.trim();
  // Resolve against the page URL itself (CURRENT used location.origin), so no host is invented
  // for opaque origins such as file: pages.
  const url = new URL(action || window.location.pathname, window.location.href);
  url.search = "";

  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") url.searchParams.append(key, value);
  }

  const next = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  return next === current ? null : next;
}

/**
 * CURRENTと同じ GET フォームのクエリ文字列・遷移契約を保つ。
 * `navigate` defaults to `window.location.assign`, as in CURRENT.
 */
export function navigateGetForm(
  form: HTMLFormElement,
  navigate: (href: string) => void = (href) => window.location.assign(href),
): void {
  const method = (form.getAttribute("method") ?? "get").toLowerCase();
  if (method !== "get") {
    // requestSubmit preserves native validation and React submit handlers.
    // Older browsers need a cancelable submit event after constraint validation.
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else if (form.noValidate || !form.checkValidity || form.checkValidity()) {
      const SubmitEvent = form.ownerDocument?.defaultView?.Event ?? Event;
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    } else {
      form.reportValidity?.();
    }
    return;
  }

  const next = getFormNavigationHref(form);
  if (next !== null) navigate(next);
}

function submitParentForm(
  event: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>,
  navigate: (href: string) => void,
): void {
  const form = event.currentTarget.form;
  if (!form || form.hasAttribute("data-fn-ime-composing")) return;
  navigateGetForm(form, navigate);
}

export interface AutoSubmitSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export function AutoSubmitSelect({
  children,
  onChange,
  ...props
}: AutoSubmitSelectProps): React.ReactElement {
  const navigator = useNavigateAdapter();
  return (
    <select
      {...props}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) submitParentForm(event, (href) => navigator.push(href));
      }}
    >
      {children}
    </select>
  );
}

export interface AutoSubmitCheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export function AutoSubmitCheckbox({
  onChange,
  ...props
}: AutoSubmitCheckboxProps): React.ReactElement {
  const navigator = useNavigateAdapter();
  return (
    <input
      type="checkbox"
      {...props}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) submitParentForm(event, (href) => navigator.push(href));
      }}
    />
  );
}
