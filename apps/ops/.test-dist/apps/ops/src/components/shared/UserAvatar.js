import { jsx as _jsx } from "react/jsx-runtime";
// Port of CURRENT src/components/user/UserAvatar.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";
import { Icon } from "./Icon.js";
import { cachedGoogleImageUrl } from "./googleImages.js";
import { cn } from "./cn.js";
export function UserAvatar({ iconUrl, label, size, className, imageClassName, fallbackClassName, style, useIconFallback = false, }) {
    const src = cachedGoogleImageUrl(iconUrl);
    const [imageFailed, setImageFailed] = React.useState(false);
    React.useEffect(() => setImageFailed(false), [src]);
    const dimensionStyle = size != null
        ? {
            width: size,
            height: size,
        }
        : undefined;
    const iconSize = Math.max(14, Math.round((size ?? 42) * 0.62));
    if (src && !imageFailed) {
        return (
        /* eslint-disable-next-line @next/next/no-img-element */
        _jsx("img", { src: src, alt: "", className: cn(className, imageClassName), style: {
                ...dimensionStyle,
                ...style,
                borderRadius: "50%",
                objectFit: "cover",
            }, onError: () => setImageFailed(true) }));
    }
    if (useIconFallback) {
        return (_jsx("span", { className: cn(className, fallbackClassName), style: {
                ...dimensionStyle,
                ...style,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
            }, "aria-hidden": true, children: _jsx(Icon, { name: "user", size: iconSize }) }));
    }
    return (_jsx("span", { className: cn(className, fallbackClassName), style: {
            ...dimensionStyle,
            ...style,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
        }, "aria-hidden": true, children: label.trim().replace(/^@/, "").slice(0, 1).toUpperCase() || "?" }));
}
