import { jsx as _jsx } from "react/jsx-runtime";
import { UserAvatar } from "./UserAvatar.js";
/**
 * Manage の装飾アイコン。
 * 画像取得に失敗しても再試行・別D1/R2探索を行わず、同じ行の文字fallbackへ切り替える。
 */
export function ManageXIcon({ iconUrl, label, size = 36, className = "manage-staff-avatar", fallbackClassName = "manage-staff-avatar-fallback", style, }) {
    return (_jsx(UserAvatar, { iconUrl: iconUrl, label: label, size: size, className: className, fallbackClassName: fallbackClassName, style: style }));
}
// Phase callers may use the shorter semantic name without changing behavior.
export const ManageIcon = ManageXIcon;
