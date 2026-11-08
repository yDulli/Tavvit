import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { useFormatters } from '../../i18n/formatters';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

/** The people of the sample conversation: names are names in every language. */
const PEOPLE = {
  mara: { name: 'Mara', id: 'preview-mara' },
  jonas: { name: 'Jonas', id: 'preview-jonas' },
  noor: { name: 'Noor', id: 'preview-noor' },
} as const;

type Person = keyof typeof PEOPLE;

/** The link in the sample, an address and so the same in every language. */
const SAMPLE_LINK = 'tavvit.com/look';

interface SampleMessage {
  person: Person;
  /** The first of a run of one person's messages: with its picture and name. */
  first: boolean;
  text: 'greeting' | 'plan' | 'reply' | 'link' | 'last';
  replyTo?: Person;
  reaction?: string;
}

const MESSAGES: readonly SampleMessage[] = [
  { person: 'mara', first: true, text: 'greeting' },
  { person: 'mara', first: false, text: 'plan', reaction: '🔥' },
  { person: 'jonas', first: true, text: 'reply', replyTo: 'mara' },
  { person: 'noor', first: true, text: 'link' },
  { person: 'noor', first: false, text: 'last' },
];

/**
 * A conversation drawn the way the app draws one (`.msg-row` and its parts, as `Message.tsx` lays
 * them out), so it shows the look as it is now: the surfaces, the accent, the corners, the typeface,
 * the shape of pictures, how messages are drawn and how closely they sit. Nothing in it is real or
 * can be clicked; it is the theme studio's mirror.
 */
export function LookPreview({ className = '' }: { className?: string }) {
  const { t } = useTranslation('settings');
  const messageStyle = useAppearanceStore((s) => s.messageStyle);
  const { formatTime } = useFormatters();
  const avatarSize = messageStyle === 'rows' ? 20 : 28;
  // A fixed afternoon, so the times read the same every time.
  const base = new Date(2026, 10, 8, 16, 20).getTime();

  return (
    <figure className={`lit relative overflow-hidden rounded-lg border border-border-hard bg-surface-chat ${className}`} aria-label={t('studio.preview.label')}>
      <div className="panel-bar flex h-11 items-center gap-2 border-b border-border-hard px-4">
        <Icon name="hash" size={16} className="text-txt-tertiary" />
        <span className="text-ui font-medium text-txt-primary">{t('studio.preview.channel')}</span>
        <span className="count-badge ml-auto">3</span>
      </div>

      <div className="py-3">
        {MESSAGES.map((message, index) => {
          const person = PEOPLE[message.person];
          const showsHead = message.first || message.replyTo !== undefined;
          return (
            <div
              key={index}
              data-first={showsHead ? 'true' : 'false'}
              data-own="false"
              data-mentioned="false"
              className={`msg-row group relative flex gap-3 mx-2 px-3 rounded-md ${showsHead ? 'msg-first' : ''}`}
            >
              {message.replyTo && (
                <div className="msg-reply-line absolute left-[27px] top-[-12px] w-[26px] h-[20px] border-l-2 border-t-2 border-interactive-muted rounded-tl-md opacity-60" />
              )}
              <div className="msg-avatar flex-shrink-0 flex items-start justify-start">
                {showsHead ? (
                  <Avatar name={person.name} size={avatarSize} userId={person.id} />
                ) : (
                  <span className="msg-hover-time tabular font-mono text-label text-txt-tertiary opacity-0 select-none w-full text-right whitespace-nowrap leading-[1.45rem]">
                    {formatTime(base + index * 60_000)}
                  </span>
                )}
              </div>
              <div className="msg-body flex-1 min-w-0">
                {message.replyTo && (
                  <div className="msg-reply flex items-center gap-1.5 min-w-0 pl-1.5">
                    <Icon name="reply" size={12} className="msg-reply-icon flex-shrink-0 text-txt-tertiary" />
                    <Avatar name={PEOPLE[message.replyTo].name} size={14} userId={PEOPLE[message.replyTo].id} />
                    <span className="flex-shrink-0 text-meta font-medium text-txt-primary">{PEOPLE[message.replyTo].name}</span>
                    <span className="truncate text-meta text-txt-tertiary">{t('studio.preview.messages.plan')}</span>
                  </div>
                )}
                {showsHead && (
                  <div className="msg-head flex items-baseline gap-2 mb-0.5">
                    <span className="msg-name font-medium text-body leading-tight text-txt-primary">{person.name}</span>
                    <time className="msg-time tabular flex-shrink-0 whitespace-nowrap font-mono text-label text-txt-tertiary leading-tight">
                      {formatTime(base + index * 60_000)}
                    </time>
                  </div>
                )}
                <div className="msg-content flex flex-col gap-1.5">
                  <div className="message-text text-txt-message leading-[1.5] break-words whitespace-pre-wrap">
                    {message.text === 'link' ? (
                      <>
                        {t('studio.preview.messages.link')}{' '}
                        <span className="text-txt-link underline-offset-2 hover:underline">{SAMPLE_LINK}</span>
                      </>
                    ) : t(`studio.preview.messages.${message.text}`)}
                  </div>
                  {message.reaction && (
                    <div className="flex">
                      <span className="glass-pill inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-meta" data-reacted="true">
                        <span aria-hidden="true">{message.reaction}</span>
                        <span className="tabular font-mono text-label text-txt-secondary">2</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* A menu open over the conversation, in the room left for it above the composer. */}
      <div className="relative px-4 pb-4 pt-[7.5rem]">
        <div className="glass absolute right-6 top-1 w-44 rounded-lg p-1.5">
          <div className="nav-item flex items-center gap-2 rounded-md px-2 py-1.5 text-ui text-txt-secondary" data-active="true">
            <Icon name="reply" size={14} />
            {t('studio.preview.menu.reply')}
          </div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui text-txt-secondary">
            <Icon name="forward" size={14} />
            {t('studio.preview.menu.forward')}
          </div>
          <div className="mt-1 border-t border-border-hard px-1 pt-1.5">
            <span className="btn-primary btn-sm w-full justify-center">{t('studio.preview.menu.save')}</span>
          </div>
        </div>
        <div className="glass-bubble flex items-center gap-2 rounded-lg px-3 py-2.5">
          <Icon name="plus" size={16} className="text-txt-tertiary" />
          <span className="flex-1 truncate text-body text-txt-tertiary">{t('studio.preview.composer')}</span>
          <Icon name="smile" size={16} className="text-txt-tertiary" />
        </div>
      </div>
    </figure>
  );
}
