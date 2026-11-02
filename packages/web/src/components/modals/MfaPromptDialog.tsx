import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMfaPromptStore } from '../../stores/mfaPromptStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FormError, SettingsField } from './settingsPanels/_shared/SettingsControls';

/** The code an instance asks for when signing in to it from inside the app (`useMfaPromptStore`). */
export function MfaPromptDialog() {
  const { t } = useTranslation(['auth', 'settings']);
  const origin = useMfaPromptStore((s) => s.origin);
  const problem = useMfaPromptStore((s) => s.problem);
  const answer = useMfaPromptStore((s) => s.answer);
  const cancel = useMfaPromptStore((s) => s.cancel);
  const [code, setCode] = useState('');

  if (origin === null) return null;
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // An origin without a scheme is shown as it is.
  }

  return (
    <ConfirmDialog
      isOpen
      onClose={() => { setCode(''); cancel(); }}
      onConfirm={() => { const typed = code.trim(); setCode(''); if (typed) answer(typed); }}
      title={t('auth:mfa.title')}
      description={(
        <div className="space-y-3">
          <p>{t('auth:mfa.remote', { host })}</p>
          {problem && <FormError>{problem}</FormError>}
          <SettingsField label={t('settings:security.twoFactor.codeLabel')} htmlFor="mfa-prompt-code">
            <input
              id="mfa-prompt-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input-standard w-full font-mono"
              autoComplete="one-time-code"
              spellCheck={false}
              autoFocus
            />
          </SettingsField>
        </div>
      )}
      variant="warning"
      confirmLabel={t('auth:mfa.submit')}
    />
  );
}
