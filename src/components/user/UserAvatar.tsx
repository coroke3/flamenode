"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { cachedGoogleImageUrl } from "@/lib/media/googleImages";
import { cn } from "@/lib/utils/cn";

export interface UserAvatarProps {
  iconUrl?: string | null;
  label: string;
  size?: number;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  style?: React.CSSProperties;
  /** true のとき文字ではなくユーザーアイコンを表示（CreatorCard 等） */
  useIconFallback?: boolean;
}

export function UserAvatar({
  iconUrl,
  label,
  size,
  className,
  imageClassName,
  fallbackClassName,
  style,
  useIconFallback = false,
}: UserAvatarProps): React.ReactElement {
  const src = cachedGoogleImageUrl(iconUrl);
  const [imageFailed, setImageFailed] = React.useState(false);
  React.useEffect(() => setImageFailed(false), [src]);
  const dimensionStyle =
    size != null
      ? ({
          width: size,
          height: size,
        } as const)
      : undefined;
  const iconSize = Math.max(14, Math.round((size ?? 42) * 0.62));

  if (src && !imageFailed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt=""
        className={cn(className, imageClassName)}
        style={{
          ...dimensionStyle,
          ...style,
          borderRadius: "50%",
          objectFit: "cover",
        }}
        onError={() => setImageFailed(true)}
      />
    );
  }

  if (useIconFallback) {
    return (
      <span
        className={cn(className, fallbackClassName)}
        style={{
          ...dimensionStyle,
          ...style,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
        }}
        aria-hidden
      >
        <Icon name="user" size={iconSize} />
      </span>
    );
  }

  return (
    <span
      className={cn(className, fallbackClassName)}
      style={{
        ...dimensionStyle,
        ...style,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
      }}
      aria-hidden
    >
      {label.trim().replace(/^@/, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
