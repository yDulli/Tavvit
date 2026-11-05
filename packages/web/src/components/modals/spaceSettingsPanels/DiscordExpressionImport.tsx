import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DISCORD_SNOWFLAKE,
  discordAssetUrl,
  type DiscordExpressionApplyResult,
  type DiscordExpressionItem,
  type DiscordExpressionOutcome,
  type DiscordExpressionPreview,
  type DiscordExpressionResult,
} from '@backspace/shared/src/discordExpressionImport';
import { HttpError, RequestTimeoutError } from '../../../api/client';
import { describeError, describeErrorCode } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { getApiForOrigin } from '../../../stores/spaceStore';
import { Icon } from '../../ui/Icon';
import { SettingsField } from '../settingsPanels/_shared/SettingsControls';

type Step = 'source' | 'preview' | 'importing' | 'done';

/** Outcomes that are no fault of anyone's, only a reason something stayed behind. */
type LeftOut = Exclude<DiscordExpressionOutcome, 'imported' | 'not_selected'>;

/** Answers in a row that may be a slow batch still running before the import is given up. */
const STALLS_BEFORE_GIVING_UP = 6;
/** The pause before asking again after such an answer, or after a batch that settled nothing. */
const PAUSE_MS = 3000;

const pause = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/** An answer that says a batch is still running on the server: the request ran out, or the server said so. */
function stillRunning(err: unknown): boolean {
  return err instanceof RequestTimeoutError || (err instanceof HttpError && err.code === 'discord_import_running');
}

/**
 * Whether the browser can hide what is typed into a plain text field. The token is typed into
 * one where it can: a password field in a form that disappears after a request is what browsers
 * take for a sign-in, and they offer to save the token as the password for this site. Where it
 * cannot, the field stays a password field, so the token is never shown on a shared screen.
 */
function canMaskText(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
}

/** The host the token goes to: the instance that hosts the space, which may not be this page's. */
function hostOf(origin: string): string {
  if (!origin) return window.location.host;
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Bringing a Discord server's emoji and stickers into the space. The bot token lives in this
 * component's state only, for the one look-up, and is cleared as soon as Discord has answered or
 * refused: it is never put in a store, the address bar, a toast or an error text, and the field is
 * no password field a browser would offer to save (canMaskText). The import then runs in batches
 * the server answers one after another, without the token. A batch that outlasts its request is
 * asked about again; every answer carries the results after those the page has, so the report
 * misses nothing. Leaving the page stops the import, and what came over stays.
 */
export function DiscordExpressionImport({ spaceId, origin, onFinished }: { spaceId: string; origin: string; onFinished?: () => void }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatNumber } = useFormatters();
  const guildFieldId = useId();
  const tokenFieldId = useId();
  const [step, setStep] = useState<Step>('source');
  const [guildId, setGuildId] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DiscordExpressionPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showPictures, setShowPictures] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<DiscordExpressionResult[]>([]);
  const [stopped, setStopped] = useState<'storage_limit_reached' | 'disk_full' | 'by_you' | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const running = useRef<string | null>(null);
  const [maskText] = useState(canMaskText);

  // Leaving the page while it runs stops the import; what came over stays.
  useEffect(() => () => {
    const importId = running.current;
    if (!importId) return;
    stopRequested.current = true;
    void getApiForOrigin(origin).import.discordExpressionsCancel(importId).catch(() => undefined);
  }, [origin]);

  const guild = guildId.trim();
  const guildValid = DISCORD_SNOWFLAKE.test(guild);

  const lookUp = async (event: FormEvent) => {
    event.preventDefault();
    if (!guildValid || token.trim() === '') return;
    setBusy(true);
    setError('');
    try {
      const answer = await getApiForOrigin(origin).import.discordExpressionsPreview({ spaceId, guildId: guild, token });
      setPreview(answer);
      setSelected(new Set(answer.items.filter((item) => item.action === 'import').map((item) => item.key)));
      setShowPictures(false);
      setStep('preview');
    } catch (err) {
      setError(describeError(err));
    } finally {
      // Used once: the look-up is done, whatever Discord said.
      setToken('');
      setBusy(false);
    }
  };

  const start = async () => {
    if (!preview || selected.size === 0) return;
    const api = getApiForOrigin(origin).import;
    const importId = preview.importId;
    const selection = [...selected];
    stopRequested.current = false;
    setStopping(false);
    running.current = importId;
    setResults([]);
    setStopped(null);
    setError('');
    setProgress({ done: 0, total: selection.length });
    setStep('importing');
    const settled: DiscordExpressionResult[] = [];
    // The pick goes along until an answer arrives: a first request that never reached the server set nothing.
    let answered = false;
    let stalls = 0;
    let lastDone = -1;
    try {
      for (;;) {
        if (stopRequested.current) {
          setStopped('by_you');
          break;
        }
        let batch: DiscordExpressionApplyResult;
        try {
          batch = await api.discordExpressionsApply(answered
            ? { importId, after: settled.length }
            : { importId, selection, after: settled.length });
        } catch (err) {
          if (!stillRunning(err) || stalls >= STALLS_BEFORE_GIVING_UP) throw err;
          stalls += 1;
          await pause(PAUSE_MS);
          continue;
        }
        answered = true;
        stalls = 0;
        settled.push(...batch.results);
        setResults([...settled]);
        setProgress({ done: batch.done, total: batch.total });
        if (batch.stopped) {
          setStopped(batch.stopped);
          break;
        }
        if (batch.finished) break;
        // Nothing settled: the server's picture work is busy. Give it a moment.
        if (batch.done === lastDone) await pause(PAUSE_MS);
        lastDone = batch.done;
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      running.current = null;
      setStep('done');
      onFinished?.();
    }
  };

  const stop = () => {
    stopRequested.current = true;
    setStopping(true);
    if (preview) void getApiForOrigin(origin).import.discordExpressionsCancel(preview.importId).catch(() => undefined);
  };

  const reset = () => {
    setStep('source');
    setPreview(null);
    setSelected(new Set());
    setResults([]);
    setStopped(null);
    setError('');
    setShowPictures(false);
  };

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectable = (item: DiscordExpressionItem) => item.action === 'import' || item.skip === 'no_room';
  const items = preview?.items ?? [];
  const emojiItems = items.filter((item) => item.kind === 'emoji');
  const stickerItems = items.filter((item) => item.kind === 'sticker');
  const selectedEmoji = emojiItems.filter((item) => selected.has(item.key)).length;
  const selectedStickers = stickerItems.filter((item) => selected.has(item.key)).length;

  const skipText: Record<LeftOut, string> = {
    already_here: t('spaces:import.expressions.skip.already_here'),
    no_room: t('spaces:import.expressions.skip.no_room'),
    lottie: t('spaces:import.expressions.skip.lottie'),
    managed: t('spaces:import.expressions.skip.managed'),
    download_failed: t('spaces:import.expressions.skip.download_failed'),
    image_refused: t('spaces:import.expressions.skip.image_refused'),
  };

  const itemNote = (item: DiscordExpressionItem): string | null => {
    if (item.action === 'skip' && item.skip && item.skip !== 'not_selected') return skipText[item.skip];
    const notes: string[] = [];
    if (item.notes.includes('renamed')) notes.push(t('spaces:import.expressions.note.renamed', { name: item.kind === 'emoji' ? `:${item.name}:` : item.name }));
    if (item.notes.includes('still_picture')) notes.push(t('spaces:import.expressions.note.still_picture'));
    if (item.notes.includes('role_restriction_dropped')) notes.push(t('spaces:import.expressions.note.role_restriction_dropped'));
    return notes.length > 0 ? notes.join(' · ') : null;
  };

  const imported = useMemo(() => ({
    emoji: results.filter((result) => result.kind === 'emoji' && result.outcome === 'imported').length,
    stickers: results.filter((result) => result.kind === 'sticker' && result.outcome === 'imported').length,
  }), [results]);
  const leftOut = results.filter((result): result is DiscordExpressionResult & { outcome: LeftOut } => result.outcome !== 'imported' && result.outcome !== 'not_selected');

  const renderItem = (item: DiscordExpressionItem) => {
    const picture = showPictures ? discordAssetUrl(item) : null;
    const note = itemNote(item);
    const canPick = selectable(item);
    const inputId = `${guildFieldId}-${item.key}`;
    return (
      <li key={item.key} className={`flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 ${canPick ? '' : 'opacity-60'}`}>
        <input
          id={inputId}
          type="checkbox"
          checked={selected.has(item.key)}
          disabled={!canPick}
          onChange={() => toggle(item.key)}
          className="flex-shrink-0"
        />
        <span className={`flex flex-shrink-0 items-center justify-center rounded-sm bg-surface-input ${item.kind === 'emoji' ? 'h-7 w-7' : 'h-10 w-10'}`}>
          {picture
            ? <img src={picture} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="h-full w-full object-contain" />
            : <Icon name={item.kind === 'emoji' ? 'smile' : 'image'} size={14} className="text-txt-tertiary" />}
        </span>
        <label htmlFor={inputId} className="min-w-0 flex-1">
          <span className={`block truncate text-ui text-txt-primary ${item.kind === 'emoji' ? 'font-mono' : ''}`}>
            {item.kind === 'emoji' ? `:${item.sourceName}:` : item.sourceName}
          </span>
          {note && <span className="block truncate text-meta text-txt-tertiary">{note}</span>}
        </label>
      </li>
    );
  };

  if (step === 'source') {
    return (
      <form onSubmit={(event) => void lookUp(event)} noValidate className="space-y-4">
        <p className="text-meta leading-relaxed text-txt-secondary">{t('spaces:import.expressions.intro')}</p>
        <ol className="list-decimal space-y-1 pl-5 text-meta leading-snug text-txt-tertiary">
          <li>{t('spaces:import.expressions.howTo.app')}</li>
          <li>{t('spaces:import.expressions.howTo.token')}</li>
          <li>{t('spaces:import.expressions.howTo.invite')}</li>
          <li>{t('spaces:import.expressions.howTo.serverId')}</li>
        </ol>
        <SettingsField label={t('spaces:import.expressions.serverIdLabel')} htmlFor={guildFieldId}>
          <input
            id={guildFieldId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={guildId}
            maxLength={24}
            onChange={(event) => { setGuildId(event.target.value); setError(''); }}
            aria-invalid={guild !== '' && !guildValid}
            className="input-standard w-full font-mono"
          />
        </SettingsField>
        <SettingsField label={t('spaces:import.expressions.tokenLabel')} htmlFor={tokenFieldId}>
          <input
            id={tokenFieldId}
            type={maskText ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // Password managers and writing aids each read their own sign to leave a field alone.
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-protonpass-ignore=""
            data-form-type="other"
            data-gramm="false"
            value={token}
            maxLength={220}
            onChange={(event) => { setToken(event.target.value); setError(''); }}
            style={maskText ? { WebkitTextSecurity: 'disc' } as React.CSSProperties : undefined}
            className="input-standard w-full font-mono"
          />
        </SettingsField>
        <p className="text-meta leading-snug text-txt-tertiary">{t('spaces:import.expressions.tokenHint', { host: hostOf(origin) })}</p>
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy || !guildValid || token.trim() === ''} aria-busy={busy}>
            {busy ? t('spaces:import.expressions.lookingUp') : t('spaces:import.expressions.lookUp')}
          </button>
        </div>
      </form>
    );
  }

  if (step === 'preview' && preview) {
    const nothing = items.length === 0;
    const foundEmoji = t('spaces:import.expressions.preview.emoji', { count: emojiItems.length });
    const foundStickers = t('spaces:import.expressions.preview.stickers', { count: stickerItems.length });
    return (
      <div className="space-y-4">
        <p className="text-meta leading-relaxed text-txt-secondary">
          {t('spaces:import.expressions.preview.found', { emoji: foundEmoji, stickers: foundStickers })}
          {' '}
          {t('spaces:import.expressions.preview.room', { emoji: formatNumber(preview.room.emoji), stickers: formatNumber(preview.room.stickers) })}
        </p>

        {!nothing && !showPictures && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-soft px-3 py-2">
            <p className="min-w-0 flex-1 basis-56 text-meta leading-snug text-txt-tertiary">{t('spaces:import.expressions.preview.picturesHint')}</p>
            <button type="button" className="btn-outline btn-sm" onClick={() => setShowPictures(true)}>
              {t('spaces:import.expressions.preview.showPictures')}
            </button>
          </div>
        )}

        {nothing && <p className="text-meta text-txt-tertiary">{t('spaces:import.expressions.preview.nothing')}</p>}

        {emojiItems.length > 0 && (
          <div>
            <div className="label-mono mb-1">{t('spaces:import.expressions.preview.emojiHeading', { selected: formatNumber(selectedEmoji), total: formatNumber(emojiItems.length) })}</div>
            <ul className="max-h-72 overflow-y-auto scrollbar-thin rounded-md border border-border-soft p-1 desktop:grid desktop:grid-cols-2">{emojiItems.map(renderItem)}</ul>
          </div>
        )}
        {stickerItems.length > 0 && (
          <div>
            <div className="label-mono mb-1">{t('spaces:import.expressions.preview.stickersHeading', { selected: formatNumber(selectedStickers), total: formatNumber(stickerItems.length) })}</div>
            <ul className="max-h-72 overflow-y-auto scrollbar-thin rounded-md border border-border-soft p-1">{stickerItems.map(renderItem)}</ul>
          </div>
        )}

        {(selectedEmoji > preview.room.emoji || selectedStickers > preview.room.stickers) && (
          <p className="text-meta text-txt-secondary">{t('spaces:import.expressions.preview.tooMany')}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn-quiet" onClick={reset}>{t('common:actions.back')}</button>
          <button type="button" className="btn-primary" onClick={() => void start()} disabled={selected.size === 0}>
            {t('spaces:import.expressions.start', { count: selected.size })}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'importing') {
    const share = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui text-txt-primary">{t('spaces:import.expressions.importing')}</span>
          <span className="tabular font-mono text-label text-txt-tertiary">
            {t('spaces:import.expressions.progress', { done: formatNumber(progress.done), total: formatNumber(progress.total) })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label={t('spaces:import.expressions.importing')}
          className="h-1.5 overflow-hidden rounded-sm bg-surface-input"
        >
          <div className="h-full bg-accent-primary transition-[width] duration-300 ease-out" style={{ width: `${share}%` }} />
        </div>
        <p className="text-meta text-txt-tertiary">{t('spaces:import.expressions.keepOpen')}</p>
        <div className="flex justify-end">
          <button type="button" className="btn-outline" onClick={stop} disabled={stopping} aria-busy={stopping}>
            {t('spaces:import.expressions.stop')}
          </button>
        </div>
      </div>
    );
  }

  // Done: what came over, and what stayed behind and why.
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const cameEmoji = t('spaces:import.expressions.preview.emoji', { count: imported.emoji });
  const cameStickers = t('spaces:import.expressions.preview.stickers', { count: imported.stickers });
  return (
    <div className="space-y-4">
      <div>
        <p className="text-ui font-medium text-txt-primary">
          {stopped || error ? t('spaces:import.expressions.done.stoppedTitle') : t('spaces:import.expressions.done.title')}
        </p>
        <p className="mt-1 text-meta text-txt-secondary">
          {t('spaces:import.expressions.done.counts', { emoji: cameEmoji, stickers: cameStickers })}
        </p>
        {stopped && stopped !== 'by_you' && <p role="alert" className="mt-1 text-meta text-txt-danger">{describeErrorCode(stopped, '')}</p>}
        {stopped === 'by_you' && <p className="mt-1 text-meta text-txt-tertiary">{t('spaces:import.expressions.done.stoppedByYou')}</p>}
        {error && <p role="alert" className="mt-1 text-meta text-txt-danger">{error}</p>}
      </div>

      {leftOut.length > 0 && (
        <div>
          <div className="label-mono mb-1">{t('spaces:import.expressions.done.leftOut', { count: leftOut.length })}</div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto scrollbar-thin rounded-md border border-border-soft px-3 py-2 text-meta">
            {leftOut.map((result) => {
              const source = itemByKey.get(result.key)?.sourceName ?? result.name;
              return (
                <li key={result.key} className="flex min-w-0 gap-2">
                  <span className={`min-w-0 truncate text-txt-secondary ${result.kind === 'emoji' ? 'font-mono' : ''}`}>
                    {result.kind === 'emoji' ? `:${source}:` : source}
                  </span>
                  <span className="flex-shrink-0 text-txt-tertiary">{skipText[result.outcome]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-meta leading-snug text-txt-tertiary">{t('spaces:import.expressions.done.revoke')}</p>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={reset}>{t('common:actions.done')}</button>
      </div>
    </div>
  );
}
