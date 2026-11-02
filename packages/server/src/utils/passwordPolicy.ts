/**
 * What a new password may not be, beyond its length (docs/systems/auth.md, section 1). No rules
 * about digits and capitals: those make passwords harder to remember and barely harder to
 * guess. What actually gets accounts taken over is the short list everyone tries first, and
 * the account's own name, so those are refused.
 */

/** The most common passwords of eight characters or more, the shorter ones being refused anyway. */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'pass1234', 'passpass',
  '12345678', '123456789', '1234567890', '12345678910', '123123123', '12341234', '11111111', '111111111', '1111111111',
  '00000000', '88888888', '87654321', '987654321', '0987654321', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'q1w2e3r4',
  'qwertyui', 'qwertyuiop', 'qwerty12', 'qwerty123', 'qwerty1234', 'qweasdzxc', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'abcd1234', 'abc12345',
  'abcdefgh', 'abcdefghi', 'a1b2c3d4', 'aa123456', 'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football', 'baseball', 'superman',
  'starwars', 'trustno1', 'whatever', 'welcome1', 'welcome123', 'letmein1', 'letmein123', 'changeme', 'changeme123', 'admin123', 'admin1234',
  'administrator', 'computer', 'internet', 'michelle', 'jennifer', 'jordan23', 'liverpool', 'charlie1', 'dragon12', 'monkey12', 'shadow12',
  'master12', 'pokemon1', 'samsung1', 'test1234', 'testtest', 'tavvit123', 'discord1', 'discord123', 'minecraft', 'nintendo',
  // German
  'passwort', 'passwort1', 'passwort12', 'passwort123', 'hallo123', 'hallo1234', 'geheim123', 'fussball', 'schalke04', 'borussia', 'schatzi1', 'deutschland',
]);

/** One character over and over: as easy as the list, and it never ends. */
function isOneCharacterRepeated(password: string): boolean {
  return new Set(password).size === 1;
}

/** Whether this cannot be a password for this account. Case does not matter: neither to a guesser. */
export function isWeakPassword(password: string, username?: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || isOneCharacterRepeated(lower)) return true;
  return username !== undefined && lower === username.toLowerCase();
}
