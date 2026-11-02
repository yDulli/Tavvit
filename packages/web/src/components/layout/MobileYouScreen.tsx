import { StatusPicker } from '../ui/StatusPicker';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { parseFederatedUsername } from '../../utils/identity';
import { replaceEmojiShortcodes, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { useFederationEnabled } from '../../hooks/useFederationEnabled';
import { bannerBackground, cardTint, profileThemeOf } from '../../utils/profileTheme';
import { MobileNavRow } from './MobileNavRow';
import { BAR_BUTTON, BAR_TITLE } from './mobileClasses';

/**
 * A row on the You screen. `badge` is drawn at the trailing edge, before the
 * chevron; a badge must name itself.
 */
interface ActionRow {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  badge?: React.ReactNode;
}

export function MobileYouScreen() {
  useEmojiShortcodeNames();
  const { t } = useTranslation(['mobile', 'settings', 'common', 'admin', 'home']);
  const pushMobileScreen = useUIStore((s) => s.pushMobileScreen);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const federation = useFederationEnabled() === true;

  if (!user) return null;

  const avatarUrl = user.avatar ? `/api/uploads/${user.avatar}` : null;
  const bannerUrl = user.banner ? `/api/uploads/${user.banner}` : null;
  const theme = profileThemeOf(user);

  const actionRows: ActionRow[] = [
    {
      label: t('mobile:you.editProfile'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
      action: () => pushMobileScreen('settings-account'),
    },
    {
      label: t('common:labels.friends'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
      action: () => pushMobileScreen('friends'),
    },
    ...(federation ? [{
      label: t('settings:nav.tabs.connections'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.122a4.5 4.5 0 00-6.364-6.364L4.5 6.325a4.5 4.5 0 001.242 7.244" />
        </svg>
      ),
      action: () => pushMobileScreen('settings-connections'),
    }] : []),
    {
      label: t('settings:nav.tabs.voice'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      ),
      action: () => pushMobileScreen('settings-voice'),
    },
    {
      label: t('home:nav.about'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      ),
      action: () => pushMobileScreen('about'),
    },
  ];

  return (
    <div className="lit flex flex-col h-full bg-surface-channel">
      {/* Header with settings gear */}
      <header className="panel-bar flex h-12 items-center gap-1 pl-4 pr-1">
        <h1 className={BAR_TITLE}>{t('mobile:nav.you')}</h1>
        <button
          type="button"
          onClick={() => pushMobileScreen('settings')}
          className={BAR_BUTTON}
          aria-label={t('common:labels.settings')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Profile card: a step lighter than the list it stands on */}
        <div
          className="mx-4 mt-4 overflow-hidden rounded-lg border border-border-hard bg-surface-chat"
          style={theme ? { backgroundImage: cardTint(theme) } : undefined}
        >
          {/* Banner or accent background */}
          <div
            className="h-20 relative"
            style={{
              background: bannerUrl
                ? `url(/api/uploads/${user.banner}) center/cover`
                : theme
                  ? bannerBackground(theme)
                  : 'rgb(var(--bg-elevated))',
            }}
          />

          {/* Avatar overlay */}
          <div className="px-4 -mt-10 relative z-10">
            <Avatar
              src={avatarUrl}
              name={user.displayName ?? user.username}
              avatarColor={user.avatarColor}
              size={72}
              ring={{ width: 4, color: 'rgb(var(--bg-chat))' }}
            />
          </div>

          {/* User info */}
          <div className="px-4 pb-4 pt-2">
            <h2 className="break-words text-title font-semibold tracking-[-0.015em] text-txt-primary">
              {user.displayName ?? user.username}
            </h2>
            <p className="break-words text-ui text-txt-secondary">@{user.username}</p>
            {(() => {
              const { domain } = parseFederatedUsername(user.username);
              if (!domain) return null;
              return <div className="text-2xs leading-[1.3] text-txt-tertiary opacity-60">{t('mobile:you.homeInstance', { domain })}</div>;
            })()}
            {user.customStatus && (
              <p className="break-words text-ui text-txt-secondary mt-1">{replaceEmojiShortcodes(user.customStatus)}</p>
            )}
            {user.bio && (
              <p className="break-words text-ui text-txt-message mt-2 whitespace-pre-wrap">{replaceEmojiShortcodes(user.bio)}</p>
            )}
          </div>
        </div>

        <StatusPicker className="mx-4 mt-3" />

        {/* Action rows: the same flat list as the settings hub */}
        <div className="mt-3 border-t border-border-hard py-1">
          {actionRows.map((row) => (
            <MobileNavRow key={row.label} icon={row.icon} label={row.label} badge={row.badge} onClick={row.action} />
          ))}
        </div>

        {/* Log out */}
        <div className="border-t border-border-hard py-1">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="list-row min-h-12 w-full rounded-none px-4 py-2 text-txt-danger hover:bg-accent-rose/10 active:bg-accent-rose/15"
          >
            <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-body">{t('settings:nav.logOut')}</span>
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <ConfirmDialog
          isOpen={true}
          title={t('settings:nav.logOut')}
          description={t('mobile:you.logOutConfirm')}
          confirmLabel={t('settings:nav.logOut')}
          cancelLabel={t('common:actions.cancel')}
          onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
          onClose={() => setShowLogoutConfirm(false)}
          variant="danger"
        />
      )}
    </div>
  );
}
