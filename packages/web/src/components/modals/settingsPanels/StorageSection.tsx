import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StorageUsage } from '@backspace/shared/src/accountLimits';
import { api } from '../../../api/client';
import { useFormatters } from '../../../i18n/formatters';
import { SettingsSection } from './_shared/SettingsControls';

/** From here on the bar warns: the next large file may not fit. */
const WARN_AT_SHARE = 0.9;

/**
 * How much of what this server lets an account keep is taken up by its files
 * (docs/systems/uploads.md, "Limits per account"). A figure that cannot be read
 * is no reason to say anything: the section stays away.
 */
export function StorageSection() {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  useEffect(() => {
    let current = true;
    const read = async () => {
      try {
        const next = await api.users.storage();
        if (current) setUsage(next);
      } catch {
        if (current) setUsage(null);
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, []);

  if (!usage) return null;

  const { usedBytes, limitBytes } = usage;
  const share = limitBytes === null ? 0 : Math.min(usedBytes / limitBytes, 1);

  return (
    <SettingsSection title={t('settings:account.storage.title')} description={t('settings:account.storage.description')}>
      <p className="tabular text-ui text-txt-primary">
        {limitBytes === null
          ? t('settings:account.storage.usedNoLimit', { used: f.formatBytes(usedBytes) })
          : t('settings:account.storage.used', { used: f.formatBytes(usedBytes), limit: f.formatBytes(limitBytes) })}
      </p>
      {limitBytes !== null && (
        <div
          className="mt-2 h-1 overflow-hidden rounded-sm bg-interactive-muted"
          role="progressbar"
          aria-label={t('settings:account.storage.title')}
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full ${share >= WARN_AT_SHARE ? 'bg-accent-amber' : 'bg-txt-tertiary'}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
    </SettingsSection>
  );
}
