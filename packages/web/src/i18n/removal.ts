import type { i18n as I18n } from 'i18next';
import {
  isProfileRemovablePart,
  isSpaceRemovablePart,
  type ProfileRemovablePart,
  type RemovalSubject,
  type SpaceRemovablePart,
} from '@backspace/shared/src/adminRemoval';
import { formatters } from './formatters';
import defaultI18n from './index';

/**
 * What an administrator's direct removal took (docs/systems/admin.md, "Removing content"), in the
 * reader's own language whatever language the administrator wrote in: its parts, and an emoji, a
 * sticker or a sound by its name, as one list. The notice the person reads and the platform audit
 * log say it in the same words (`legal:notices.parts.*`). A part this client does not know, from a
 * newer server, is left out rather than shown as a key; nothing known gives an empty string.
 */
export function removedText(subject: RemovalSubject, instance: I18n = defaultI18n): string {
  const named = [
    ...(subject.parts ?? [])
      .filter((part): part is ProfileRemovablePart | SpaceRemovablePart => isProfileRemovablePart(part) || isSpaceRemovablePart(part))
      .map((part) => instance.t(`legal:notices.parts.${part}`)),
    ...(subject.expression ? [instance.t(`legal:notices.parts.${subject.expression}`, { name: subject.name ?? '' })] : []),
  ];
  return named.length > 0 ? formatters.formatList(named) : '';
}
