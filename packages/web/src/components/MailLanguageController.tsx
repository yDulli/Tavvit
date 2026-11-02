import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { isSupportedLanguage } from '../i18n/languages';
import { useAuthStore } from '../stores/authStore';

/**
 * Tells the server which language this account reads, so that mail arrives in it. The
 * language is a choice kept in the browser, and mail is written where no browser is there
 * to ask. Renders nothing.
 */
export function MailLanguageController(): null {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const id = useAuthStore((s) => s.user?.id);
  const homeInstance = useAuthStore((s) => s.user?.homeInstance);
  const known = useAuthStore((s) => s.user?.locale);

  useEffect(() => {
    if (!id || homeInstance || known === language || !isSupportedLanguage(language)) return;
    let cancelled = false;
    api.users.setLocale(language)
      .then(() => {
        if (cancelled) return;
        const current = useAuthStore.getState().user;
        if (current?.id === id) useAuthStore.getState().setUser({ ...current, locale: language });
      })
      // Mail then comes in the language last known; the next load asks again.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, homeInstance, known, language]);

  return null;
}
