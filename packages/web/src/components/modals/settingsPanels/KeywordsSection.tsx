import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cleanKeyword, KEYWORD_LIMITS } from '@backspace/shared/src/notificationRules';
import { describeError } from '../../../i18n/errors';
import { useKeywordStore } from '../../../stores/keywordStore';
import { Icon } from '../../ui/Icon';
import { SettingsSection } from './_shared/SettingsControls';

/** The words that alert this person like a mention. The rule is shared: sound, notification and push read the same list. */
export function KeywordsSection() {
  const { t } = useTranslation('settings');
  const fieldId = useId();
  const words = useKeywordStore((state) => state.words);
  const saveWords = useKeywordStore((state) => state.set);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const store = async (next: string[]) => {
    setBusy(true);
    setError('');
    try {
      await saveWords(next);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const word = cleanKeyword(draft);
  const canAdd = word !== null && !words.includes(word) && words.length < KEYWORD_LIMITS.MAX && !busy;

  const submit = async (submitted: React.FormEvent) => {
    submitted.preventDefault();
    if (!canAdd || word === null) return;
    await store([...words, word]);
    setDraft('');
  };

  return (
    <SettingsSection title={t('notifications.keywords.title')} description={t('notifications.keywords.description')}>
      <form onSubmit={(submitted) => void submit(submitted)} className="flex items-center gap-1.5">
        <label htmlFor={`${fieldId}-word`} className="sr-only">{t('notifications.keywords.placeholder')}</label>
        <input
          id={`${fieldId}-word`}
          type="text"
          value={draft}
          maxLength={KEYWORD_LIMITS.MAX_LENGTH}
          placeholder={t('notifications.keywords.placeholder')}
          onChange={(change) => setDraft(change.target.value)}
          className="input-standard min-w-0 flex-1"
        />
        <button type="submit" disabled={!canAdd} aria-busy={busy} className="btn-outline flex-shrink-0">
          {t('notifications.keywords.add')}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-meta text-txt-danger">{error}</p>}
      {words.length > 0 && (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {words.map((item) => (
              <li key={item} className="glass-pill flex items-center gap-1 rounded-md py-0.5 pl-2 pr-0.5 text-meta text-txt-primary">
                <span className="max-w-[16rem] truncate">{item}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void store(words.filter((other) => other !== item))}
                  className="icon-btn h-5 w-5"
                  aria-label={t('notifications.keywords.remove', { word: item })}
                  title={t('notifications.keywords.remove', { word: item })}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-label text-txt-tertiary">
            {t('notifications.keywords.limit', { used: words.length, max: KEYWORD_LIMITS.MAX })}
          </p>
        </>
      )}
    </SettingsSection>
  );
}
