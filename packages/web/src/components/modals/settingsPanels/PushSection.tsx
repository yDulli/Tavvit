import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../../i18n/errors';
import { useAuthStore } from '../../../stores/authStore';
import { disablePush, enablePush, readPushState, type PushState } from '../../../utils/pushSubscription';
import { SettingsSection, ToggleRow } from './_shared/SettingsControls';

/**
 * Push on this device: notifications while the app is closed. The desktop app has its own
 * and sees none of this; a browser that cannot do it says nothing either, except an iPhone,
 * which can once the app is on its Home Screen.
 */
export function PushSection() {
  const { t } = useTranslation('settings');
  const userId = useAuthStore((s) => s.user?.id);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) return undefined;
    let stale = false;
    readPushState(userId)
      .then((value) => { if (!stale) setState(value); })
      .catch(() => { if (!stale) setState('unsupported'); });
    return () => { stale = true; };
  }, [userId]);

  if (!userId || state === null || state === 'unsupported') return null;

  const change = async (on: boolean) => {
    setBusy(true);
    setError('');
    try {
      setState(await (on ? enablePush(userId) : disablePush(userId)));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={t('notifications.push.title')}>
      {state === 'install-first' && <p className="text-ui leading-relaxed text-txt-secondary">{t('notifications.push.installFirst')}</p>}
      {state === 'denied' && <p className="text-ui leading-relaxed text-txt-secondary">{t('notifications.push.denied')}</p>}
      {(state === 'on' || state === 'off') && (
        <ToggleRow
          label={t('notifications.push.toggle')}
          description={t('notifications.push.toggleHint')}
          enabled={state === 'on'}
          disabled={busy}
          onChange={(on) => void change(on)}
        />
      )}
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
    </SettingsSection>
  );
}
