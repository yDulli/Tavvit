import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpaceInviteLink } from '@backspace/shared';
import { normalizeVanityCode, VANITY_CODE_LIMITS } from '@backspace/shared/src/vanityInvites';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { spaceInviteUrl } from '../../../utils/inviteParser';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SettingsPage, SettingsSection } from '../settingsPanels/_shared/SettingsControls';

/** A space's own address: a link in words, which lets people in like any other and never runs out. */
function OwnAddressSection({ spaceId, origin, current }: { spaceId: string; origin: string; current: string | null }) {
  const { t } = useTranslation(['spaces', 'common']);
  const fieldId = useId();
  const [saved, setSaved] = useState(current);
  const [code, setCode] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSaved(current);
    setCode(current ?? '');
  }, [current]);

  const wanted = normalizeVanityCode(code);
  const save = async (value: string | null) => {
    setBusy(true);
    setError('');
    try {
      const { vanityCode } = await getApiForOrigin(origin).spaces.setVanity(spaceId, value);
      setSaved(vanityCode);
      setCode(vanityCode ?? '');
      setCopied(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(spaceInviteUrl(origin, saved));
      setCopied(true);
    } catch {
      // The address stands on the page to be selected.
    }
  };

  return (
    <SettingsSection title={t('spaces:settings.invites.vanity.title')}>
      <p className="mb-3 text-ui text-txt-secondary">{t('spaces:settings.invites.vanity.intro')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (wanted && wanted !== saved) void save(wanted);
        }}
      >
        <label htmlFor={`${fieldId}-code`} className="field-label">{t('spaces:settings.invites.vanity.label')}</label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="max-w-full truncate font-mono text-meta text-txt-tertiary">{spaceInviteUrl(origin, '')}</span>
          <input
            id={`${fieldId}-code`}
            type="text"
            value={code}
            onChange={(change) => setCode(change.target.value.slice(0, VANITY_CODE_LIMITS.MAX_LENGTH))}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${fieldId}-hint`}
            className="input-standard min-w-[160px] flex-1 font-mono"
          />
          <button type="submit" disabled={!wanted || wanted === saved || busy} aria-busy={busy} className="btn-primary flex-shrink-0">
            {t('common:actions.save')}
          </button>
        </div>
        <p id={`${fieldId}-hint`} className="mt-1.5 text-meta text-txt-tertiary">
          {t('spaces:settings.invites.vanity.hint', { min: VANITY_CODE_LIMITS.MIN_LENGTH, max: VANITY_CODE_LIMITS.MAX_LENGTH })}
        </p>
      </form>
      {error && <p role="alert" className="mt-2 text-meta text-txt-danger">{error}</p>}
      {saved && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void copy()} className="btn-outline btn-sm">
            {copied ? t('spaces:settings.invites.vanity.copied') : t('spaces:settings.invites.vanity.copy')}
          </button>
          <button type="button" onClick={() => void save(null)} disabled={busy} className="btn-quiet btn-sm">
            {t('spaces:settings.invites.vanity.remove')}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * The links into a space: what is out there, how much each was used, and a way to end
 * one. A link that got into the wrong hands stops working the moment it is revoked.
 * Everything goes to the instance that hosts the space.
 */
export function InvitesPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const f = useFormatters();
  const space = useSpaceStore((s) => s.spaces.find((entry) => entry.id === spaceId));
  const origin = space?._instanceOrigin ?? '';
  const addToast = useUIStore((s) => s.addToast);
  const [invites, setInvites] = useState<SpaceInviteLink[] | null>(null);
  const [error, setError] = useState('');
  const [expiry, setExpiry] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<SpaceInviteLink | null>(null);
  const expiryId = useId();
  const usesId = useId();

  const load = useCallback(async () => {
    try {
      const { invites: list } = await getApiForOrigin(origin).spaces.listInvites(spaceId);
      setInvites(list);
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, [origin, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const { invites: list } = await getApiForOrigin(origin).spaces.createInvite(spaceId, {
        expiresInSeconds: expiry === '' ? null : Number(expiry),
        maxUses: maxUses === '' ? null : Number(maxUses),
      });
      setInvites(list);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      const { invites: list } = await getApiForOrigin(origin).spaces.revokeInvite(spaceId, revoking.code);
      setInvites(list);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRevoking(null);
    }
  };

  const copy = (code: string) => {
    navigator.clipboard.writeText(spaceInviteUrl(origin, code)).then(
      () => addToast(t('spaces:settings.invites.list.copied'), 'success', 2000),
      () => addToast(t('spaces:settings.invites.list.copyFailed'), 'warning'),
    );
  };

  const usage = (invite: SpaceInviteLink) => (invite.maxUses === null
    ? t('spaces:settings.invites.list.uses', { count: invite.uses })
    : t('spaces:settings.invites.list.usesOf', { uses: invite.uses, max: invite.maxUses }));

  return (
    <SettingsPage title={t('spaces:settings.nav.tabs.invites')} intro={t('spaces:settings.invites.intro')}>
      <OwnAddressSection spaceId={spaceId} origin={origin} current={space?.vanityCode ?? null} />
      <SettingsSection title={t('spaces:settings.invites.new.title')}>
        <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
          <div>
            <label htmlFor={expiryId} className="field-label">{t('spaces:settings.invites.new.expiry.label')}</label>
            <select id={expiryId} value={expiry} onChange={(event) => setExpiry(event.target.value)} className="input-standard w-full">
              <option value="">{t('spaces:settings.invites.new.expiry.never')}</option>
              <option value="1800">{t('spaces:settings.invites.new.expiry.minutes30')}</option>
              <option value="3600">{t('spaces:settings.invites.new.expiry.hour1')}</option>
              <option value="21600">{t('spaces:settings.invites.new.expiry.hours6')}</option>
              <option value="86400">{t('spaces:settings.invites.new.expiry.day1')}</option>
              <option value="604800">{t('spaces:settings.invites.new.expiry.days7')}</option>
              <option value="2592000">{t('spaces:settings.invites.new.expiry.days30')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={usesId} className="field-label">{t('spaces:settings.invites.new.uses.label')}</label>
            <select id={usesId} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} className="input-standard w-full">
              <option value="">{t('spaces:settings.invites.new.uses.noLimit')}</option>
              {[1, 5, 10, 25, 50, 100].map((count) => (
                <option key={count} value={count}>{t('spaces:settings.invites.new.uses.people', { count })}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" onClick={() => { void create(); }} disabled={creating} aria-busy={creating} className="btn-primary">
          {t('spaces:settings.invites.new.create')}
        </button>
      </SettingsSection>

      {error && (
        <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      )}

      <SettingsSection title={t('spaces:settings.invites.list.title')} flush>
        {invites === null ? (
          <p className="px-4 py-3 text-ui text-txt-tertiary">{t('common:states.loading')}</p>
        ) : invites.length === 0 ? (
          <p className="px-4 py-3 text-ui text-txt-tertiary">{t('spaces:settings.invites.list.empty')}</p>
        ) : (
          <ul className="divide-y divide-border-hard">
            {invites.map((invite) => (
              <li key={invite.code} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-ui text-txt-primary">{invite.code}</span>
                    {invite.standing && <span className="label-mono flex-shrink-0">{t('spaces:settings.invites.list.standing')}</span>}
                  </div>
                  <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">
                    {usage(invite)}
                    {' · '}
                    {invite.expiresAt === null
                      ? t('spaces:settings.invites.list.noEnd')
                      : t('spaces:settings.invites.list.ends', { date: f.formatDateTime(invite.expiresAt) })}
                    {invite.createdBy && <>{' · '}{t('spaces:settings.invites.list.by', { name: invite.createdBy.name })}</>}
                  </p>
                </div>
                <button type="button" onClick={() => copy(invite.code)} className="btn-quiet btn-sm">{t('common:actions.copy')}</button>
                <button type="button" onClick={() => setRevoking(invite)} className="btn-outline btn-sm">{t('spaces:settings.invites.list.revoke')}</button>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => { void revoke(); }}
        title={t('spaces:settings.invites.revokeConfirm.title')}
        description={t(revoking?.standing ? 'spaces:settings.invites.revokeConfirm.standing' : 'spaces:settings.invites.revokeConfirm.description')}
        variant="danger"
        confirmLabel={t('spaces:settings.invites.list.revoke')}
      />
    </SettingsPage>
  );
}
