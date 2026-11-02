import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useAuthStore } from '../../stores/authStore';
import { openUserSettings } from '../../utils/openUserSettings';

const DISMISSED_KEY = 'tavvit-email-prompt-dismissed';
const DISMISSED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(`${DISMISSED_KEY}:${userId}`) ?? 0);
    return Date.now() - at < DISMISSED_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * A slim bar for an account without a confirmed address, on a server that sends mail. For an
 * older account it is only a suggestion, and "not now" puts it away for a month. For a new one
 * on a server that requires it (docs/systems/email.md, "The gate") it stays, because it
 * says why some things are refused.
 */
export function EmailPromptBar() {
  const { t } = useTranslation('common');
  const info = useHomeInstanceInfo();
  const user = useAuthStore((s) => s.user);
  const [dismissed, setDismissed] = useState(false);

  if (!info?.email || !user || user.homeInstance || user.isDeleted || user.emailVerified) return null;
  const required = user.emailVerificationRequired === true;
  if (!required && (dismissed || dismissedRecently(user.id))) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(`${DISMISSED_KEY}:${user.id}`, String(Date.now()));
    } catch {
      // Then it comes back on the next load; nothing depends on it.
    }
    setDismissed(true);
  };

  const message = required
    ? t('emailPrompt.required')
    : user.email
      ? t('emailPrompt.unconfirmed', { address: user.email })
      : t('emailPrompt.missing');

  return (
    <div role="status" className="flex flex-shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border-hard bg-surface-channel px-3 py-1.5 text-meta text-txt-secondary">
      <span className="min-w-0 break-words text-center">{message}</span>
      <span className="flex flex-shrink-0 items-center gap-1">
        <button type="button" onClick={() => openUserSettings('security')} className="btn-outline btn-sm">
          {t('emailPrompt.open')}
        </button>
        {!required && (
          <button type="button" onClick={dismiss} className="btn-quiet btn-sm">{t('emailPrompt.dismiss')}</button>
        )}
      </span>
    </div>
  );
}
