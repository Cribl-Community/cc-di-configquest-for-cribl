// A deploy-substituted secret: a field Cribl fills in when it deploys config — a
// `token`/`password` placeholder (`YOUR_TOKEN`) becomes a Cribl secret reference
// (`#42:…`). Two copies of the "same" object therefore differ on it for reasons that
// aren't a real edit, so both the git age walk (a pack's default vs. local copy) and
// the cross-group difference view normalize these away before comparing.

/** The single display token every view uses to stand in for a secret value, so masking
 *  reads identically in Compare, the detail Config tab, and Across Worker Groups. */
export const SECRET_MASK = '‹secret›'; // ‹secret›

/** Whether `key: value` is a deploy-substituted secret — a secret-ish field name, or
 *  a Cribl secret reference (`#<n>:…`) as the value. `key` may be a nested path (the
 *  substring match still catches `conf.token`, `authTokens[0].token`, etc.). */
export function isSecretValue(key: string, value: string): boolean {
  const v = value.replace(/^['"]|['"]$/g, '');
  return /token|secret|password|passphrase|apikey|privatekey|accesskey|credential/i.test(key) || /^#-?\d+:/.test(v);
}

/** `value` with secret content replaced by {@link SECRET_MASK}. Used at every display and
 *  comparison surface so a credential is never shown in plaintext. */
export function maskSecret(key: string, value: string): string {
  return isSecretValue(key, value) ? SECRET_MASK : value;
}
