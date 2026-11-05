import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MODERATION_LIMITS, type SpaceModerationSettings, type UpdateSpaceModerationRequest } from '@backspace/shared';
import { DEFAULT_MODERATION_SETTINGS, normalizeModerationSettings } from '@backspace/shared/src/moderation';
import { useSpaceStore, getApiForOrigin } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { Icon } from '../../ui/Icon';
import { SettingBlock, SettingsSection, ToggleRow } from '../settingsPanels/_shared/SettingsControls';

/** The rules as the panel edits them: the stored settings without their timestamp. */
type ModerationDraft = Omit<SpaceModerationSettings, 'updatedAt'>;

/** The mention limits offered; 0 is no limit. */
const MAX_MENTION_CHOICES = [0, 3, 5, 10, 20, 30, 50] as const;

/** The minimum ages offered, in minutes: off, 10 minutes, 1 hour, 1 day, 1 week, 30 days. */
const MIN_AGE_CHOICES_MINUTES = [0, 10, 60, 1_440, 10_080, 43_200] as const;

function draftOf(settings: SpaceModerationSettings): ModerationDraft {
  return {
    blockedWords: settings.blockedWords,
    blockLinks: settings.blockLinks,
    blockInvites: settings.blockInvites,
    maxMentions: settings.maxMentions,
    minAccountAgeMinutes: settings.minAccountAgeMinutes,
    minMemberAgeMinutes: settings.minMemberAgeMinutes,
  };
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

/** The fields of `draft` that differ from `saved`: the body of the PATCH. */
function changesBetween(saved: ModerationDraft, draft: ModerationDraft): UpdateSpaceModerationRequest {
  const changes: UpdateSpaceModerationRequest = {};
  if (!sameWords(saved.blockedWords, draft.blockedWords)) changes.blockedWords = draft.blockedWords;
  if (saved.blockLinks !== draft.blockLinks) changes.blockLinks = draft.blockLinks;
  if (saved.blockInvites !== draft.blockInvites) changes.blockInvites = draft.blockInvites;
  if (saved.maxMentions !== draft.maxMentions) changes.maxMentions = draft.maxMentions;
  if (saved.minAccountAgeMinutes !== draft.minAccountAgeMinutes) changes.minAccountAgeMinutes = draft.minAccountAgeMinutes;
  if (saved.minMemberAgeMinutes !== draft.minMemberAgeMinutes) changes.minMemberAgeMinutes = draft.minMemberAgeMinutes;
  return changes;
}

/** The offered choices plus a stored value outside them (set through another client), in order. */
function choicesWith(choices: readonly number[], current: number): readonly number[] {
  return choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
}

/** The field's text with runs of spaces made one and the ends trimmed. */
function normalizeWord(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Whether the field holds anything to block: a `*` alone matches nothing. */
function hasWord(raw: string): boolean {
  return normalizeWord(raw).replace(/\*/g, '').trim() !== '';
}

/**
 * The words and phrases a message may not contain: the list with a remove
 * button per entry, and a field that adds one on Enter or with Add. An entry
 * goes through the instance's own rule (`normalizeModerationSettings`), so
 * the list here is exactly what a save keeps: the same stored form, and the
 * same word is never listed twice, whatever its case.
 */
function BlockedWordsEditor({ labelledBy, words, disabled, onChange }: {
  labelledBy: string;
  words: readonly string[];
  disabled: boolean;
  onChange: (words: string[]) => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatNumber } = useFormatters();
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState('');
  const inputId = useId();
  const problemId = useId();
  const full = words.length >= MODERATION_LIMITS.MAX_BLOCKED_WORDS;

  const add = () => {
    if (!hasWord(input)) return;
    const word = normalizeWord(input);
    if (full) {
      setProblem(t('spaces:settings.moderation.words.full', { max: formatNumber(MODERATION_LIMITS.MAX_BLOCKED_WORDS) }));
      return;
    }
    const result = normalizeModerationSettings(DEFAULT_MODERATION_SETTINGS, { blockedWords: [...words, word] });
    if (!result.ok) {
      setProblem(t('spaces:settings.moderation.words.invalid'));
      return;
    }
    // The rule keeps a repeat once, so a list that did not grow already had it.
    if (result.value.blockedWords.length === words.length) {
      setProblem(t('spaces:settings.moderation.words.duplicate', { word }));
      return;
    }
    onChange(result.value.blockedWords);
    setInput('');
    setProblem('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    add();
  };

  return (
    <div className="space-y-2.5">
      {words.length > 0 ? (
        <ul aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
          {words.map((word) => (
            <li
              key={word}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-border-soft bg-surface-input pl-2 pr-0.5 text-ui text-txt-primary"
            >
              <span className="truncate">{word}</span>
              <button
                data-tooltip=""
                type="button"
                onClick={() => onChange(words.filter((existing) => existing !== word))}
                disabled={disabled}
                aria-label={t('spaces:settings.moderation.words.remove', { word })}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-txt-tertiary transition-colors hover:bg-interactive-hover hover:text-txt-primary disabled:opacity-50"
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-txt-tertiary">{t('spaces:settings.moderation.words.empty')}</p>
      )}

      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">{t('spaces:settings.moderation.words.inputLabel')}</label>
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setProblem(''); }}
          onKeyDown={handleKeyDown}
          maxLength={MODERATION_LIMITS.MAX_BLOCKED_WORD_LENGTH}
          disabled={disabled || full}
          placeholder={full ? t('spaces:settings.moderation.words.fullPlaceholder') : t('spaces:settings.moderation.words.placeholder')}
          aria-describedby={problem ? problemId : undefined}
          className="input-standard h-8 min-w-0 flex-1 py-0"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || full || !hasWord(input)}
          className="btn-outline flex-shrink-0"
        >
          <Icon name="plus" size={14} />
          {t('common:actions.add')}
        </button>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <p id={problemId} className={`text-meta ${problem ? 'text-txt-danger' : 'text-txt-tertiary'}`}>
          {problem || t('spaces:settings.moderation.words.hint')}
        </p>
        <span className="flex-shrink-0 font-mono tabular-nums text-label text-txt-tertiary">
          {t('spaces:settings.moderation.words.counter', {
            used: formatNumber(words.length),
            max: formatNumber(MODERATION_LIMITS.MAX_BLOCKED_WORDS),
          })}
        </span>
      </div>
    </div>
  );
}

/**
 * Server settings → Moderation: the automatic rules of one space. The rules
 * live on the instance that hosts the space and apply to messages posted or
 * edited in its text channels; the owner, administrators and members who may
 * manage messages or the space are exempt. Read with GET and saved with one
 * PATCH of the changed fields through the unsaved-changes bar.
 */
export function ModerationPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatInterval, formatNumber } = useFormatters();
  const origin = useSpaceStore((s) => s.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
  const addToast = useUIStore((s) => s.addToast);

  const [saved, setSaved] = useState<ModerationDraft | null>(null);
  const [draft, setDraft] = useState<ModerationDraft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const mentionsId = useId();
  const accountAgeId = useId();
  const memberAgeId = useId();

  /**
   * The load whose answer the panel is waiting for: a retry, or the space's
   * origin resolving while a read is out, starts another, and only the newest
   * answer fills the form. (The modal keys the panel by space, so another
   * space always starts from a fresh panel.)
   */
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    // Nothing of a previous space, or of a failed read, stays on screen.
    setSaved(null);
    setDraft(null);
    setLoading(true);
    setLoadError('');
    try {
      const settings = await getApiForOrigin(origin).moderation.getSettings(spaceId);
      if (runId.current !== id) return;
      const next = draftOf(settings);
      setSaved(next);
      setDraft(next);
    } catch (err) {
      if (runId.current !== id) return;
      setLoadError(describeError(err));
    } finally {
      if (runId.current === id) setLoading(false);
    }
  }, [origin, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !draft) {
    return (
      <div className="flex items-center justify-center py-8" role="status">
        <div className="text-txt-tertiary text-ui">{t('common:states.loadingSettings')}</div>
      </div>
    );
  }

  if (!saved || !draft) {
    return (
      <div className="space-y-4">
        <h2 className="page-title">{t('spaces:settings.moderation.title')}</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
          <span>{loadError || t('common:states.loadSettingsFailed')}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="font-medium underline underline-offset-2 hover:no-underline transition-all disabled:no-underline disabled:opacity-60 disabled:cursor-default"
          >
            {t('common:actions.retry')}
          </button>
        </div>
      </div>
    );
  }

  const changes = changesBetween(saved, draft);
  const hasChanges = Object.keys(changes).length > 0;

  /** Change the draft; ignored while a save is on its way, whose answer replaces the draft. */
  const edit = (patch: Partial<ModerationDraft>) => {
    if (saving) return;
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const settings = await getApiForOrigin(origin).moderation.updateSettings(spaceId, changes);
      const next = draftOf(settings);
      setSaved(next);
      setDraft(next);
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setDraft(saved);

  const ageLabel = (minutes: number): string =>
    minutes === 0 ? t('spaces:settings.moderation.off') : formatInterval(minutes * 60);
  const mentionsLabel = (max: number): string =>
    max === 0 ? t('spaces:settings.moderation.off') : formatNumber(max);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('spaces:settings.moderation.title')}</h2>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.moderation.intro')}</p>
      </div>

      <SettingsSection title={t('spaces:settings.moderation.filter.title')} description={t('spaces:settings.moderation.filter.description')}>
        <SettingBlock label={t('spaces:settings.moderation.words.label')}>
          {(labelId) => (
            <BlockedWordsEditor
              labelledBy={labelId}
              words={draft.blockedWords}
              disabled={saving}
              onChange={(blockedWords) => edit({ blockedWords })}
            />
          )}
        </SettingBlock>

        <ToggleRow
          label={t('spaces:settings.moderation.links.label')}
          description={t('spaces:settings.moderation.links.description')}
          enabled={draft.blockLinks}
          onChange={(blockLinks) => edit({ blockLinks })}
        />
        <ToggleRow
          label={t('spaces:settings.moderation.invites.label')}
          description={t('spaces:settings.moderation.invites.description')}
          enabled={draft.blockInvites}
          onChange={(blockInvites) => edit({ blockInvites })}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={mentionsId} className="text-ui font-medium text-txt-primary">
              {t('spaces:settings.moderation.mentions.label')}
            </label>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.moderation.mentions.description')}</p>
          </div>
          <select
            id={mentionsId}
            value={String(draft.maxMentions)}
            disabled={saving}
            onChange={(e) => edit({ maxMentions: Number(e.target.value) })}
            className="input-standard h-8 w-32 flex-shrink-0 py-0"
          >
            {choicesWith(MAX_MENTION_CHOICES, draft.maxMentions).map((max) => (
              <option key={max} value={String(max)}>{mentionsLabel(max)}</option>
            ))}
          </select>
        </div>
      </SettingsSection>

      <SettingsSection title={t('spaces:settings.moderation.posting.title')} description={t('spaces:settings.moderation.posting.description')}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={accountAgeId} className="text-ui font-medium text-txt-primary">
              {t('spaces:settings.moderation.accountAge.label')}
            </label>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.moderation.accountAge.description')}</p>
          </div>
          <select
            id={accountAgeId}
            value={String(draft.minAccountAgeMinutes)}
            disabled={saving}
            onChange={(e) => edit({ minAccountAgeMinutes: Number(e.target.value) })}
            className="input-standard h-8 w-32 flex-shrink-0 py-0"
          >
            {choicesWith(MIN_AGE_CHOICES_MINUTES, draft.minAccountAgeMinutes).map((minutes) => (
              <option key={minutes} value={String(minutes)}>{ageLabel(minutes)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={memberAgeId} className="text-ui font-medium text-txt-primary">
              {t('spaces:settings.moderation.memberAge.label')}
            </label>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.moderation.memberAge.description')}</p>
          </div>
          <select
            id={memberAgeId}
            value={String(draft.minMemberAgeMinutes)}
            disabled={saving}
            onChange={(e) => edit({ minMemberAgeMinutes: Number(e.target.value) })}
            className="input-standard h-8 w-32 flex-shrink-0 py-0"
          >
            {choicesWith(MIN_AGE_CHOICES_MINUTES, draft.minMemberAgeMinutes).map((minutes) => (
              <option key={minutes} value={String(minutes)}>{ageLabel(minutes)}</option>
            ))}
          </select>
        </div>
      </SettingsSection>

      <div className="flex items-start gap-2.5 text-meta text-txt-tertiary">
        <Icon name="shield" size={15} className="mt-px flex-shrink-0" />
        <div className="space-y-1">
          <p>{t('spaces:settings.moderation.exempt')}</p>
          <p>{t('spaces:settings.moderation.slowmodeNote')}</p>
        </div>
      </div>

      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="action-bar animate-slide-up pointer-events-auto">
              <button type="button" onClick={handleReset} disabled={saving} className="btn-quiet">
                {t('common:actions.reset')}
              </button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} aria-busy={saving} className="btn-primary">
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
