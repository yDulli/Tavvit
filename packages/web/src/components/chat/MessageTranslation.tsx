import { useTranslation } from 'react-i18next';
import { googleTranslateUrl } from '@backspace/shared/src/translation';
import { useFormatters } from '../../i18n/formatters';
import { useTranslationStore } from '../../stores/translationStore';
import { Icon } from '../ui/Icon';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * A message in the reader's language, under the original, which stays where it is: what a
 * person wrote is never replaced by what a machine made of it.
 */
export function MessageTranslation({ messageId, content, channelId, emojiOrigin }: {
  messageId: string;
  content: string;
  channelId: string | null;
  /** The instance whose emoji the text names (see `MarkdownRenderer`). */
  emojiOrigin?: string;
}) {
  const { t } = useTranslation(['chat']);
  const { formatLanguageName } = useFormatters();
  const entry = useTranslationStore((s) => s.entries[messageId]);
  const hide = useTranslationStore((s) => s.hide);
  // Translated from words that have changed since.
  if (!entry || entry.content !== content) return null;

  const hideButton = (
    <button type="button" onClick={() => hide(messageId)} className="msg-translation-action">
      {t('chat:translation.hide')}
    </button>
  );

  if (entry.status === 'working') {
    return (
      <p role="status" className="msg-translation-note">
        <span aria-hidden="true" className="msg-translation-spinner" />
        {entry.downloading ? t('chat:translation.downloading') : t('chat:translation.working')}
        {entry.downloading && hideButton}
      </p>
    );
  }

  if (entry.status === 'same') {
    return (
      <p className="msg-translation-note">
        <span>{entry.source ? t('chat:translation.same', { language: formatLanguageName(entry.target) }) : t('chat:translation.nothing')}</span>
        {hideButton}
      </p>
    );
  }

  if (entry.status === 'offer') {
    return (
      <p className="msg-translation-note">
        <span>{entry.error ?? t('chat:translation.none')}</span>
        <a
          href={googleTranslateUrl(content, entry.target)}
          target="_blank"
          rel="noopener noreferrer"
          title={t('chat:translation.googleHint')}
          className="msg-translation-action inline-flex items-center gap-1"
        >
          {t('chat:translation.google')}
          <Icon name="external" size={11} />
        </a>
        {hideButton}
      </p>
    );
  }

  return (
    <div className="msg-translation">
      <div className="message-text text-txt-message leading-[1.5] break-words whitespace-pre-wrap">
        <MarkdownRenderer content={entry.text} channelId={channelId} {...(emojiOrigin !== undefined ? { emojiOrigin } : {})} />
      </div>
      <p className="msg-translation-note mt-0.5">
        <span>{entry.source ? t('chat:translation.from', { language: formatLanguageName(entry.source) }) : t('chat:translation.fromUnknown')}</span>
        {hideButton}
      </p>
    </div>
  );
}
