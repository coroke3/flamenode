export declare function normalizeXId(value: string | null | undefined): string;
/** Return true only for a canonical, persistable X handle. */
export declare function isCanonicalXId(value: string | null | undefined): value is string;
/** Parse the friendly UI forms and return the canonical lowercase handle. */
export declare function parseCanonicalXId(raw: string | null | undefined): string | null;
/**
 * ユーザー入力から X ハンドルを解析する。
 * 受け付け: username / @username / x.com・twitter.com のプロフィール URL。
 * 正規化後は小文字ハンドル。無効なら null。
 * 文字数上限は X の 20 文字に合わせる（21 文字以上は拒否）。
 */
export declare function parseXIdentityInput(raw: string): string | null;
//# sourceMappingURL=format.d.ts.map