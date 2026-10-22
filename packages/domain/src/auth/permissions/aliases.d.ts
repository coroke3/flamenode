import { type PermissionKey } from "./keys.ts";
export declare const LEGACY_PERMISSION_KEY_ALIASES: string[];
export declare function canonicalizePermissionKey(key: string): PermissionKey | null;
/**
 * 要求キーを満たすために staff 行が持つべき正規キー一覧。
 * 旧キー (videos.*) は正規キー 1 件に畳む。
 */
export declare function expandPermissionAliases(key: string): PermissionKey[];
//# sourceMappingURL=aliases.d.ts.map