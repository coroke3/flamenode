import React from "react";

/** CURRENTと同じ GET フォームのクエリ文字列・遷移契約を保つ。 */
export function navigateGetForm(form: HTMLFormElement): void {
  const method = (form.getAttribute("method") ?? "get").toLowerCase();
  if (method !== "get") {
    HTMLFormElement.prototype.submit.call(form);
    return;
  }

  const action = form.getAttribute("action")?.trim();
  const url = new URL(action || window.location.pathname, window.location.origin);
  url.search = "";

  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") url.searchParams.append(key, value);
  }

  const next = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next !== current) window.location.assign(next);
}

function submitParentForm(
  event: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>,
): void {
  const form = event.currentTarget.form;
  if (!form || form.hasAttribute("data-fn-ime-composing")) return;
  navigateGetForm(form);
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
  return (
    <select
      {...props}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) submitParentForm(event);
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
  return (
    <input
      type="checkbox"
      {...props}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) submitParentForm(event);
      }}
    />
  );
}
