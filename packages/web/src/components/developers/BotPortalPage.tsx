import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BOT_LIMITS, type BotDetail, type BotInfo } from '@backspace/shared/src/bots';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useTransferStore } from '../../stores/transferStore';
import { useUIStore } from '../../stores/uiStore';
import { PERMISSION_GROUPS, usePermissionGroupTitles } from '../../utils/permissionGroups';
import { PermissionBits, permissionsToString } from '../../utils/permissions';
import { waitForTransferAttachment } from '../../utils/waitForTransfer';
import { SettingsSection } from '../modals/settingsPanels/_shared/SettingsControls';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { ImageCropModal } from '../ui/ImageCropModal';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { usePermissionNames } from '../ui/OverrideEntry';
import { useSensitiveText } from '../ui/Sensitive';

/** What a bot asks for until its owner says otherwise: to read, write and react, and no more. */
const USUAL_RIGHTS = PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY | PermissionBits.SEND_MESSAGES | PermissionBits.ADD_REACTIONS;

/** The address that brings a bot into a space: whoever opens it chooses where, and sees what it asks for. */
function inviteAddress(botId: string, rights: bigint): string {
  return `${window.location.origin}/bots/${botId}/add?permissions=${permissionsToString(rights)}`;
}

/** A value to copy. A `secret` one (a token) streamer mode keeps out of the field; Copy still copies it. */
function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const { t } = useTranslation(['settings']);
  const sensitive = useSensitiveText();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // The value stays selectable in the field.
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        readOnly
        value={secret ? sensitive(value) : value}
        aria-label={label}
        onFocus={(focus) => focus.currentTarget.select()}
        className="input-standard min-w-0 flex-1 font-mono text-meta"
      />
      <button type="button" onClick={() => void copy()} className="btn-outline btn-sm flex-shrink-0">
        {copied ? t('settings:developers.copied') : t('settings:developers.copy')}
      </button>
    </div>
  );
}

function PortalFrame({ title, back, children }: { title: string; back: { to: string; label: string }; children: React.ReactNode }) {
  const { t } = useTranslation(['settings']);
  return (
    <div className="flex h-full justify-center overflow-y-auto bg-surface-base px-4 py-8 desktop:py-12">
      <div className="flex w-full max-w-2xl flex-col gap-6 self-start">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title min-w-0 truncate">{title}</h1>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {/* A page of its own, not the app's: it opens beside it, and the desktop app hands it to the browser. */}
            <a href="/developers" target="_blank" rel="noopener noreferrer" className="btn-quiet btn-sm">{t('settings:developers.docs')}</a>
            <Link to={back.to} className="btn-quiet btn-sm">{back.label}</Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function BotList() {
  const { t } = useTranslation(['settings']);
  const { formatRelativeTime } = useFormatters();
  const navigate = useNavigate();
  const fieldId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.bots.list().then((response) => {
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

  const create = async (submitted: FormEvent) => {
    submitted.preventDefault();
    const wanted = name.trim();
    if (!wanted || busy) return;
    setBusy(true);
    setError('');
    try {
      const made = await api.bots.create(wanted);
      // It is shown once: the page it goes to takes it out of the history at once.
      navigate(`/developers/bots/${made.bot.id}`, { state: { token: made.token } });
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <PortalFrame title={t('settings:developers.portal.title')} back={{ to: '/channels/@me', label: t('settings:developers.portal.backToApp') }}>
      {enabled === null && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}
      {enabled === false && <p className="text-ui text-txt-secondary">{t('settings:developers.disabled')}</p>}

      {enabled && (
        <>
          <SettingsSection title={t('settings:developers.title')} description={t('settings:developers.description', { max: BOT_LIMITS.PER_OWNER })}>
            <form onSubmit={(submitted) => void create(submitted)} className="flex items-center gap-1.5">
              <label htmlFor={fieldId} className="sr-only">{t('settings:developers.nameLabel')}</label>
              <input
                id={fieldId}
                type="text"
                value={name}
                placeholder={t('settings:developers.nameLabel')}
                onChange={(change) => setName(change.target.value.slice(0, BOT_LIMITS.NAME_MAX_LENGTH))}
                className="input-standard min-w-0 flex-1"
              />
              <button type="submit" disabled={!name.trim() || busy || bots.length >= BOT_LIMITS.PER_OWNER} aria-busy={busy} className="btn-primary flex-shrink-0">
                {t('settings:developers.create')}
              </button>
            </form>
          </SettingsSection>

          {bots.length > 0 && (
            <SettingsSection title={t('settings:developers.listTitle')} flush>
              <ul className="divide-y divide-border-hard">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <Link to={`/developers/bots/${bot.id}`} className="list-row gap-3 px-3 py-2.5">
                      <Avatar src={bot.avatar} name={bot.name} size={36} userId={bot.id} avatarColor={bot.avatarColor} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-medium text-txt-primary">{bot.name}</span>
                        <span className="block truncate text-meta text-txt-tertiary">
                          {bot.lastUsedAt === null
                            ? t('settings:developers.neverUsed')
                            : t('settings:developers.lastUsed', { time: formatRelativeTime(bot.lastUsedAt) })}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={16} className="flex-shrink-0 text-txt-tertiary" />
                    </Link>
                  </li>
                ))}
              </ul>
            </SettingsSection>
          )}
        </>
      )}

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
    </PortalFrame>
  );
}

function InviteSection({ botId }: { botId: string }) {
  const { t } = useTranslation(['settings']);
  const names = usePermissionNames();
  const groupTitles = usePermissionGroupTitles();
  const [rights, setRights] = useState<bigint>(USUAL_RIGHTS);
  const address = useMemo(() => inviteAddress(botId, rights), [botId, rights]);

  return (
    <SettingsSection title={t('settings:developers.inviteLabel')} description={t('settings:developers.portal.inviteDescription')}>
      <CopyField label={t('settings:developers.inviteLabel')} value={address} />
      <details className="mt-3">
        <summary className="cursor-pointer text-ui text-txt-secondary hover:text-txt-primary">{t('settings:developers.portal.inviteRights')}</summary>
        <div className="mt-3 grid gap-4 desktop:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => {
            // A bot is never an administrator: the server refuses it whatever an address asks for.
            const perms = group.perms.filter((perm) => perm.bit !== PermissionBits.ADMINISTRATOR);
            if (perms.length === 0) return null;
            return (
              <fieldset key={group.id} className="min-w-0">
                <legend className="label-mono mb-1.5">{groupTitles[group.id]}</legend>
                <div className="flex flex-col gap-1">
                  {perms.map((perm) => (
                    <label key={perm.key} className="flex cursor-pointer items-center gap-2 text-ui text-txt-secondary">
                      <input
                        type="checkbox"
                        checked={(rights & perm.bit) !== 0n}
                        onChange={(change) => setRights((current) => (change.target.checked ? current | perm.bit : current & ~perm.bit))}
                      />
                      <span className="min-w-0 truncate">{names[perm.key]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </details>
    </SettingsSection>
  );
}

function BotPage({ botId }: { botId: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const { formatRelativeTime } = useFormatters();
  const location = useLocation();
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);
  const fieldId = useId();
  const pictureInput = useRef<HTMLInputElement>(null);

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(() => (location.state as { token?: string } | null)?.token ?? null);
  const [asking, setAsking] = useState<'rotate' | 'remove' | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);

  // A token must not stay in the browser's history, where a reload would show it again.
  useEffect(() => {
    if ((location.state as { token?: string } | null)?.token) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const take = useCallback((next: BotDetail) => {
    setBot(next);
    setName(next.name);
    setDescription(next.description ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.bots.detail(botId).then((next) => {
      if (!cancelled) take(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(describeError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [botId, take]);

  const save = async (avatar?: string | null) => {
    if (!bot) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, ...(avatar !== undefined ? { avatar } : {}) };
      const updated = await api.bots.update(bot.id, body);
      setBot({ ...bot, ...updated });
      addToast(t('settings:developers.portal.saved'), 'success', 2000);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const pickPicture = (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (file) setCropSource(URL.createObjectURL(file));
  };

  const closeCrop = () => {
    if (cropSource) URL.revokeObjectURL(cropSource);
    setCropSource(null);
  };

  const cropped = async (blob: Blob) => {
    closeCrop();
    setPictureBusy(true);
    try {
      const file = new File([blob], 'avatar.webp', { type: blob.type || 'image/webp' });
      const transfer = await useTransferStore.getState().startUpload(file, { tray: false });
      const { filename } = await waitForTransferAttachment(transfer);
      await save(filename);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setPictureBusy(false);
    }
  };

  const answer = async () => {
    if (!bot || !asking) return;
    const action = asking;
    setAsking(null);
    try {
      if (action === 'rotate') {
        setToken((await api.bots.rotate(bot.id)).token);
      } else {
        await api.bots.remove(bot.id);
        navigate('/developers/bots');
      }
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  const changed = bot !== null && (name.trim() !== bot.name || (description.trim() || null) !== bot.description);

  return (
    <PortalFrame title={bot?.name ?? t('settings:developers.portal.title')} back={{ to: '/developers/bots', label: t('settings:developers.portal.allBots') }}>
      {!bot && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}

      {token && bot && (
        <SettingsSection title={t('settings:developers.tokenTitle', { name: bot.name })} description={t('settings:developers.tokenDescription')}>
          <CopyField label={t('settings:developers.tokenLabel')} value={token} secret />
        </SettingsSection>
      )}

      {bot && (
        <>
          <SettingsSection title={t('settings:developers.portal.profile')}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar src={bot.avatar} name={bot.name} size={64} userId={bot.id} avatarColor={bot.avatarColor} />
                <div className="flex flex-wrap gap-2">
                  <input ref={pictureInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickPicture} />
                  <button type="button" onClick={() => pictureInput.current?.click()} disabled={pictureBusy} aria-busy={pictureBusy} className="btn-outline btn-sm">
                    {t('settings:developers.portal.pictureChange')}
                  </button>
                  {bot.avatar && (
                    <button type="button" onClick={() => void save(null)} disabled={busy} className="btn-quiet btn-sm">
                      {t('settings:developers.portal.pictureRemove')}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor={`${fieldId}-name`} className="field-label">{t('settings:developers.nameLabel')}</label>
                <input
                  id={`${fieldId}-name`}
                  type="text"
                  value={name}
                  maxLength={BOT_LIMITS.NAME_MAX_LENGTH}
                  onChange={(change) => setName(change.target.value)}
                  className="input-standard w-full"
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-description`} className="field-label">{t('settings:developers.portal.descriptionLabel')}</label>
                <textarea
                  id={`${fieldId}-description`}
                  rows={3}
                  value={description}
                  maxLength={BOT_LIMITS.DESCRIPTION_MAX_LENGTH}
                  onChange={(change) => setDescription(change.target.value)}
                  className="input-standard w-full resize-none"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-meta text-txt-tertiary">
                  {bot.lastUsedAt === null
                    ? t('settings:developers.neverUsed')
                    : t('settings:developers.lastUsed', { time: formatRelativeTime(bot.lastUsedAt) })}
                </p>
                <button type="button" onClick={() => void save()} disabled={busy || !changed || !name.trim()} aria-busy={busy} className="btn-primary">
                  {t('common:actions.save')}
                </button>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title={t('settings:developers.tokenLabel')} description={t('settings:developers.portal.tokenHint')}>
            <button type="button" onClick={() => setAsking('rotate')} className="btn-outline">{t('settings:developers.rotate')}</button>
          </SettingsSection>

          <InviteSection botId={bot.id} />

          <SettingsSection title={t('settings:developers.portal.commands')} description={t('settings:developers.portal.commandsHint')}>
            {bot.commands.length === 0 ? (
              <p className="text-ui text-txt-tertiary">{t('settings:developers.portal.noCommands')}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border-hard">
                {bot.commands.map((command) => (
                  <li key={command.name} className="py-2">
                    <p className="font-mono text-meta text-txt-primary">/{command.name}</p>
                    <p className="text-meta text-txt-tertiary">{command.description}</p>
                    {command.options && (
                      <p className="mt-0.5 font-mono text-label text-txt-tertiary">
                        {command.options.map((option) => `${option.name}${option.required ? '' : '?'}: ${option.type}`).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection title={t('settings:developers.portal.spaces')}>
            {bot.spaces.length === 0 ? (
              <p className="text-ui text-txt-tertiary">{t('settings:developers.portal.noSpaces')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {bot.spaces.map((space) => (
                  <li key={space.id}>
                    <Link to={`/channels/${space.id}`} className="text-ui text-txt-link hover:underline">{space.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection title={t('settings:developers.remove')} tone="danger" description={t('settings:developers.removeBody', { name: bot.name })}>
            <button type="button" onClick={() => setAsking('remove')} className="btn-danger">{t('settings:developers.remove')}</button>
          </SettingsSection>
        </>
      )}

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <ImageCropModal
        isOpen={cropSource !== null}
        onClose={closeCrop}
        imageSrc={cropSource ?? ''}
        onCropComplete={(blob) => void cropped(blob)}
        title={t('settings:developers.portal.cropTitle')}
        cropShape="round"
        aspectRatio={1}
        maxOutputDimension={256}
      />
      <ConfirmDialog
        isOpen={asking !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => void answer()}
        title={asking === 'rotate' ? t('settings:developers.rotateTitle') : t('settings:developers.removeTitle')}
        description={asking === 'rotate'
          ? t('settings:developers.rotateBody', { name: bot?.name ?? '' })
          : t('settings:developers.removeBody', { name: bot?.name ?? '' })}
        confirmLabel={asking === 'rotate' ? t('settings:developers.rotate') : t('settings:developers.remove')}
        variant="danger"
      />
    </PortalFrame>
  );
}

/**
 * The developer portal: making a bot, its token, its picture, the address that brings it into a
 * space, what it answers to and where it is. The server decides all of it again; someone else's
 * bot looks the same as none at all.
 */
export function BotPortalPage() {
  const { botId } = useParams<{ botId: string }>();
  return botId ? <BotPage key={botId} botId={botId} /> : <BotList />;
}
