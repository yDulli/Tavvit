import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { USERNAME_LIMITS, isUsernameShape, normalizeUsername, usernameChangeAllowedAt } from '@backspace/shared/src/usernames';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { FormError, SettingsField, SettingsSection } from './_shared/SettingsControls';
import { TwoFactorCodeField } from './TwoFactorSection';

/**
 * The name someone signs in with and is found by. It can change once in 30 days, and only
 * where the account lives. The server decides all of this; what stands here is what it would say.
 */
export function UsernameSection() {
  const { t } = useTranslation(['settings', 'common']);
  const f = useFormatters();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const addToast = useUIStore((s) => s.addToast);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;

  const close = () => {
    setEditing(false);
    setUsername('');
    setPassword('');
    setTwoFactorCode('');
    setError('');
  };

  const wanted = normalizeUsername(username);
  const shapeOk = isUsernameShape(wanted);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!shapeOk || !password) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.users.changeUsername({
        username: wanted,
        password,
        ...(twoFactorCode.trim() ? { twoFactorCode: twoFactorCode.trim() } : {}),
      });
      setUser(response.user);
      addToast(t('settings:account.username.changed', { username: response.user.username }), 'success', 3000);
      close();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const homeElsewhere = Boolean(user.homeInstance) || user.username.includes('@');
  const connected = !homeElsewhere && (user.replicatedInstances?.length ?? 0) > 0;
  const allowedAt = usernameChangeAllowedAt(user.usernameChangedAt);
  const waiting = !homeElsewhere && !connected && allowedAt > Date.now();
  const note = homeElsewhere
    ? t('settings:account.username.homeOnly')
    : connected
      ? t('settings:account.username.connected')
      : waiting
        ? t('settings:account.username.nextChange', { date: f.formatMediumDate(allowedAt) })
        : null;

  return (
    <SettingsSection title={t('common:labels.username')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-ui text-txt-primary">@{user.username}</span>
        {!note && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn-outline btn-sm">
            {t('settings:account.username.change')}
          </button>
        )}
      </div>
      {note && <p className="mt-2 text-meta leading-snug text-txt-tertiary">{note}</p>}

      {editing && !note && (
        <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
          <SettingsField label={t('settings:account.username.newLabel')} htmlFor="username-new">
            <input
              id="username-new"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              maxLength={USERNAME_LIMITS.MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-invalid={username.length > 0 && !shapeOk}
              className="input-standard w-full font-mono"
            />
            <p className="mt-1.5 text-meta text-txt-tertiary">
              {t('settings:account.username.hint', { min: USERNAME_LIMITS.MIN_LENGTH, max: USERNAME_LIMITS.MAX_LENGTH })}
            </p>
          </SettingsField>
          <SettingsField label={t('common:labels.password')} htmlFor="username-password">
            <input
              id="username-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="input-standard w-full"
            />
          </SettingsField>
          <TwoFactorCodeField id="username-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />
          <p className="text-meta leading-snug text-txt-secondary">
            {t('settings:account.username.warning', { days: USERNAME_LIMITS.CHANGE_EVERY_DAYS })}
          </p>
          {error && <FormError>{error}</FormError>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-quiet">{t('common:actions.cancel')}</button>
            <button type="submit" disabled={busy || !shapeOk || !password} aria-busy={busy} className="btn-primary">
              {t('settings:account.username.submit')}
            </button>
          </div>
        </form>
      )}
    </SettingsSection>
  );
}
