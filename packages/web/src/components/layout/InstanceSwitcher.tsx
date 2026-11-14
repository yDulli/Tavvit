import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useAuthStore } from '../../stores/authStore';
import { useContextMenuStore, type ContextMenuItem } from '../../stores/contextMenuStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { HOME_ROUTES } from '../../utils/homeNav';
import { Icon } from '../ui/Icon';
import { instanceCrumb } from './AppTopbar';

/**
 * The head of the sidebar (Evolve's organisation switcher): the server this app speaks for, its
 * name and its address, in a 56px row whose hairline continues the topbar's. Its menu holds what
 * belongs to the server as a whole: finding, making and joining spaces, what the server is, the
 * console for its administrators, the settings and signing out.
 */
export function InstanceSwitcher() {
  const { t } = useTranslation(['spaces', 'home', 'common', 'settings']);
  const info = useHomeInstanceInfo();
  const navigate = useNavigate();
  const openMenu = useContextMenuStore((s) => s.open);
  const openModal = useUIStore((s) => s.openModal);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const logout = useAuthStore((s) => s.logout);
  const leaveSpace = () => {
    useSpaceStore.getState().setCurrentSpace(null);
  };
  const name = info?.name || t('common:appName');

  const open = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const items: ContextMenuItem[] = [
      {
        key: 'explore',
        type: 'action',
        label: t('spaces:sidebar.exploreSpaces'),
        icon: <Icon name="compass" size={16} />,
        onClick: () => {
          leaveSpace();
          navigate(HOME_ROUTES.explore);
        },
      },
      { key: 'create', type: 'action', label: t('spaces:sidebar.addSpace'), icon: <Icon name="plus" size={16} />, onClick: () => openModal('createSpace') },
      { key: 'join', type: 'action', label: t('spaces:sidebar.joinSpace'), icon: <Icon name="login" size={16} />, onClick: () => openModal('joinSpace') },
      { key: 'sep-server', type: 'separator' },
      {
        key: 'about',
        type: 'action',
        label: t('home:nav.about'),
        icon: <Icon name="info" size={16} />,
        onClick: () => {
          leaveSpace();
          navigate(HOME_ROUTES.about);
        },
      },
      {
        key: 'admin',
        type: 'action',
        hidden: !isAdmin,
        label: t('common:labels.adminConsole'),
        icon: <Icon name="shield" size={16} />,
        onClick: () => navigate('/admin'),
      },
      { key: 'settings', type: 'action', label: t('common:labels.settings'), icon: <Icon name="settings" size={16} />, onClick: () => openModal('userSettings', {}) },
      { key: 'sep-session', type: 'separator' },
      { key: 'logout', type: 'action', label: t('settings:nav.logOut'), danger: true, icon: <Icon name="logout" size={16} />, onClick: () => logout() },
    ];
    // The menu opens under the row, aligned with its left edge, as a dropdown does (in the pointer's
    // own pixels, as every caller of the menu gives them).
    openMenu({ x: rect.left, y: rect.bottom + 4 }, items);
  };

  return (
    <div className="sidebar-head flex h-[var(--topbar-height)] flex-shrink-0 items-center border-b border-border-hard px-2.5">
      <button
        type="button"
        onClick={(event) => open(event.currentTarget)}
        aria-haspopup="menu"
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-interactive-hover active:bg-interactive-active"
      >
        <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md border border-border-soft bg-surface-raised">
          <img src="/icons/logo-mark.svg" alt="" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium leading-tight text-txt-primary">{name}</span>
          <span className="block truncate font-mono text-2xs leading-tight text-txt-tertiary">{instanceCrumb()}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-txt-tertiary transition-colors group-hover:text-txt-secondary">
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </svg>
      </button>
    </div>
  );
}
