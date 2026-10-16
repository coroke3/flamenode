import React from "react";

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: React.ReactNode;
}

export const LinkContext = React.createContext<React.ComponentType<LinkProps> | null>(null);

let customLinkComponent: React.ComponentType<LinkProps> | null = null;

/**
 * @deprecated Use AdapterProvider instead of module-level mutable setter.
 */
export function setLinkComponent(comp: React.ComponentType<LinkProps> | null) {
  customLinkComponent = comp;
}

export const Link: React.FC<LinkProps> = (props) => {
  const contextComponent = React.useContext(LinkContext);
  const Custom = contextComponent || customLinkComponent;
  if (Custom) {
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

export const ImageContext = React.createContext<React.ComponentType<ImageProps> | null>(null);

let customImageComponent: React.ComponentType<ImageProps> | null = null;

/**
 * @deprecated Use AdapterProvider instead of module-level mutable setter.
 */
export function setImageComponent(comp: React.ComponentType<ImageProps> | null) {
  customImageComponent = comp;
}

export const Image: React.FC<ImageProps> = ({ fill, priority, style, ...props }) => {
  const contextComponent = React.useContext(ImageContext);
  const Custom = contextComponent || customImageComponent;
  if (Custom) {
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

const defaultNavigator: NavigatorAdapter = {
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

export const NavigatorContext = React.createContext<NavigatorAdapter | null>(null);

let customNavigator: NavigatorAdapter = defaultNavigator;

/**
 * @deprecated Use AdapterProvider instead of module-level mutable setter.
 */
export function setNavigatorAdapter(nav: NavigatorAdapter) {
  customNavigator = nav;
}

export function useNavigateAdapter(): NavigatorAdapter {
  const contextNav = React.useContext(NavigatorContext);
  return contextNav || customNavigator;
}

export interface AdapterProviderProps {
  link?: React.ComponentType<LinkProps> | null;
  image?: React.ComponentType<ImageProps> | null;
  navigator?: NavigatorAdapter | null;
  children?: React.ReactNode;
}

export function AdapterProvider({
  link,
  image,
  navigator,
  children,
}: AdapterProviderProps): React.ReactElement {
  const parentLink = React.useContext(LinkContext);
  const parentImage = React.useContext(ImageContext);
  const parentNavigator = React.useContext(NavigatorContext);

  const resolvedLink = link !== undefined ? link : parentLink;
  const resolvedImage = image !== undefined ? image : parentImage;
  const resolvedNavigator = navigator !== undefined ? navigator : parentNavigator;

  return (
    <LinkContext.Provider value={resolvedLink}>
      <ImageContext.Provider value={resolvedImage}>
        <NavigatorContext.Provider value={resolvedNavigator}>
          {children}
        </NavigatorContext.Provider>
      </ImageContext.Provider>
    </LinkContext.Provider>
  );
}
