import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInboxCount } from '../../hooks/useInboxCount';
import { useAuthStore } from '../../stores/authStore';
import { openReviewTotal, useReviewStore } from '../../stores/reviewStore';
import { HOME_ROUTES } from '../../utils/homeNav';
import { CountBadge } from '../ui/CountBadge';
import { Icon } from '../ui/Icon';
import { StreamerModeBadge } from './StreamerModeBadge';
import { Crumb, CrumbSep, useTopbarSlotSetters } from './TopbarSlots';

/** The instance this app speaks for, as the first step of every breadcrumb: its host, in mono. */
export function instanceCrumb(): string {
  return typeof window === 'undefined' ? 'tavvit' : window.location.host;
}

/** The name of a page of the app's own, read from its address, for a page that names none. */
function usePageName(): string | null {
  const { t } = useTranslation(['home', 'common', 'spaces', 'settings', 'dm']);
  const { pathname } = useLocation();
  if (pathname === HOME_ROUTES.inbox) return t('home:nav.inbox');
  if (pathname === HOME_ROUTES.friends) return t('common:labels.friends');
  if (pathname === HOME_ROUTES.explore) return t('spaces:sidebar.dmList.explore');
  if (pathname === HOME_ROUTES.about) return t('home:nav.about');
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return t('common:labels.adminConsole');
  if (pathname === '/studio') return t('settings:studio.title');
  if (pathname.startsWith('/channels/@me')) return t('home:nav.home');
  return null;
}

/**
 * The bar across the top of the page column (Evolve's topbar): where you are as a breadcrumb,
 * the page's own actions, and what waits for you everywhere (the inbox with its count, the review
 * queue of an administrator, streamer mode's mark). 56px, so its hairline continues the one under
 * the sidebar's head. A page puts its breadcrumb and actions here through `TopbarLead` and
 * `TopbarActions`; one that puts none shows the default below.
 */
export function AppTopbar() {
  const { t } = useTranslation(['common', 'home']);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const slots = useTopbarSlotSetters();
  const pageName = usePageName();
  const onInbox = pathname === HOME_ROUTES.inbox;
  const inboxCount = useInboxCount();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const onAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  const adminCount = useReviewStore((s) => openReviewTotal(s.queue) + (s.reportsOpen ?? 0));
  const inboxCountId = useId();

  return (
    <header
      data-pip-obstacle="top"
      // Its tooltips open below it: above is the edge of the window.
      data-tooltip-side="bottom"
      className="app-topbar relative z-[60] flex h-[var(--topbar-height)] flex-shrink-0 items-center gap-3 border-b border-border-hard px-5"
    >
      <nav aria-label={t('common:labels.whereYouAre')} className="topbar-lead flex min-w-0 flex-1 items-center gap-2">
        <span className="topbar-default flex min-w-0 items-center gap-2">
          <Crumb mono onClick={() => navigate(HOME_ROUTES.home)}>{instanceCrumb()}</Crumb>
          {pageName && (
            <>
              <CrumbSep />
              <Crumb current>{pageName}</Crumb>
            </>
          )}
        </span>
        <div ref={slots?.setLead} className="topbar-slot flex min-w-0 flex-1 items-center gap-2" />
      </nav>

      <div className="flex flex-shrink-0 items-center gap-1">
        <div ref={slots?.setActions} className="topbar-actions flex items-center gap-1" />
        <span aria-hidden="true" className="topbar-divider mx-1.5 h-5 w-px bg-border-hard" />
        <StreamerModeBadge />
        <button
          type="button"
          onClick={() => navigate(HOME_ROUTES.inbox)}
          data-active={onInbox}
          aria-current={onInbox ? 'page' : undefined}
          aria-label={t('home:nav.inbox')}
          aria-describedby={inboxCount > 0 ? inboxCountId : undefined}
          className="icon-btn icon-btn-lg relative"
        >
          <Icon name="bell" size={17} />
          {inboxCount > 0 && <CountBadge count={inboxCount} placement="corner" />}
          {inboxCount > 0 && <span id={inboxCountId} className="sr-only">{t('home:inbox.navLabel', { count: inboxCount })}</span>}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate('/admin')}
            data-active={onAdmin}
            aria-current={onAdmin ? 'page' : undefined}
            aria-label={t('common:labels.adminConsole')}
            className="icon-btn icon-btn-lg relative"
          >
            <Icon name="shield" size={17} />
            {adminCount > 0 && <CountBadge count={adminCount} placement="corner" />}
          </button>
        )}
      </div>
    </header>
  );
}
