import React from "react";
import { cx } from "../cx.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "tertiary";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  icon,
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const isIconOnly = Boolean(icon && (children == null || children === ""));
  const isDisabled = disabled || loading;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      data-variant={variant}
      className={cx(
        "fn-btn",
        `fn-btn--${variant}`,
        size === "sm" && "fn-btn--sm",
        isIconOnly && "fn-btn--icon",
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      {icon ? (
        <span className="fn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {isIconOnly ? null : children}
    </button>
  );
}
