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
