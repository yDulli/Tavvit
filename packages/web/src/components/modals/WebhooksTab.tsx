import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WEBHOOK_LIMITS, webhookPath, type WebhookInfo, type WebhookWithToken } from '@backspace/shared/src/webhooks';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ChannelFollowsSection } from './ChannelFollowsSection';
import { Icon } from '../ui/Icon';
import { InlineNameEditor } from '../ui/InlineNameEditor';

/** The address as someone would paste it: on the instance that hosts the channel. */
function addressOf(origin: string, made: WebhookWithToken): string {
  return `${origin || window.location.origin}${webhookPath(made.webhook.id, made.token)}`;
}

/** What to paste into a terminal to try it. A command, so it reads the same in every language. */
function curlExample(url: string): string {
  return `curl -X POST -H "Content-Type: application/json" -d '{"content":"Hello"}' ${url}`;
}

/** A channel's webhooks. The server decides who may see this; a token is shown once, right after it is made. */
export function WebhooksTab({ channelId, isAnnouncement = false }: { channelId: string; isAnnouncement?: boolean }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatRelativeTime } = useFormatters();
  const fieldId = useId();
  const origin = getChannelOrigin(channelId);
  const [webhooks, setWebhooks] = useState<WebhookInfo[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState<{ action: 'rotate' | 'remove'; webhook: WebhookInfo } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApiForOrigin(origin).webhooks.list(channelId).then(({ webhooks: list }) => {
      if (!cancelled) setWebhooks(list);
    }).catch((err: unknown) => {
      if (!cancelled) setError(describeError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [origin, channelId]);

  const showFresh = (made: WebhookWithToken) => {
    setFresh({ name: made.webhook.name, url: addressOf(origin, made) });
    setCopied(false);
  };

  const create = async (submitted: React.FormEvent) => {
    submitted.preventDefault();
    const wanted = name.trim();
    if (!wanted || creating) return;
    setCreating(true);
    setError('');
    try {
      const made = await getApiForOrigin(origin).webhooks.create(channelId, wanted);
      setWebhooks((current) => [...(current ?? []), made.webhook]);
      setName('');
      showFresh(made);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (webhook: WebhookInfo, wanted: string) => {
    const updated = await getApiForOrigin(origin).webhooks.rename(webhook.id, wanted);
    setWebhooks((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item)));
  };

  const answer = async () => {
    if (!asking) return;
    const { action, webhook } = asking;
    setAsking(null);
    setError('');
    try {
      const client = getApiForOrigin(origin);
      if (action === 'rotate') {
        showFresh(await client.webhooks.rotate(webhook.id));
      } else {
        await client.webhooks.remove(webhook.id);
        setWebhooks((current) => (current ?? []).filter((item) => item.id !== webhook.id));
        setFresh(null);
      }
    } catch (err) {
      setError(describeError(err));
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      // The address stays selectable in the field.
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-txt-secondary">{t('spaces:channel.settings.webhooks.description')}</p>

      {fresh && (
        <div role="status" className="surface-card flex flex-col gap-2 p-3">
          <p className="text-ui text-txt-primary">{t('spaces:channel.settings.webhooks.onlyOnce', { name: fresh.name })}</p>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={fresh.url}
              aria-label={t('spaces:channel.settings.webhooks.addressLabel')}
              onFocus={(focus) => focus.currentTarget.select()}
              className="input-standard min-w-0 flex-1 font-mono text-meta"
            />
            <button type="button" onClick={() => void copy()} className="btn-outline btn-sm flex-shrink-0">
              {copied ? t('spaces:channel.settings.webhooks.copied') : t('common:actions.copy')}
            </button>
          </div>
          <p className="text-meta text-txt-tertiary">{t('spaces:channel.settings.webhooks.howTo')}</p>
          <code className="block overflow-x-auto whitespace-nowrap rounded-sm bg-surface-input px-2 py-1.5 font-mono text-meta text-txt-secondary">
            {curlExample(fresh.url)}
          </code>
        </div>
      )}

      <form onSubmit={(submitted) => void create(submitted)} className="flex flex-col gap-1">
        <label htmlFor={`${fieldId}-name`} className="field-label">{t('spaces:channel.settings.webhooks.nameLabel')}</label>
        <div className="flex items-center gap-1.5">
          <input
            id={`${fieldId}-name`}
            type="text"
            value={name}
            onChange={(change) => setName(change.target.value.slice(0, WEBHOOK_LIMITS.NAME_MAX_LENGTH))}
            className="input-standard min-w-0 flex-1"
          />
          <button type="submit" disabled={!name.trim() || creating} aria-busy={creating} className="btn-primary flex-shrink-0">
            {t('spaces:channel.settings.webhooks.create')}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      {webhooks && webhooks.length === 0 && (
        <p className="text-ui text-txt-tertiary">{t('spaces:channel.settings.webhooks.empty')}</p>
      )}

      {webhooks && webhooks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-soft px-3 py-2">
              <div className="min-w-0 flex-1">
                <InlineNameEditor
                  name={webhook.name}
                  icon={<Icon name="link" size={14} />}
                  canEdit
                  editLabel={t('spaces:channel.settings.webhooks.rename')}
                  fieldLabel={t('spaces:channel.settings.webhooks.nameLabel')}
                  maxLength={WEBHOOK_LIMITS.NAME_MAX_LENGTH}
                  normalize={(value) => value.trim()}
                  onSave={(wanted) => rename(webhook, wanted)}
                />
                <p className="mt-0.5 text-meta text-txt-tertiary">
                  {webhook.lastUsedAt === null
                    ? t('spaces:channel.settings.webhooks.neverUsed')
                    : t('spaces:channel.settings.webhooks.lastUsed', { time: formatRelativeTime(webhook.lastUsedAt) })}
                </p>
              </div>
              <button type="button" onClick={() => setAsking({ action: 'rotate', webhook })} className="btn-quiet btn-sm">
                {t('spaces:channel.settings.webhooks.rotate')}
              </button>
              <button
                type="button"
                onClick={() => setAsking({ action: 'remove', webhook })}
                className="icon-btn"
                title={t('spaces:channel.settings.webhooks.remove')}
                aria-label={t('spaces:channel.settings.webhooks.remove')}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ChannelFollowsSection channelId={channelId} isAnnouncement={isAnnouncement} />

      <ConfirmDialog
        isOpen={asking !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => void answer()}
        title={asking?.action === 'rotate' ? t('spaces:channel.settings.webhooks.rotateTitle') : t('spaces:channel.settings.webhooks.removeTitle')}
        description={asking?.action === 'rotate'
          ? t('spaces:channel.settings.webhooks.rotateBody', { name: asking.webhook.name })
          : t('spaces:channel.settings.webhooks.removeBody', { name: asking?.webhook.name ?? '' })}
        confirmLabel={asking?.action === 'rotate' ? t('spaces:channel.settings.webhooks.rotate') : t('spaces:channel.settings.webhooks.remove')}
        variant="danger"
      />
    </div>
  );
}
