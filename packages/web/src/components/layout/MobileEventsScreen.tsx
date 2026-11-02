import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { SpaceEventsView } from '../events/SpaceEventsView';
import { BAR_BUTTON, BAR_TITLE } from './mobileClasses';

/** A space's events as a screen of their own. */
export function MobileEventsScreen({ params }: { params?: Record<string, string> }) {
  const { t } = useTranslation(['spaces', 'common']);
  const popMobileScreen = useUIStore((state) => state.popMobileScreen);
  const spaceId = params?.spaceId;
  if (!spaceId) return null;
  return (
    <div className="lit flex h-full flex-col bg-surface-chat">
      <header className="panel-bar flex h-12 items-center gap-1 bg-surface-base px-1">
        <button type="button" onClick={popMobileScreen} className={BAR_BUTTON} aria-label={t('common:actions.back')}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className={BAR_TITLE}>{t('spaces:events.title')}</h1>
      </header>
      <SpaceEventsView spaceId={spaceId} />
    </div>
  );
}
