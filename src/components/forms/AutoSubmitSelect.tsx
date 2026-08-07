"use client";

import * as React from "react";
import { isImeComposingForm } from "@/lib/forms/imeSafeSearch";



interface AutoSubmitSelectProps

  extends React.SelectHTMLAttributes<HTMLSelectElement> {

  children: React.ReactNode;

}



/** GET フォームをクエリ付き URL へ遷移（React 19 の form 検知を避ける） */
export function navigateGetForm(form: HTMLFormElement): void {

  const method = (form.getAttribute("method") ?? "get").toLowerCase();

  if (method !== "get") {

    form.requestSubmit();

    return;

  }



  const action = form.getAttribute("action")?.trim();

  const url = new URL(

    action || window.location.pathname,

    window.location.origin,

  );

  url.search = "";



  const data = new FormData(form);

  for (const [key, value] of data.entries()) {

    if (typeof value === "string") {

      url.searchParams.append(key, value);

    }

  }



  const next = `${url.pathname}${url.search}${url.hash}`;

  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (next !== current) {

    window.location.assign(next);

  }

}



function submitParentForm(

  e: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>,

): void {

  const form = e.currentTarget.form;

  if (!form) return;
  if (isImeComposingForm(form)) return;

  navigateGetForm(form);

}



/** GET フォーム内で選択変更時に即 submit する select */

export function AutoSubmitSelect({

  children,

  onChange,

  ...props

}: AutoSubmitSelectProps): React.ReactElement {

  return (

    <select

      {...props}

      onChange={(e) => {

        onChange?.(e);

        submitParentForm(e);

      }}

    >

      {children}

    </select>

  );

}



interface AutoSubmitCheckboxProps

  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}



/** GET フォーム内でチェック変更時に即 submit する checkbox */

export function AutoSubmitCheckbox({

  onChange,

  ...props

}: AutoSubmitCheckboxProps): React.ReactElement {

  return (

    <input

      type="checkbox"

      {...props}

      onChange={(e) => {

        onChange?.(e);

        submitParentForm(e);

      }}

    />

  );

}


