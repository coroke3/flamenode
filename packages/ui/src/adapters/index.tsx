import React from "react";

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: React.ReactNode;
}

let customLinkComponent: React.ComponentType<LinkProps> | null = null;

export function setLinkComponent(comp: React.ComponentType<LinkProps> | null) {
  customLinkComponent = comp;
}

export const Link: React.FC<LinkProps> = (props) => {
  if (customLinkComponent) {
    const Custom = customLinkComponent;
    return <Custom {...props} />;
  }
  return <a {...props} />;
};

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
  priority?: boolean;
}

let customImageComponent: React.ComponentType<ImageProps> | null = null;

export function setImageComponent(comp: React.ComponentType<ImageProps> | null) {
  customImageComponent = comp;
}

export const Image: React.FC<ImageProps> = ({ fill, priority, style, ...props }) => {
  if (customImageComponent) {
    const Custom = customImageComponent;
    return <Custom fill={fill} priority={priority} style={style} {...props} />;
  }
  const computedStyle: React.CSSProperties = fill
    ? { width: "100%", height: "100%", objectFit: "cover", ...style }
    : style || {};
  return <img style={computedStyle} {...props} />;
};

export interface NavigatorAdapter {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
}

let customNavigator: NavigatorAdapter = {
  push: (href: string) => {
    if (typeof window !== "undefined") window.location.href = href;
  },
  replace: (href: string) => {
    if (typeof window !== "undefined") window.location.replace(href);
  },
  back: () => {
    if (typeof window !== "undefined") window.history.back();
  },
};

export function setNavigatorAdapter(nav: NavigatorAdapter) {
  customNavigator = nav;
}

export function useNavigateAdapter(): NavigatorAdapter {
  return customNavigator;
}
