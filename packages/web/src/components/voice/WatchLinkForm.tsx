import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseWatchUrl } from '@backspace/shared/src/watch';
import { describeError, describeErrorCode } from '../../i18n/errors';
import { useWatchStore } from '../../stores/watchStore';

/**
 * A link to watch together, for the call on `channelId` (docs/systems/watch-together.md): it starts
 * a session when none runs, and waits in the queue when one does. What a link may be is checked
 * here only to say so at once; the server decides.
 */
export function WatchLinkForm({ channelId, running, onDone, autoFocus }: {
  channelId: string;
  /** Whether something plays already, so the link joins the queue. */
  running: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation(['voice']);
  const fieldId = useId();
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!parseWatchUrl(url)) {
      setProblem(describeErrorCode('watch_link_unsupported', 'That link cannot be played here.'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await useWatchStore.getState().add(channelId, url.trim());
      setUrl('');
      onDone?.();
    } catch (err) {
      setProblem(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="field-label">{t('voice:watch.linkLabel')}</label>
      <input
        id={fieldId}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={url}
        onChange={(event) => { setUrl(event.target.value); setProblem(null); }}
        placeholder={t('voice:watch.linkPlaceholder')}
        aria-invalid={problem !== null}
        aria-describedby={`${fieldId}-hint`}
        className="input-standard"
      />
      <p id={`${fieldId}-hint`} className={`text-meta ${problem ? 'text-txt-danger' : 'text-txt-tertiary'}`} role={problem ? 'alert' : undefined}>
        {problem ?? t('voice:watch.hint')}
      </p>
      <button type="submit" className="btn-primary btn-sm self-end" disabled={url.trim().length === 0} aria-busy={busy}>
        {running ? t('voice:watch.queueAdd') : t('voice:watch.start')}
      </button>
    </form>
  );
}
