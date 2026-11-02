/**
 * A CSS `url()` of an address, as a quoted string with every character that could end the string
 * escaped: an address put in as it is could close `url(` and open a second one, which the browser
 * would fetch from wherever it names, past the check that passed the first.
 */
export function cssUrl(address: string): string {
  return `url("${address.replace(/["\\\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}")`;
}
