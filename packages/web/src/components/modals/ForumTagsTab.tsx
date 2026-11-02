import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FORUM_LIMITS, FORUM_TAG_COLORS, isForumTagColor, type ForumTagColor } from '@backspace/shared/src/forums';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { Icon } from '../ui/Icon';

interface DraftTag {
  /** The list's own key: a new tag has no id yet. */
  key: string;
  id: string | undefined;
  name: string;
  color: ForumTagColor | null;
}

/** A forum's tags, all saved at once, as the server takes them. */
export function ForumTagsTab({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const fieldId = useId();
  const origin = getChannelOrigin(channelId);
  const [tags, setTags] = useState<DraftTag[] | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nextKey, setNextKey] = useState(1);

  const accept = (list: ReadonlyArray<{ id: string; name: string; color: ForumTagColor | null }>) => {
    const drafts = list.map((tag) => ({ key: tag.id, id: tag.id, name: tag.name, color: tag.color }));
    setTags(drafts);
    setSaved(JSON.stringify(drafts.map(({ id, name, color }) => ({ id, name, color }))));
  };

  useEffect(() => {
    let stale = false;
    getApiForOrigin(origin).forums.tags(channelId)
      .then((response) => {
        if (!stale) accept(response.tags);
      })
      .catch((err: unknown) => {
        if (!stale) setError(describeError(err));
      });
    return () => {
      stale = true;
    };
  }, [origin, channelId]);

  const change = (key: string, update: Partial<DraftTag>) => setTags((current) => (current ?? []).map((tag) => (tag.key === key ? { ...tag, ...update } : tag)));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tags || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await getApiForOrigin(origin).forums.setTags(channelId, tags.map((tag) => ({
        ...(tag.id ? { id: tag.id } : {}),
        name: tag.name.trim(),
        color: tag.color,
      })));
      accept(response.tags);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const dirty = tags !== null && JSON.stringify(tags.map(({ id, name, color }) => ({ id, name: name.trim(), color }))) !== saved;
  const atLimit = (tags?.length ?? 0) >= FORUM_LIMITS.TAGS_PER_FORUM;

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      <p className="text-ui text-txt-secondary">{t('spaces:channel.settings.tags.intro', { max: FORUM_LIMITS.TAGS_PER_FORUM })}</p>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {tags && tags.length === 0 && <p className="text-ui text-txt-tertiary">{t('spaces:channel.settings.tags.empty')}</p>}
      {tags && tags.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {tags.map((tag, index) => (
            <li key={tag.key} className="flex items-center gap-1.5">
              <input
                id={`${fieldId}-name-${index}`}
                type="text"
                value={tag.name}
                onChange={(input) => change(tag.key, { name: input.target.value.slice(0, FORUM_LIMITS.TAG_NAME_MAX_LENGTH) })}
                aria-label={t('spaces:channel.settings.tags.nameLabel')}
                className="input-standard min-w-0 flex-1"
              />
              <select
                value={tag.color ?? ''}
                onChange={(input) => change(tag.key, { color: isForumTagColor(input.target.value) ? input.target.value : null })}
                aria-label={t('spaces:channel.settings.tags.colorLabel')}
                className="input-standard w-32 flex-shrink-0"
              >
                <option value="">{t('spaces:channel.settings.tags.noColor')}</option>
                {FORUM_TAG_COLORS.map((color) => <option key={color} value={color}>{t(`common:colors.${color}`)}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setTags((current) => (current ?? []).filter((item) => item.key !== tag.key))}
                className="icon-btn"
                title={t('spaces:channel.settings.tags.remove')}
                aria-label={t('spaces:channel.settings.tags.remove')}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {tags && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={atLimit}
            onClick={() => {
              setTags((current) => [...(current ?? []), { key: `new-${nextKey}`, id: undefined, name: '', color: null }]);
              setNextKey((key) => key + 1);
            }}
            className="btn-outline btn-sm"
          >
            <Icon name="plus" size={14} />
            {t('spaces:channel.settings.tags.add')}
          </button>
          {dirty && (
            <button type="submit" disabled={busy || tags.some((tag) => !tag.name.trim())} aria-busy={busy} className="btn-primary btn-sm">
              {t('common:actions.save')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
