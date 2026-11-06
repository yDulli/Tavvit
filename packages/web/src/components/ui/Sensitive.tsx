import { useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { STREAMER_MASK, useStreamerMode, useStreamerModeStore } from '../../streamer/streamerModeStore';
import { Icon } from './Icon';

/**
 * What streamer mode hides (docs/systems/streamer-mode.md). While it is on,
 * the value is not put into the page at all, not blurred: blurred text can be
 * read back, and a page's text is what screen readers, extensions and a
 * stream's capture all see. Copying still works wherever the page offers it,
 * because a copy button reads the value it was given, never the page.
 */

/** A value in a line of text: itself, or a row of dots read out as hidden. */
export function Sensitive({ children }: { children: ReactNode }) {
  const on = useStreamerMode();
  const { t } = useTranslation('common');
  if (!on) return <>{children}</>;
  return (
    <span className="select-none whitespace-nowrap text-txt-tertiary">
      <span aria-hidden="true" className="tracking-[0.12em]">{STREAMER_MASK}</span>
      <span className="sr-only">{t('streamerMode.hidden')}</span>
    </span>
  );
}

/**
 * Something that is hidden whole (a list, a code to scan): itself, or a note
 * in its place with the way to turn the mode off, for someone who needs to
 * see it now.
 */
export function SensitiveBlock({ children, className = '' }: { children: ReactNode; className?: string }) {
  const on = useStreamerMode();
  const setOn = useStreamerModeStore((state) => state.setOn);
  const { t } = useTranslation('common');
  if (!on) return <>{children}</>;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-border-soft bg-surface-input px-3 py-2.5 ${className}`}>
      <Icon name="eye-off" size={16} className="flex-shrink-0 text-txt-tertiary" />
      <p className="min-w-0 flex-1 basis-48 text-meta leading-snug text-txt-secondary">{t('streamerMode.hiddenBlock')}</p>
      <button type="button" onClick={() => setOn(false)} className="btn-quiet btn-sm">
        {t('streamerMode.turnOff')}
      </button>
    </div>
  );
}

/**
 * For a value that goes into a sentence, a field or an attribute: the value,
 * or the dots. A field shown this way is read-only for as long.
 */
export function useSensitiveText(): (value: string) => string {
  const on = useStreamerMode();
  return useCallback((value: string) => (on ? STREAMER_MASK : value), [on]);
}
