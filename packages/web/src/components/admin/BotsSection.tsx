import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminBotInfo } from '@backspace/shared/src/bots';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { SettingsSection, ToggleRow } from '../modals/settingsPanels/_shared/SettingsControls';

/** Whether people here may run bots, and who runs which. Off until the operator says otherwise. */
export function BotsSection() {
  const { t } = useTranslation('admin');
  const { formatRelativeTime, formatNumber } = useFormatters();
  const [enabled, setEnabled] = useState(false);
  const [bots, setBots] = useState<AdminBotInfo[] | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<AdminBotInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.admin.bots().then((response) => {
      if (cancelled) return;
      setEnabled(response.enabled);
      setBots(response.bots);
    }).catch((err: unknown) => {
      if (!cancelled) setError(describeError(err));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setError('');
    try {
      setEnabled((await api.admin.setBotsEnabled(next)).enabled);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const remove = async () => {
    if (!removing) return;
    const { id } = removing;
    setRemoving(null);
    try {
      await api.admin.deleteBot(id);
      setBots((current) => (current ?? []).filter((bot) => bot.id !== id));
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="page-title">{t('bots.title')}</h2>
      <SettingsSection title={t('bots.switchTitle')} description={t('bots.switchDescription')}>
        <ToggleRow label={t('bots.switchLabel')} enabled={enabled} onChange={(next) => void toggle(next)} />
      </SettingsSection>

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <SettingsSection title={t('bots.listTitle')}>
        {bots?.length === 0 && <p className="text-ui text-txt-tertiary">{t('bots.empty')}</p>}
        {bots && bots.length > 0 && (
          <ul className="flex flex-col gap-1">
            {bots.map((bot) => (
              <li key={bot.id} className="flex items-center gap-3 rounded-md border border-border-soft px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui text-txt-primary">{bot.name}</p>
                  <p className="truncate text-meta text-txt-tertiary">
                    {t('bots.owner', { name: bot.ownerName })} · {t('bots.spaces', { count: bot.spaces, formatted: formatNumber(bot.spaces) })}
                    {' · '}
                    {bot.lastUsedAt === null ? t('bots.neverUsed') : t('bots.lastUsed', { time: formatRelativeTime(bot.lastUsedAt) })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRemoving(bot)}
                  className="icon-btn flex-shrink-0"
                  aria-label={t('bots.remove')}
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        title={t('bots.removeTitle')}
        description={t('bots.removeBody', { name: removing?.name ?? '' })}
        confirmLabel={t('bots.remove')}
        variant="danger"
      />
    </div>
  );
}
