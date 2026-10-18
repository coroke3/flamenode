import React from "react";
import {
  AdapterProvider,
  type LinkProps,
  type ImageProps,
  type NavigatorAdapter,
} from "@flamenode/ui";

export interface SiteAdapterProviderProps {
  children?: React.ReactNode;
}

export const SiteLink: React.FC<LinkProps> = ({ href, children, ...rest }) => {
  return React.createElement(
    "a",
    { href, ...rest },
    children
  );
};

export const SiteImage: React.FC<ImageProps> = ({
  src,
  alt,
  fill,
  priority,
  style,
  loading,
  decoding,
  ...rest
}) => {
  const computedStyle: React.CSSProperties = fill
    ? { width: "100%", height: "100%", objectFit: "cover", ...style }
    : style || {};

  return React.createElement("img", {
    src,
    alt,
    style: computedStyle,
    loading: loading ?? (priority ? "eager" : "lazy"),
    decoding: decoding ?? "async",
    ...rest,
  });
};

export const siteNavigator: NavigatorAdapter = {
  push: (href: string) => {
    if (typeof window !== "undefined") {
      window.location.href = href;
    }
  },
  replace: (href: string) => {
    if (typeof window !== "undefined") {
      window.location.replace(href);
    }
  },
  back: () => {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  },
};

/**
 * SiteAdapterProvider wraps React Island components with Astro-safe Link, Image,
 * and Navigator adapters via Context (AdapterProvider), completely avoiding mutable module globals.
 */
export function SiteAdapterProvider({
  children,
}: SiteAdapterProviderProps): React.ReactElement {
  return React.createElement(
    AdapterProvider,
    {
      link: SiteLink,
      image: SiteImage,
      navigator: siteNavigator,
    },
    children
  );
}
