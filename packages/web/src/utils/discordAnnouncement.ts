import type { TFunction } from 'i18next';

/**
 * The text a space's people post in their Discord server to say the community moved here
 * (Space settings, "Get from Discord"). Built in the language the person picks, which need not be
 * the one the app shows, and kept within what Discord takes in one message.
 */

/** The longest message Discord takes. */
export const DISCORD_MESSAGE_MAX = 2000;

const ZERO_WIDTH_SPACE = '​';

/**
 * Text that Discord shows as written. Its markdown characters are escaped, so a name cannot change
 * the formatting or hide a link. Mentions of everyone, of those online, and of people, roles, channels
 * or emoji are broken with a zero-width space: Discord looks for them in the raw text, where a
 * backslash would not stop a ping.
 */
export function escapeDiscordText(text: string): string {
  // Mentions first, while they still read as Discord would read them; escaping `#` first would hide
  // `<#…>` from the pattern below.
  return text
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH_SPACE}$1`)
    .replace(/<(?=[@#:/]|a:|t:)/g, `<${ZERO_WIDTH_SPACE}`)
    .replace(/[\\*_~`|[\]()#>-]/g, (character) => `\\${character}`);
}

export interface DiscordAnnouncementInput {
  /** Fixed to the language picked for the text, namespace `spaces`. */
  t: TFunction<'spaces'>;
  spaceName: string;
  /** The name of the server the space lives on, as its invite page shows it. */
  instanceName: string;
  /** The invite link, `?from=discord` included. */
  link: string;
  /** The space lets people in on request, not straight away. */
  request: boolean;
  /** Emoji came over too, not only channels and roles. */
  withEmoji: boolean;
  /** Anyone may make an account there; otherwise the text does not promise a quick sign-up. */
  registrationOpen: boolean;
}

/**
 * The announcement: a bold headline, what is already set up, how to come over, the link on a line
 * of its own (so Discord shows its preview), and that the history stays where it is. The names are
 * escaped; the link is not, or it would stop being one.
 */
export function buildDiscordAnnouncement(input: DiscordAnnouncementInput): string {
  const { t } = input;
  const headline = t('import.announce.lines.headline', {
    space: escapeDiscordText(input.spaceName),
    instance: escapeDiscordText(input.instanceName),
  });
  const lines: string[] = [
    `**${headline}**`,
    input.withEmoji ? t('import.announce.lines.readyWithEmoji') : t('import.announce.lines.ready'),
  ];
  if (input.registrationOpen) lines.push(t('import.announce.lines.account'));
  lines.push('', input.request ? t('import.announce.lines.request') : t('import.announce.lines.join'), input.link, '', t('import.announce.lines.history'));
  // Names are short (a space's at most 100 characters), so the whole stays far below
  // DISCORD_MESSAGE_MAX; a test holds it there.
  return lines.join('\n');
}
