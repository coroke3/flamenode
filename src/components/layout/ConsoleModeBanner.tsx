import * as React from "react";

interface ConsoleModeBannerProps {
  classPrefix: "admin-mode" | "manage-mode";
  badge: string;
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function ConsoleModeBanner({
  classPrefix,
  badge,
  label,
  children,
  style,
}: ConsoleModeBannerProps): React.ReactElement {
  return (
    <div className={`${classPrefix}-banner`} style={style}>
      <span className={`${classPrefix}-badge`}>{badge}</span>
      <span className={`${classPrefix}-label`}>{label}</span>
      <p className={`${classPrefix}-hint`}>{children}</p>
    </div>
  );
}
