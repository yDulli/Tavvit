import { useState, useEffect, useCallback, useId } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useFormatters } from '../../../i18n/formatters';
import { describeError } from '../../../i18n/errors';
import { api } from '../../../api/client';
import type { StorageStats, CleanupResult } from '@backspace/shared';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';

type UploadUnit = 'MB' | 'GB';

// Render a number with up to 3 decimals, trimming trailing zeros. 1.5 → "1.5", 5 → "5", 0.098 → "0.098".
function formatUnitValue(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function parseDisplayMb(input: string, unit: UploadUnit): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mb = unit === 'GB' ? Math.round(n * 1024) : Math.round(n);
  return Number.isInteger(mb) && mb >= 1 ? mb : null;
}

/** A limit as typed: a number that is not negative, whole where it has to be, or null. */
function parseAccountLimit(input: string, whole: boolean): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || (whole && !Number.isInteger(n))) return null;
  return n;
}

/** One counted figure of the overview: the same tile as the instance overview, with a size under it. */
function StatTile({ label, value, size, attention = false }: {
  label: string;
  value: string;
  size: string;
  /** There is something here to clean up. */
  attention?: boolean;
}) {
  return (
    <div className="surface-card rounded-lg px-3 py-2.5">
      <div className="truncate text-meta text-txt-tertiary">{label}</div>
      <div className={`tabular mt-1 font-mono text-xl leading-none ${attention ? 'text-accent-amber' : 'text-txt-primary'}`}>{value}</div>
      <div className="tabular mt-1.5 font-mono text-label text-txt-tertiary">{size}</div>
    </div>
  );
}

export function StoragePanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const uploadLimitId = useId();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const addToast = useUIStore((s) => s.addToast);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);

  // Upload limit state
  const instanceSettings = useSettingsStore((s) => s.instanceSettings);
  const updateInstanceSettings = useSettingsStore((s) => s.updateInstanceSettings);
  const [uploadUnit, setUploadUnit] = useState<UploadUnit>('MB');
  const [uploadLimitInput, setUploadLimitInput] = useState<string>('100');
  const [uploadLimitSaving, setUploadLimitSaving] = useState(false);

  // Limits per account
  const accountStorageId = useId();
  const accountSpacesId = useId();
  const [accountStorageInput, setAccountStorageInput] = useState('');
  const [accountSpacesInput, setAccountSpacesInput] = useState('');
  const [accountLimitsSaving, setAccountLimitsSaving] = useState(false);

  // Media retention state
  const [mediaAgeDays, setMediaAgeDays] = useState(90);
  const [mediaCleanupResult, setMediaCleanupResult] = useState<CleanupResult | null>(null);
  const [mediaCleaning, setMediaCleaning] = useState(false);
  const [mediaPreviewDone, setMediaPreviewDone] = useState(false);

  // Stale tus session cleanup state
  const [tusMaxAgeHours, setTusMaxAgeHours] = useState(1);
  const [tusCleanupResult, setTusCleanupResult] = useState<CleanupResult | null>(null);
  const [tusCleaning, setTusCleaning] = useState(false);
  const [tusPreviewDone, setTusPreviewDone] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.admin.storageStats();
      setStats(data);
    } catch (err) {
      setLoadError(err instanceof Error ? describeError(err) : t('admin:storage.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const mb = instanceSettings?.maxUploadSizeMb;
    if (typeof mb === 'number' && mb > 0) {
      const unit: UploadUnit = mb >= 1024 ? 'GB' : 'MB';
      setUploadUnit(unit);
      setUploadLimitInput(unit === 'GB' ? formatUnitValue(mb / 1024) : String(mb));
    }
  }, [instanceSettings]);

  useEffect(() => {
    if (!instanceSettings) return;
    setAccountStorageInput(String(instanceSettings.storagePerAccountGb));
    setAccountSpacesInput(String(instanceSettings.spacesPerAccount));
  }, [instanceSettings]);

  const parsedAccountStorage = parseAccountLimit(accountStorageInput, false);
  const parsedAccountSpaces = parseAccountLimit(accountSpacesInput, true);
  const accountLimitsDirty = parsedAccountStorage !== null && parsedAccountSpaces !== null
    && (parsedAccountStorage !== instanceSettings?.storagePerAccountGb || parsedAccountSpaces !== instanceSettings?.spacesPerAccount);

  const handleAccountLimitsSave = async () => {
    if (parsedAccountStorage === null || parsedAccountSpaces === null) return;
    setAccountLimitsSaving(true);
    try {
      await updateInstanceSettings({ storagePerAccountGb: parsedAccountStorage, spacesPerAccount: parsedAccountSpaces });
      addToast(t('admin:storage.accountLimits.saved'), 'success');
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setAccountLimitsSaving(false);
    }
  };

  const parsedUploadMb = parseDisplayMb(uploadLimitInput, uploadUnit);
  const uploadLimitDirty = parsedUploadMb !== null && parsedUploadMb !== instanceSettings?.maxUploadSizeMb;

  const handleUploadUnitChange = (next: UploadUnit) => {
    if (next === uploadUnit) return;
    const n = Number(uploadLimitInput.trim());
    if (Number.isFinite(n) && n > 0) {
      setUploadLimitInput(next === 'GB' ? formatUnitValue(n / 1024) : String(Math.round(n * 1024)));
    }
    setUploadUnit(next);
  };

  const handleUploadLimitSave = async () => {
    if (parsedUploadMb === null) return;
    const mb = parsedUploadMb;
    setUploadLimitSaving(true);
    try {
      await updateInstanceSettings({ maxUploadSizeMb: mb });
      addToast(t('admin:storage.uploadLimit.saved', { limit: f.formatBytes(mb * 1024 * 1024) }), 'success');
    } catch {
      addToast(t('admin:storage.uploadLimit.saveFailed'), 'warning');
    } finally {
      setUploadLimitSaving(false);
    }
  };

  const handleMediaCleanup = async (dryRun: boolean) => {
    setMediaCleaning(true);
    setMediaCleanupResult(null);
    try {
      const result = await api.admin.cleanupOldMedia(mediaAgeDays, dryRun);
      setMediaCleanupResult(result);
      if (dryRun) {
        setMediaPreviewDone(true);
      } else {
        setMediaPreviewDone(false);
        addToast(t('admin:storage.media.deletedToast', { count: result.deletedFiles, size: f.formatBytes(result.freedBytes) }), 'success');
        await fetchStats();
      }
    } catch (err) {
      addToast(err instanceof Error ? describeError(err) : t('admin:storage.media.failed'), 'warning');
    } finally {
      setMediaCleaning(false);
    }
  };

  const handleTusCleanup = async (dryRun: boolean) => {
    if (!Number.isFinite(tusMaxAgeHours) || tusMaxAgeHours <= 0) return;
    setTusCleaning(true);
    setTusCleanupResult(null);
    try {
      const result = await api.admin.cleanupTusSessions(tusMaxAgeHours, dryRun);
      setTusCleanupResult(result);
      if (dryRun) {
        setTusPreviewDone(true);
      } else {
        setTusPreviewDone(false);
        addToast(t('admin:storage.stale.cleanedToast', { count: result.deletedFiles, size: f.formatBytes(result.freedBytes) }), 'success');
        await fetchStats();
      }
    } catch (err) {
      addToast(err instanceof Error ? describeError(err) : t('admin:storage.stale.failed'), 'warning');
    } finally {
      setTusCleaning(false);
    }
  };

  const handleCleanup = async (dryRun: boolean) => {
    setCleaning(true);
    setCleanupResult(null);
    try {
      const result = await api.admin.storageCleanup(dryRun);
      setCleanupResult(result);
      if (dryRun) {
        setPreviewDone(true);
      } else {
        setPreviewDone(false);
        addToast(t('admin:storage.cleanup.cleanedToast', { count: result.deletedFiles, size: f.formatBytes(result.freedBytes) }), 'success');
        await fetchStats();
      }
    } catch (err) {
      addToast(err instanceof Error ? describeError(err) : t('admin:storage.cleanup.failed'), 'warning');
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return <div className="text-ui text-txt-tertiary">{t('admin:storage.loading')}</div>;
  }

  if (loadError && !stats) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{loadError}</div>
        <button type="button" onClick={fetchStats} className="btn-outline btn-sm">{t('common:actions.retry')}</button>
      </div>
    );
  }

  if (!stats) return null;

  const hasOrphans = stats.orphanedFiles > 0 || stats.unlinkedAttachments > 0 || stats.danglingAttachments > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('admin:storage.title')}</h2>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('admin:storage.description')}</p>
      </div>

      {/* Storage Overview */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.overview.label')}</div>
        <div className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
          <StatTile label={t('admin:storage.overview.totalFiles')} value={f.formatNumber(stats.totalFiles)} size={f.formatBytes(stats.totalSize)} />
          <StatTile label={t('admin:storage.overview.referenced')} value={f.formatNumber(stats.referencedFiles)} size={f.formatBytes(stats.referencedSize)} />
          <StatTile label={t('admin:storage.overview.orphanedFiles')} value={f.formatNumber(stats.orphanedFiles)} size={f.formatBytes(stats.orphanedSize)} attention={stats.orphanedFiles > 0} />
          <StatTile label={t('admin:storage.overview.unlinkedUploads')} value={f.formatNumber(stats.unlinkedAttachments)} size={f.formatBytes(stats.unlinkedSize)} attention={stats.unlinkedAttachments > 0} />
          <StatTile label={t('admin:storage.overview.danglingRecords')} value={f.formatNumber(stats.danglingAttachments)} size={f.formatBytes(stats.danglingSize)} attention={stats.danglingAttachments > 0} />
          <StatTile label={t('admin:storage.overview.staleUploads')} value={f.formatNumber(stats.staleTusSessions)} size={f.formatBytes(stats.staleTusSize)} attention={stats.staleTusSessions > 0} />
        </div>
      </div>

      {/* File Type Breakdown */}
      {stats.breakdown.length > 0 && (
        <div>
          <div className="label-mono mb-1.5">{t('admin:storage.breakdown.label')}</div>
          <div className="surface-card rounded-lg p-4">
            <div className="space-y-1.5">
              {stats.breakdown.map((b) => (
                <div key={b.type} className="flex items-center justify-between gap-3 text-ui">
                  <span className="text-txt-secondary capitalize">{b.type}</span>
                  <span className="tabular font-mono text-meta text-txt-tertiary">
                    {t('admin:storage.breakdown.entry', { count: b.count, size: f.formatBytes(b.size) })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upload Limit */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.uploadLimit.label')}</div>
        <div className="surface-card rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor={uploadLimitId} className="text-ui text-txt-secondary whitespace-nowrap">{t('admin:storage.uploadLimit.maxFileSize')}</label>
            <div className="flex items-center gap-2">
              <input
                id={uploadLimitId}
                type="number"
                min={uploadUnit === 'GB' ? 0.001 : 1}
                step={uploadUnit === 'GB' ? 0.5 : 1}
                value={uploadLimitInput}
                onChange={(e) => setUploadLimitInput(e.target.value)}
                className="input-standard tabular h-8 w-24 px-2 py-0 text-center font-mono text-ui"
              />
              <div className="flex h-8 items-center rounded-md border border-border-soft bg-surface-input p-0.5">
                {(['MB', 'GB'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUploadUnitChange(u)}
                    aria-pressed={uploadUnit === u}
                    className={`h-full rounded px-2.5 font-mono text-label font-medium transition-colors duration-100 ${
                      uploadUnit === u
                        ? 'bg-surface-elevated text-txt-primary'
                        : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-primary'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={handleUploadLimitSave}
              disabled={!uploadLimitDirty || uploadLimitSaving || parsedUploadMb === null}
              aria-busy={uploadLimitSaving}
              className="btn-primary ml-auto"
            >
              {uploadLimitSaving ? t('common:states.saving') : t('common:actions.save')}
            </button>
          </div>
        </div>
      </div>

      {/* Limits per account */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.accountLimits.label')}</div>
        <div className="surface-card space-y-3 rounded-lg p-4">
          <p className="text-meta leading-snug text-txt-tertiary">{t('admin:storage.accountLimits.description')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={accountStorageId} className="field-label">{t('admin:storage.accountLimits.storage')}</label>
              <input
                id={accountStorageId}
                type="number"
                min={0}
                step={0.5}
                value={accountStorageInput}
                onChange={(e) => setAccountStorageInput(e.target.value)}
                className="input-standard tabular h-8 w-28 px-2 py-0 text-center font-mono text-ui"
              />
            </div>
            <div>
              <label htmlFor={accountSpacesId} className="field-label">{t('admin:storage.accountLimits.spaces')}</label>
              <input
                id={accountSpacesId}
                type="number"
                min={0}
                step={1}
                value={accountSpacesInput}
                onChange={(e) => setAccountSpacesInput(e.target.value)}
                className="input-standard tabular h-8 w-28 px-2 py-0 text-center font-mono text-ui"
              />
            </div>
            <button
              type="button"
              onClick={() => { void handleAccountLimitsSave(); }}
              disabled={!accountLimitsDirty || accountLimitsSaving}
              aria-busy={accountLimitsSaving}
              className="btn-primary ml-auto"
            >
              {accountLimitsSaving ? t('common:states.saving') : t('common:actions.save')}
            </button>
          </div>
        </div>
      </div>

      {/* Cleanup Actions */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.cleanup.label')}</div>
        <div className="surface-card rounded-lg p-4 space-y-3">
          {!hasOrphans && (
            <div className="text-ui text-txt-tertiary">{t('admin:storage.cleanup.nothingFound')}</div>
          )}

          {hasOrphans && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleCleanup(true)}
                disabled={cleaning}
                className="btn-outline"
              >
                {cleaning ? t('common:states.scanning') : t('admin:storage.cleanup.preview')}
              </button>
              <button
                type="button"
                onClick={() => handleCleanup(false)}
                disabled={cleaning || !previewDone}
                aria-busy={cleaning}
                className="btn-danger"
              >
                {cleaning ? t('admin:storage.cleanup.running') : t('admin:storage.cleanup.run')}
              </button>
            </div>
          )}

          {cleanupResult && (
            <div className={`rounded-md px-3 py-2 text-ui ${
              cleanupResult.dryRun
                ? 'bg-accent-amber/10 border border-accent-amber/30 text-accent-amber'
                : 'bg-status-online/10 border border-status-online/30 text-txt-positive'
            }`}>
              <div className="font-medium mb-1">
                {cleanupResult.dryRun ? t('admin:storage.cleanup.previewResult') : t('admin:storage.cleanup.complete')}
              </div>
              <div>
                {t('admin:storage.cleanup.orphanedFiles', { count: cleanupResult.deletedFiles, size: f.formatBytes(cleanupResult.freedBytes) })}
                {cleanupResult.deletedAttachmentRecords > 0 && (
                  t('admin:storage.cleanup.staleRecords', { count: cleanupResult.deletedAttachmentRecords })
                )}
              </div>
              {cleanupResult.errors.length > 0 && (
                <div className="mt-1 text-txt-danger">
                  {t('admin:storage.cleanup.errors', { count: cleanupResult.errors.length, first: cleanupResult.errors[0] })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stale Uploads */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.stale.label')}</div>
        <div className="surface-card rounded-lg p-4 space-y-3">
          <div className="text-meta text-txt-tertiary">
            <Trans
              t={t}
              i18nKey="admin:storage.stale.description"
              components={{ code: <code className="text-txt-secondary" /> }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="text-ui text-txt-secondary whitespace-nowrap">{t('admin:storage.stale.maxAge')}</label>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={tusMaxAgeHours}
              onChange={(e) => {
                const next = Number(e.target.value);
                setTusMaxAgeHours(Number.isFinite(next) && next > 0 ? next : 0);
                setTusPreviewDone(false);
                setTusCleanupResult(null);
              }}
              className="input-standard tabular h-8 w-24 px-2 py-0 text-center font-mono text-ui"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleTusCleanup(true)}
              disabled={tusCleaning || tusMaxAgeHours <= 0}
              className="btn-outline"
            >
              {tusCleaning ? t('common:states.scanning') : t('admin:storage.cleanup.preview')}
            </button>
            <button
              type="button"
              onClick={() => handleTusCleanup(false)}
              disabled={tusCleaning || !tusPreviewDone}
              aria-busy={tusCleaning}
              className="btn-danger"
            >
              {tusCleaning ? t('admin:storage.cleanup.running') : t('admin:storage.cleanup.run')}
            </button>
          </div>

          {tusCleanupResult && (
            <div className={`rounded-md px-3 py-2 text-ui ${
              tusCleanupResult.dryRun
                ? 'bg-accent-amber/10 border border-accent-amber/30 text-accent-amber'
                : 'bg-status-online/10 border border-status-online/30 text-txt-positive'
            }`}>
              <div className="font-medium mb-1">
                {tusCleanupResult.dryRun ? t('admin:storage.cleanup.previewResult') : t('admin:storage.cleanup.complete')}
              </div>
              <div>
                {t('admin:storage.stale.sessionFiles', { count: tusCleanupResult.deletedFiles, size: f.formatBytes(tusCleanupResult.freedBytes) })}
              </div>
              {tusCleanupResult.errors.length > 0 && (
                <div className="mt-1 text-txt-danger">
                  {t('admin:storage.cleanup.errors', { count: tusCleanupResult.errors.length, first: tusCleanupResult.errors[0] })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Media Retention */}
      <div>
        <div className="label-mono mb-1.5">{t('admin:storage.media.label')}</div>
        <div className="surface-card rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="text-ui text-txt-secondary whitespace-nowrap">{t('admin:storage.media.olderThan')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={mediaAgeDays}
                onChange={(e) => { setMediaAgeDays(Number(e.target.value)); setMediaPreviewDone(false); setMediaCleanupResult(null); }}
                className="input-standard tabular h-8 w-20 px-2 py-0 text-center font-mono text-ui"
              />
              <span className="text-ui text-txt-tertiary">{t('admin:storage.media.days')}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleMediaCleanup(true)}
              disabled={mediaCleaning || mediaAgeDays < 1}
              className="btn-outline"
            >
              {mediaCleaning ? t('common:states.scanning') : t('common:actions.preview')}
            </button>
            <button
              type="button"
              onClick={() => handleMediaCleanup(false)}
              disabled={mediaCleaning || !mediaPreviewDone}
              aria-busy={mediaCleaning}
              className="btn-danger"
            >
              {mediaCleaning ? t('admin:storage.media.running') : t('admin:storage.media.run')}
            </button>
          </div>

          {mediaCleanupResult && (
            <div className={`rounded-md px-3 py-2 text-ui ${
              mediaCleanupResult.dryRun
                ? 'bg-accent-amber/10 border border-accent-amber/30 text-accent-amber'
                : 'bg-status-online/10 border border-status-online/30 text-txt-positive'
            }`}>
              <div className="font-medium mb-1">
                {mediaCleanupResult.dryRun ? t('admin:storage.cleanup.previewResult') : t('admin:storage.cleanup.complete')}
              </div>
              <div>
                {t('admin:storage.media.files', { count: mediaCleanupResult.deletedFiles, size: f.formatBytes(mediaCleanupResult.freedBytes) })}
              </div>
              {mediaCleanupResult.errors.length > 0 && (
                <div className="mt-1 text-txt-danger">
                  {t('admin:storage.cleanup.errors', { count: mediaCleanupResult.errors.length, first: mediaCleanupResult.errors[0] })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => { setCleanupResult(null); setPreviewDone(false); fetchStats(); }}
        className="btn-outline btn-sm"
      >
        {t('admin:storage.refresh')}
      </button>
    </div>
  );
}
