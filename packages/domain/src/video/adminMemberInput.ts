/**
 * SA-085 (CURRENT admin video members): preserve the legacy FormData checkbox
 * contract. Multiple occurrences are allowed; only literal "on" and "true"
 * enable collaboration. Hono callers must perform admin authorization before
 * accepting this parsed value.
 */
export function readAdminVideoCollabFlag(formData: Pick<FormData, "getAll">): boolean {
  return formData.getAll("is_collab").some((value) => value === "on" || value === "true");
}
