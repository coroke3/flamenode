import React from "react";
import { Button, type ButtonProps } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";

export interface ButtonIslandProps {
  label: string;
  variant?: ButtonProps["variant"];
}

/**
 * Hydration check Island for MIG-0402 U02: one shared `Button` rendered inside
 * `IslandWrapper`, so the Button is part of the hydrated React tree.
 * The top page itself is MIG-0506.
 */
export function ButtonIsland({ label, variant = "primary" }: ButtonIslandProps): React.ReactElement {
  return React.createElement(
    IslandWrapper,
    null,
    React.createElement(Button, { type: "button", variant }, label),
  );
}

export default ButtonIsland;
