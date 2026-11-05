import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInboxCount } from '../../hooks/useInboxCount';
import { useAuthStore } from '../../stores/authStore';
import { openReviewTotal, useReviewStore } from '../../stores/reviewStore';
import { HOME_ROUTES } from '../../utils/homeNav';
import { useQuickSwitcherStore } from '../../stores/quickSwitcherStore';
import { switcherKeyShortcuts, switcherShortcut } from '../../utils/quickSwitcher';
import { CountBadge } from '../ui/CountBadge';
import { Icon } from '../ui/Icon';
import { SpaceSidebar } from './SpaceSidebar';
import { UserControls } from './UserControls';

/**
 * The bar across the top of the desktop app: the mark, every place a person can
 * be (Home and their spaces, as tabs), the way to find anything (the quick
 * switcher), what needs attention (the inbox, with its count, reachable from
 * every space), and their own switches and identity on the right.
 *
 * It is the one structural element the layout starts from: the spaces are a row
 * of named tabs here, not a column of icons, so where you are reads as words.
 * The mark stays white; the violet belongs to the tab you are on and to counts.
 * In a compact window the wordmark and the search field's text fold away, so
 * the tabs keep their room.
 */
export function TopBar() {
  const { t } = useTranslation(['common', 'home']);
  const openSwitcher = useQuickSwitcherStore((s) => s.setOpen);
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
      className="lit relative z-[60] flex h-[var(--topbar-height)] flex-shrink-0 items-stretch border-b border-border-hard bg-surface-base"
    >
      <div className="flex flex-shrink-0 items-center gap-2 pl-4 pr-3 compact:pl-3 compact:pr-2">
        <img src="/icons/logo-mark.svg" alt="" className="h-5 w-5" />
        <span className="text-body font-semibold tracking-[-0.01em] text-txt-primary compact:hidden">{t('common:appName')}</span>
      </div>
      <span aria-hidden="true" className="my-3.5 w-px flex-shrink-0 bg-border-hard" />

      <SpaceSidebar />

      <div className="flex flex-shrink-0 items-center gap-1 pl-2 pr-1">
        <button
          type="button"
          onClick={() => openSwitcher(true)}
          aria-label={t('common:actions.search')}
          aria-keyshortcuts={switcherKeyShortcuts()}
          // In a compact window only the glass shows: its tooltip names it, with the shortcut.
          data-tooltip=""
          data-tooltip-keys={switcherShortcut()}
          className="mr-1 flex h-8 w-[148px] items-center gap-2 rounded-md border border-border-soft bg-surface-input pl-2.5 pr-1.5 text-left text-ui text-txt-tertiary transition-colors hover:border-interactive-muted hover:text-txt-secondary active:bg-interactive-hover compact:mr-0 compact:w-8 compact:justify-center compact:px-0"
        >
          <Icon name="search" size={15} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate compact:hidden">{t('common:actions.search')}</span>
          <kbd className="kbd compact:hidden">{switcherShortcut()}</kbd>
        </button>
        <button
          type="button"
          onClick={() => navigate(HOME_ROUTES.inbox)}
          data-active={onInbox}
          aria-current={onInbox ? 'page' : undefined}
          aria-label={t('home:nav.inbox')}
          aria-describedby={inboxCount > 0 ? inboxCountId : undefined}
          className="icon-btn icon-btn-lg relative"
        >
          <Icon name="bell" size={18} />
          {inboxCount > 0 && <CountBadge count={inboxCount} placement="corner" />}
          {/* What is waiting: read after the name, and the tooltip's second line. */}
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
            <Icon name="shield" size={18} />
            {adminCount > 0 && <CountBadge count={adminCount} placement="corner" />}
          </button>
        )}
      </div>

      <UserControls />
    </header>
  );
}
