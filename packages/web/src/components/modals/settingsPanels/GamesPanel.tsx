import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useActivityStore } from '../../../stores/activityStore';
import { useUIStore } from '../../../stores/uiStore';
import { getElectronAPI, type GameDetection } from '../../../platform/platform';
import { Icon } from '../../ui/Icon';
import { SettingsPage, SettingsSection, ToggleRow } from './_shared/SettingsControls';

function activityName(activity: unknown): string | null {
  if (activity && typeof activity === 'object' && typeof (activity as { name?: unknown }).name === 'string') {
    return (activity as { name: string }).name;
  }
  return null;
}

/**
 * Settings → Games: show friends what you are playing, the way the desktop app
 * sees it.
 *
 * Only the desktop app can see which programs run, so in a browser this page
 * says so and points at the download instead of offering a switch that could
 * not work. In the desktop app detection is on until turned off here: it shows
 * a game it recognises (started from Steam, Epic Games or GOG, or on its list)
 * as their activity, and stops looking the moment it is turned off. Nobody
 * picks from the programs on their computer here; what someone added while the
 * app still offered that stays listed until they remove it. Whether friends see
 * the activity at all is the separate sharing switch under Privacy. A desktop
 * app from before game detection is told to update rather than that it is a
 * browser.
 */
export function GamesPanel() {
  const { t } = useTranslation(['settings']);
  const navigate = useNavigate();
  const closeModal = useUIStore((s) => s.closeModal);
  const showActivity = useActivityStore((s) => s.showActivity);
  const electron = getElectronAPI();
  const supported = typeof electron?.getGameDetection === 'function';

  const [state, setState] = useState<GameDetection | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: GameDetection) => {
    setState(next);
    setCurrent(activityName(next.current));
  }, []);

  useEffect(() => {
    if (!supported || !electron?.getGameDetection) return;
    let active = true;
    void electron.getGameDetection().then((next) => { if (active) apply(next); });
    const off = electron.onActivityDetected((activity) => { if (active) setCurrent(activityName(activity)); });
    return () => { active = false; off(); };
  }, [supported, electron, apply]);

  if (!supported || !electron) {
    return (
      <SettingsPage title={t('settings:nav.tabs.games')}>
        <SettingsSection title={t('settings:games.title')} description={t('settings:games.intro')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-60 text-ui leading-relaxed text-txt-secondary">
              {electron ? t('settings:games.updateApp') : t('settings:games.browserOnly')}
            </p>
            <button
              type="button"
              className="btn-outline"
              onClick={() => { closeModal(); navigate('/download'); }}
            >
              <Icon name="download" size={15} />
              {t('settings:games.getDesktop')}
            </button>
          </div>
        </SettingsSection>
      </SettingsPage>
    );
  }

  const setEnabled = async (enabled: boolean) => {
    if (!electron.setGameDetectionEnabled) return;
    setBusy(true);
    try {
      apply(await electron.setGameDetectionEnabled(enabled));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (gameProcess: string) => {
    if (!electron.removeDetectedGame) return;
    apply(await electron.removeDetectedGame(gameProcess));
  };

  return (
    <SettingsPage title={t('settings:nav.tabs.games')}>
      <SettingsSection title={t('settings:games.title')} description={t('settings:games.intro')}>
        <ToggleRow
          label={t('settings:games.detect.label')}
          description={t('settings:games.detect.description')}
          enabled={state?.enabled ?? false}
          onChange={(enabled) => { if (!busy) void setEnabled(enabled); }}
        />
        {state?.enabled && (
          <div className="border-t border-border-hard pt-4">
            <p className="label-mono">{t('settings:games.now.title')}</p>
            <p className="mt-1.5 flex items-center gap-2 text-ui text-txt-primary">
              {current ? (
                <>
                  <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-status-online" />
                  {t('settings:games.now.playing', { name: current })}
                </>
              ) : (
                <span className="text-txt-tertiary">{t('settings:games.now.none')}</span>
              )}
            </p>
            {!showActivity && <p className="mt-2 text-meta text-txt-warning">{t('settings:games.sharingOff')}</p>}
          </div>
        )}
      </SettingsSection>

      {state?.enabled && state.userGames.length > 0 && (
        <SettingsSection title={t('settings:games.mine.title')} description={t('settings:games.mine.description')}>
          <ul className="-my-2 divide-y divide-border-hard">
            {state.userGames.map((game) => (
              <li key={game.process} className="flex items-center gap-3 py-2">
                <Icon name="grid" size={16} className="flex-shrink-0 text-txt-tertiary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-txt-primary">{game.name}</span>
                  <span className="block truncate font-mono text-label text-txt-tertiary">{game.process}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { void remove(game.process); }}
                  aria-label={t('settings:games.mine.remove', { name: game.name })}
                  title={t('settings:games.mine.remove', { name: game.name })}
                  className="icon-btn flex-shrink-0 hover:bg-accent-rose/10 hover:text-txt-danger"
                >
                  <Icon name="x" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
