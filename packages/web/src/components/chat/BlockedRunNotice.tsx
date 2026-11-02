import { useTranslation } from 'react-i18next';

interface BlockedRunNoticeProps {
  /** How many consecutive messages from blocked people this stands for. */
  count: number;
  revealed: boolean;
  onToggle: () => void;
}

/**
 * The one quiet line a run of blocked people's messages collapses to. It sits
 * above the run when the run is revealed, so the way back is where the eye is.
 */
export function BlockedRunNotice({ count, revealed, onToggle }: BlockedRunNoticeProps) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex items-center gap-2 px-5 py-1 text-ui text-txt-tertiary select-none" data-testid="blocked-run">
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.6 5.6l12.8 12.8" />
      </svg>
      <span>{t('blocked.run', { count })}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={revealed}
        className="text-txt-link hover:underline"
      >
        {revealed ? t('blocked.hide') : t('blocked.show')}
      </button>
    </div>
  );
}
