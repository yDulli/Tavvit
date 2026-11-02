import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router-dom';
import { useFormatters } from '../../i18n/formatters';
import { eventSpaceKey, useEventStore } from '../../stores/eventStore';
import { useUIStore } from '../../stores/uiStore';
import { CountBadge } from '../ui/CountBadge';
import { Icon } from '../ui/Icon';
import { useSpaceOrigin } from './SpaceEventsView';

/** The way to a space's events, at the top of its channels, with how many are coming up. */
export function SpaceEventsRow({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('spaces');
  const { formatNumber } = useFormatters();
  const navigate = useNavigate();
  const origin = useSpaceOrigin(spaceId);
  const isMobile = useUIStore((state) => state.isMobile);
  const active = useMatch('/channels/:spaceId/events')?.params.spaceId === spaceId;
  const upcoming = useEventStore((state) => {
    const now = Date.now();
    return state.bySpace.get(eventSpaceKey(origin, spaceId))?.filter((event) => (event.endsAt ?? event.startsAt) >= now).length ?? 0;
  });

  useEffect(() => {
    // The row works without a count; the page says so when it cannot load them.
    useEventStore.getState().load(origin, spaceId).catch(() => undefined);
  }, [origin, spaceId]);

  const open = () => {
    if (isMobile) useUIStore.getState().pushMobileScreen('space-events', { spaceId });
    else navigate(`/channels/${spaceId}/events`);
  };

  return (
    <button
      type="button"
      onClick={open}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      className={`nav-item group w-full text-left ${isMobile ? 'h-10 gap-2 px-2 text-body' : ''}`}
    >
      <Icon name="calendar" size={16} className={`flex-shrink-0 ${active ? 'text-txt-primary' : 'text-txt-tertiary group-hover:text-txt-secondary'}`} />
      <span className="min-w-0 flex-1 truncate">{t('events.title')}</span>
      {upcoming > 0 && <CountBadge count={upcoming} muted label={t('events.upcomingCount', { count: upcoming, formatted: formatNumber(upcoming) })} />}
    </button>
  );
}
