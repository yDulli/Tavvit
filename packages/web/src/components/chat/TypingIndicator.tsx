import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../stores/chatStore';
import { useFormatters } from '../../i18n/formatters';
import { useChannelUser, useSelfIdInChannel, type ChannelUser } from '../../utils/channelUser';
import { spaceMemberName, userDisplayName } from '../../utils/identity';

interface TypingIndicatorProps {
  channelId: string;
}

/** How many typers are named; more than this is summarised. */
const MAX_NAMED_TYPERS = 2;

/**
 * Stand-ins for the names while the sentence is built. The translated line
 * and the language's list format place the names; each stand-in is then
 * replaced by its own element, so a long name truncates by width inside its
 * own box and the separators and the verb are never cut. Private-use code
 * points, so no catalog text or list separator can contain them.
 */
const NAME_SLOT_OPEN = '\uE000';
const NAME_SLOT_CLOSE = '\uE001';
const NAME_SLOT_SPLIT = /\uE000(\d+)\uE001/;

function nameSlot(index: number): string {
  return `${NAME_SLOT_OPEN}${index}${NAME_SLOT_CLOSE}`;
}

/**
 * The name shown for a typer: their name as this channel knows them (their
 * nickname in a space channel, see `spaceMemberName`),
 * or, when the typer is not among the channel's people, the base of the
 * username the typing event carried (the event has nothing better).
 */
function typerName(resolved: ChannelUser | null, wireUsername: string): string {
  return resolved ? spaceMemberName(resolved.member, resolved.user) : userDisplayName({ username: wireUsername });
}

/**
 * Renders `sentence` with each name stand-in replaced by the name in a
 * truncating box. The box keeps the full name in the DOM and in its title,
 * and takes pointer events so the title shows on hover (the line itself lets
 * clicks through to the messages under it).
 */
function renderNamedSentence(sentence: string, names: readonly string[]): React.ReactNode[] {
  // With one capture group, odd entries are the slot indices.
  return sentence.split(NAME_SLOT_SPLIT).map((part, i) => {
    if (i % 2 === 1) {
      const name = names[Number(part)] ?? '';
      return (
        <span key={i} title={name} className="min-w-0 truncate pointer-events-auto">
          {name}
        </span>
      );
    }
    return part ? <span key={i} className="shrink-0 whitespace-pre">{part}</span> : null;
  });
}

export function TypingIndicator({ channelId }: TypingIndicatorProps) {
  const { t } = useTranslation('chat');
  const fmt = useFormatters();
  const typingUsersRaw = useChatStore((s) => s.typingUsers.get(channelId));
  // Typing entries carry ids issued by the channel's instance, so the viewer
  // is left out by their id there, not by the home id.
  const selfId = useSelfIdInChannel(channelId);

  // Filter out the viewer and expired entries
  const others = useMemo(() => {
    if (!typingUsersRaw || typingUsersRaw.length === 0) return [];
    const now = Date.now();
    return typingUsersRaw
      .filter(t => now - t.timestamp < 5000 && t.userId !== selfId);
  }, [typingUsersRaw, selfId]);

  // Only the named typers are resolved; a summary names nobody.
  const first = others.length <= MAX_NAMED_TYPERS ? others[0] : undefined;
  const second = others.length <= MAX_NAMED_TYPERS ? others[1] : undefined;
  const firstUser = useChannelUser(channelId, first?.userId ?? null);
  const secondUser = useChannelUser(channelId, second?.userId ?? null);

  if (others.length === 0) return null;

  let line: React.ReactNode;
  if (others.length > MAX_NAMED_TYPERS) {
    line = <span className="truncate">{t('composer.typing.several')}</span>;
  } else {
    const names: string[] = [];
    if (first) names.push(typerName(firstUser, first.username));
    if (second) names.push(typerName(secondUser, second.username));
    const sentence = t('composer.typing.named', {
      count: names.length,
      names: fmt.formatList(names.map((_, i) => nameSlot(i))),
    });
    line = renderNamedSentence(sentence, names);
  }

  return (
    // Starts at the edge the messages start at, on the page's own colour, so a
    // message scrolling behind it never runs through its text.
    <div className="absolute bottom-full left-3 right-3 desktop:left-0 desktop:right-0 mb-px flex items-center text-meta leading-4 text-txt-secondary select-none pointer-events-none animate-typing-in motion-reduce:animate-none">
      <div className="-mx-1 flex min-w-0 items-center gap-2 rounded-sm bg-surface-chat px-1">
        <div aria-hidden="true" className="flex shrink-0 items-center gap-[3px]">
          <span className="typing-dot" />
          <span className="typing-dot" style={{ animationDelay: '160ms' }} />
          <span className="typing-dot" style={{ animationDelay: '320ms' }} />
        </div>
        <span data-typing-line className="flex min-w-0 max-w-[400px] whitespace-nowrap">
          {line}
        </span>
      </div>
    </div>
  );
}
