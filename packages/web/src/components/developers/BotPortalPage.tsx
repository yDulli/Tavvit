import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BOT_LIMITS, type BotDetail, type BotInfo } from '@backspace/shared/src/bots';
import { USERNAME_LIMITS, isUsernameShape, normalizeUsername } from '@backspace/shared/src/usernames';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useTransferStore } from '../../stores/transferStore';
import { useUIStore } from '../../stores/uiStore';
import { PERMISSION_GROUPS, usePermissionGroupTitles } from '../../utils/permissionGroups';
import { PermissionBits, permissionsToString } from '../../utils/permissions';
import { waitForTransferAttachment } from '../../utils/waitForTransfer';
import { useRadioArrows } from '../modals/settingsPanels/_shared/SettingsControls';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CountBadge } from '../ui/CountBadge';
import { Icon } from '../ui/Icon';
import { ImageCropModal } from '../ui/ImageCropModal';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { usePermissionNames } from '../ui/OverrideEntry';
import { useSensitiveText } from '../ui/Sensitive';
import { SlidingMark } from '../ui/SlidingMark';

/** What a bot asks for until its owner says otherwise: to read, write and react, and no more. */
const USUAL_RIGHTS = PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY | PermissionBits.SEND_MESSAGES | PermissionBits.ADD_REACTIONS;

/** The address that brings a bot into a space: whoever opens it chooses where, and sees what it asks for. */
function inviteAddress(botId: string, rights: bigint): string {
  return `${window.location.origin}/bots/${botId}/add?permissions=${permissionsToString(rights)}`;
}

/** The parts of a bot's page, one tab each, in this order. */
const TABS = ['profile', 'token', 'invite', 'commands', 'spaces'] as const;
type TabId = (typeof TABS)[number];

/** A bot's two pictures and how each is cut: its round picture, and the banner across its profile as a person's is. */
type PictureKind = 'avatar' | 'banner';
const CROPS: Record<PictureKind, { shape: 'round' | 'rect'; aspect: number; size: number }> = {
  avatar: { shape: 'round', aspect: 1, size: 256 },
  banner: { shape: 'rect', aspect: 3, size: 1280 },
};

/** The token a page was opened with: only right after the bot was made. */
function tokenFrom(state: unknown): string | null {
  const token = (state as { token?: unknown } | null)?.token;
  return typeof token === 'string' ? token : null;
}

/** The signed-in person's bots, and whether this instance allows bots at all; read once per page. */
function useOwnBots(): { enabled: boolean | null; bots: BotInfo[]; error: string } {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [bots, setBots] = useState<BotInfo[]>([]);
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
  return { enabled, bots, error };
}

type Tone = 'default' | 'notice' | 'danger';

/**
 * A card of the portal: its title, what it is for, an action beside them, and what it holds below.
 * `notice` is lit amber (a token shown once), `danger` edged in rose (deleting the bot).
 */
function Card({ title, description, action, tone = 'default', children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: Tone;
  children?: ReactNode;
}) {
  const style = tone === 'notice' ? ({ '--tile': 'rgb(var(--accent-amber))' } as CSSProperties) : undefined;
  const toneClass = tone === 'notice' ? 'tinted-card' : tone === 'danger' ? 'border-accent-rose/30' : '';
  return (
    <section style={style} className={`surface-card rounded-lg ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className={`text-lead font-semibold ${tone === 'danger' ? 'text-txt-danger' : 'text-txt-primary'}`}>{title}</h2>
          {description && <p className="mt-1 text-meta leading-relaxed text-txt-secondary">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A part with nothing in it yet: one line, under the glyph of what would be there. */
function Empty({ glyph, children }: { glyph: string; children: ReactNode }) {
  return (
    <div className="empty-state border-t border-border-hard py-8">
      <span className="empty-state-icon font-mono text-ui" aria-hidden="true">{glyph}</span>
      <p className="empty-state-body">{children}</p>
    </div>
  );
}

/** One fact about a bot as a tile: a count large, a time at the title size. */
function Stat({ label, value, kind }: { label: string; value: string; kind: 'count' | 'time' }) {
  return (
    <div className={`surface-card rounded-lg p-4 ${kind === 'time' ? 'col-span-2 desktop:col-span-1' : ''}`}>
      <p className="label-mono">{label}</p>
      <p className={kind === 'count' ? 'stat-value mt-2' : 'mt-2 truncate text-title font-semibold text-txt-primary'}>{value}</p>
    </div>
  );
}

/** A value to copy. A `secret` one (a token) streamer mode keeps out of the field; Copy still copies it. */
function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const { t } = useTranslation(['settings']);
  const sensitive = useSensitiveText();
  const [copied, setCopied] = useState(false);
  // "Copied" turns back after a moment, so a second copy says so again.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // The value stays selectable in the field.
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={secret ? sensitive(value) : value}
        aria-label={label}
        onFocus={(focus) => focus.currentTarget.select()}
        className="input-standard min-w-0 flex-1 font-mono text-meta"
      />
      <button type="button" onClick={() => void copy()} className="btn-outline flex-shrink-0">
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? t('settings:developers.copied') : t('settings:developers.copy')}
      </button>
    </div>
  );
}

/**
 * The portal's frame: a bar with the docs and the way back to the app, the person's bots down the
 * side on a wide window (`active` is the one open, drawn as it is now, a new name or picture
 * included), and, once known, how many they have of the most they may.
 */
function Shell({ bots, owned, active, children }: { bots: BotInfo[]; owned: number | null; active?: BotInfo; children: ReactNode }) {
  const { t } = useTranslation(['settings']);
  return (
    <div className="lit relative flex h-full flex-col bg-surface-base text-txt-message">
      <header className="panel-bar flex items-center justify-between gap-3 bg-surface-channel/70 px-4">
        <div className="flex min-w-0 items-center gap-5">
          <Link to="/developers/bots" className="truncate text-ui font-semibold text-txt-primary">{t('settings:developers.portal.title')}</Link>
          {/* A page of its own, not the app's: it opens beside it, and the desktop app hands it to the browser. */}
          <a href="/developers" target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-ui text-txt-secondary transition-colors hover:text-txt-primary">
            {t('settings:developers.docs')}
          </a>
        </div>
        <Link to="/channels/@me" className="btn-outline btn-sm flex-shrink-0">{t('settings:developers.portal.backToApp')}</Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('settings:developers.listTitle')} className="hidden w-64 flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-hard bg-surface-channel/60 p-2 desktop:flex">
          <p className="label-mono px-2.5 pb-2 pt-3">{t('settings:developers.listTitle')}</p>
          {bots.map((listed) => {
            const isActive = listed.id === active?.id;
            const bot = isActive && active ? active : listed;
            return (
              <Link key={bot.id} to={`/developers/bots/${bot.id}`} className="nav-item h-10" data-active={isActive} aria-current={isActive ? 'page' : undefined}>
                <Avatar src={bot.avatar} name={bot.name} size={24} userId={bot.id} avatarColor={bot.avatarColor} />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
              </Link>
            );
          })}
          {/* On a bot's page, the way to make another; the list's page has the form itself. */}
          {active && bots.length < BOT_LIMITS.PER_OWNER && (
            <Link to="/developers/bots" className="nav-item mt-2 h-10 text-txt-secondary">
              <Icon name="plus" size={16} />
              <span className="min-w-0 flex-1 truncate">{t('settings:developers.portal.newBot')}</span>
            </Link>
          )}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative isolate min-h-0 flex-1 overflow-y-auto">
            <div className="hero-light" />
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 desktop:px-6 desktop:py-10">{children}</div>
          </main>
          {owned !== null && (
            <footer className="flex flex-shrink-0 items-center border-t border-border-hard px-4 py-2.5 desktop:px-6">
              <span className="label-mono tabular">{t('settings:developers.portal.botCount', { used: owned, max: BOT_LIMITS.PER_OWNER })}</span>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

function BotList() {
  const { t } = useTranslation(['settings']);
  const { formatRelativeTime } = useFormatters();
  const navigate = useNavigate();
  const ids = useId();
  const { enabled, bots, error: loadError } = useOwnBots();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const full = bots.length >= BOT_LIMITS.PER_OWNER;

  const create = async (submitted: FormEvent) => {
    submitted.preventDefault();
    const wanted = name.trim();
    if (!wanted || busy || full) return;
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

  const shownError = error || loadError;

  return (
    <Shell bots={bots} owned={enabled ? bots.length : null}>
      <div className="flex flex-col gap-4">
        <h1 className="display-title ink">{t('settings:developers.title')}</h1>
        <p className="max-w-xl text-lead leading-relaxed text-txt-secondary">
          {t('settings:developers.description', { max: BOT_LIMITS.PER_OWNER })}
        </p>
      </div>

      {enabled === null && !shownError && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}
      {enabled === false && <p className="text-ui text-txt-secondary">{t('settings:developers.disabled')}</p>}

      {enabled && (
        <>
          <form onSubmit={(submitted) => void create(submitted)} className="surface-card flex flex-wrap items-end gap-3 rounded-lg p-5">
            <div className="min-w-0 flex-1 basis-48">
              <label htmlFor={`${ids}-name`} className="field-label">{t('settings:developers.nameLabel')}</label>
              <input
                id={`${ids}-name`}
                type="text"
                value={name}
                onChange={(change) => setName(change.target.value.slice(0, BOT_LIMITS.NAME_MAX_LENGTH))}
                disabled={full}
                className="input-standard w-full"
              />
            </div>
            <button type="submit" disabled={!name.trim() || busy || full} aria-busy={busy} className="btn-primary">
              {t('settings:developers.create')}
            </button>
          </form>

          {bots.length > 0 && (
            <section aria-labelledby={`${ids}-list`}>
              <h2 id={`${ids}-list`} className="label-mono mb-3">{t('settings:developers.listTitle')}</h2>
              <ul className="grid gap-3 desktop:grid-cols-2">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <Link to={`/developers/bots/${bot.id}`} className="surface-card lift spotlight flex items-center gap-4 rounded-lg p-4">
                      <Avatar src={bot.avatar} name={bot.name} size={44} userId={bot.id} avatarColor={bot.avatarColor} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-semibold text-txt-primary">{bot.name}</span>
                        <span className="mt-0.5 block truncate text-meta text-txt-tertiary">
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
            </section>
          )}
        </>
      )}

      {shownError && <p role="alert" className="text-meta text-txt-danger">{shownError}</p>}
    </Shell>
  );
}

/** The address that brings the bot into a space, with the rights it asks for there. */
function InvitePanel({ botId }: { botId: string }) {
  const { t } = useTranslation(['settings']);
  const names = usePermissionNames();
  const groupTitles = usePermissionGroupTitles();
  const [rights, setRights] = useState<bigint>(USUAL_RIGHTS);
  const address = useMemo(() => inviteAddress(botId, rights), [botId, rights]);

  return (
    <Card title={t('settings:developers.inviteLabel')} description={t('settings:developers.portal.inviteDescription')}>
      <div className="px-5 pb-5">
        <CopyField label={t('settings:developers.inviteLabel')} value={address} />
      </div>
      <div className="border-t border-border-hard p-5">
        <p className="label-mono">{t('settings:developers.portal.inviteRights')}</p>
        <div className="mt-4 grid gap-6 desktop:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => {
            // A bot is never an administrator: the server refuses it whatever an address asks for.
            const perms = group.perms.filter((perm) => perm.bit !== PermissionBits.ADMINISTRATOR);
            if (perms.length === 0) return null;
            return (
              <fieldset key={group.id} className="min-w-0">
                <legend className="mb-1.5 text-ui font-semibold text-txt-primary">{groupTitles[group.id]}</legend>
                <div className="flex flex-col">
                  {perms.map((perm) => (
                    <label key={perm.key} className="list-row cursor-pointer gap-2.5 text-ui text-txt-secondary hover:bg-interactive-hover hover:text-txt-primary">
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
      </div>
    </Card>
  );
}

function BotPage({ botId }: { botId: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const { formatNumber, formatRelativeTime } = useFormatters();
  const location = useLocation();
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);
  const ids = useId();
  const pictureInput = useRef<HTMLInputElement>(null);
  const { bots, enabled } = useOwnBots();

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(() => tokenFrom(location.state));
  // A bot just made opens where its token is, the one time it is shown.
  const [tab, setTab] = useState<TabId>(() => (tokenFrom(location.state) ? 'token' : 'profile'));
  const tabArrows = useRadioArrows(TABS, tab, setTab, '[aria-selected="true"]');
  const [asking, setAsking] = useState<'rotate' | 'remove' | null>(null);
  // Which picture the file chooser was opened for, the file being cut, and the picture on its way up.
  const picking = useRef<PictureKind>('avatar');
  const [cropping, setCropping] = useState<{ kind: PictureKind; source: string } | null>(null);
  const [pictureBusy, setPictureBusy] = useState<PictureKind | null>(null);

  // A token must not stay in the browser's history, where a reload would show it again.
  useEffect(() => {
    if (tokenFrom(location.state)) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const take = useCallback((next: BotDetail) => {
    setBot(next);
    setName(next.name);
    setUsername(next.username ?? '');
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

  // The username is sent only when it changed, as the server stores it.
  const wantedUsername = normalizeUsername(username);
  const usernameChanged = bot?.username !== undefined && wantedUsername !== bot.username;
  const usernameFits = !usernameChanged || isUsernameShape(wantedUsername);

  /** Sends `body` with the name and text, and takes what the server answers as the bot now. */
  const update = async (body: { name: string; description: string | null; avatar?: string | null; banner?: string | null; username?: string }) => {
    if (!bot) return;
    setBusy(true);
    try {
      const updated = await api.bots.update(bot.id, body);
      setBot({ ...bot, ...updated });
      if (body.username !== undefined) setUsername(updated.username ?? body.username);
      addToast(t('settings:developers.portal.saved'), 'success', 2000);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
    }
  };

  /** Saves the form: the name, the text and, when it changed, the username. */
  const saveProfile = () => update({
    name: name.trim(),
    description: description.trim() || null,
    ...(usernameChanged ? { username: wantedUsername } : {}),
  });

  /**
   * A new picture or banner (`null` takes it away), with the name and text as they are saved:
   * what is typed in the form and not saved yet stays for its own Save.
   */
  const savePicture = (kind: PictureKind, value: string | null) => {
    if (!bot) return Promise.resolve();
    return update({ name: bot.name, description: bot.description, [kind]: value });
  };

  const choosePicture = (kind: PictureKind) => {
    picking.current = kind;
    pictureInput.current?.click();
  };

  const pickPicture = (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (file) setCropping({ kind: picking.current, source: URL.createObjectURL(file) });
  };

  const closeCrop = () => {
    if (cropping) URL.revokeObjectURL(cropping.source);
    setCropping(null);
  };

  const cropped = async (blob: Blob) => {
    if (!cropping) return;
    const { kind } = cropping;
    closeCrop();
    setPictureBusy(kind);
    try {
      const file = new File([blob], `${kind}.webp`, { type: blob.type || 'image/webp' });
      const transfer = await useTransferStore.getState().startUpload(file, { tray: false });
      const { filename } = await waitForTransferAttachment(transfer);
      await savePicture(kind, filename);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setPictureBusy(null);
    }
  };

  const answer = async () => {
    if (!bot || !asking) return;
    const action = asking;
    setAsking(null);
    try {
      if (action === 'rotate') {
        setToken((await api.bots.rotate(bot.id)).token);
        setTab('token');
      } else {
        await api.bots.remove(bot.id);
        navigate('/developers/bots');
      }
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  const changed = bot !== null && (name.trim() !== bot.name || (description.trim() || null) !== bot.description || usernameChanged);

  const tabLabels: Record<TabId, string> = {
    profile: t('settings:developers.portal.profile'),
    token: t('settings:developers.portal.tabs.token'),
    invite: t('settings:developers.portal.tabs.invite'),
    commands: t('settings:developers.portal.commands'),
    spaces: t('settings:developers.portal.spaces'),
  };
  const tabCounts: Partial<Record<TabId, number>> = bot ? { commands: bot.commands.length, spaces: bot.spaces.length } : {};

  return (
    <Shell bots={bots} owned={enabled ? bots.length : null} active={bot ?? undefined}>
      {!bot && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}

      {bot && (
        <>
          <div className="flex flex-col gap-5">
            {bot.banner && (
              <img src={api.uploads.url(bot.banner)} alt="" className="aspect-[3/1] w-full rounded-lg border border-border-hard object-cover" />
            )}
            <div className="flex flex-wrap items-center gap-5">
              <Avatar src={bot.avatar} name={bot.name} size={80} userId={bot.id} avatarColor={bot.avatarColor} />
              <div className="min-w-0 flex-1">
                <h1 className="display-title ink truncate">{bot.name}</h1>
                {bot.description && <p className="mt-2 line-clamp-2 text-lead text-txt-secondary">{bot.description}</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 desktop:grid-cols-3">
            <Stat
              kind="time"
              label={t('settings:developers.portal.lastUsedLabel')}
              value={bot.lastUsedAt === null ? t('settings:developers.neverUsed') : formatRelativeTime(bot.lastUsedAt)}
            />
            <Stat kind="count" label={t('settings:developers.portal.commands')} value={formatNumber(bot.commands.length)} />
            <Stat kind="count" label={t('settings:developers.portal.spaces')} value={formatNumber(bot.spaces.length)} />
          </div>

          <div className="flex flex-col gap-5">
            <div
              ref={tabArrows.ref}
              role="tablist"
              aria-label={bot.name}
              onKeyDown={tabArrows.onKeyDown}
              className="sliding-list no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-border-hard"
            >
              <SlidingMark variant="line" selector="[data-active-line]" />
              {TABS.map((id) => {
                const selected = tab === id;
                const count = tabCounts[id] ?? 0;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`${ids}-tab-${id}`}
                    aria-controls={`${ids}-panel-${id}`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(id)}
                    className={`relative flex h-10 flex-shrink-0 items-center gap-2 whitespace-nowrap px-2 text-ui font-medium transition-colors ${selected ? 'text-txt-primary' : 'text-txt-tertiary hover:text-txt-secondary'}`}
                  >
                    {tabLabels[id]}
                    {count > 0 && <CountBadge count={count} muted />}
                    {selected && <span aria-hidden="true" data-active-line="" className="active-line absolute inset-x-2 bottom-0 h-[2px]" />}
                  </button>
                );
              })}
            </div>

            <div role="tabpanel" id={`${ids}-panel-${tab}`} aria-labelledby={`${ids}-tab-${tab}`} className="flex flex-col gap-5">
              {tab === 'profile' && (
                <>
                  <Card title={t('settings:developers.portal.profile')}>
                    <div className="flex flex-col gap-5 border-t border-border-hard p-5">
                      <div>
                        <p className="field-label">{t('settings:developers.portal.pictureLabel')}</p>
                        <div className="flex flex-wrap items-center gap-3">
                          <Avatar src={bot.avatar} name={bot.name} size={48} userId={bot.id} avatarColor={bot.avatarColor} />
                          <button type="button" onClick={() => choosePicture('avatar')} disabled={pictureBusy !== null} aria-busy={pictureBusy === 'avatar'} className="btn-outline btn-sm">
                            {t('settings:developers.portal.pictureChange')}
                          </button>
                          {bot.avatar && (
                            <button type="button" onClick={() => void savePicture('avatar', null)} disabled={busy} className="btn-quiet btn-sm">
                              {t('settings:developers.portal.pictureRemove')}
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="field-label">{t('settings:developers.portal.bannerLabel')}</p>
                        <div className="flex flex-wrap items-center gap-3">
                          {bot.banner ? (
                            <img src={api.uploads.url(bot.banner)} alt="" className="aspect-[3/1] w-36 flex-shrink-0 rounded-md border border-border-hard object-cover" />
                          ) : (
                            <span aria-hidden="true" className="aspect-[3/1] w-36 flex-shrink-0 rounded-md border border-border-soft bg-surface-input" />
                          )}
                          <button type="button" onClick={() => choosePicture('banner')} disabled={pictureBusy !== null} aria-busy={pictureBusy === 'banner'} className="btn-outline btn-sm">
                            {t('settings:developers.portal.bannerChange')}
                          </button>
                          {bot.banner && (
                            <button type="button" onClick={() => void savePicture('banner', null)} disabled={busy} className="btn-quiet btn-sm">
                              {t('settings:developers.portal.bannerRemove')}
                            </button>
                          )}
                        </div>
                        <p className="mt-1.5 text-meta text-txt-tertiary">{t('settings:developers.portal.bannerHint')}</p>
                      </div>
                      <div>
                        <label htmlFor={`${ids}-name`} className="field-label">{t('settings:developers.nameLabel')}</label>
                        <input
                          id={`${ids}-name`}
                          type="text"
                          value={name}
                          maxLength={BOT_LIMITS.NAME_MAX_LENGTH}
                          onChange={(change) => setName(change.target.value)}
                          className="input-standard w-full"
                        />
                      </div>
                      <div>
                        <label htmlFor={`${ids}-username`} className="field-label">{t('settings:developers.portal.usernameLabel')}</label>
                        <div className="relative">
                          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-ui text-txt-tertiary">{'@'}</span>
                          <input
                            id={`${ids}-username`}
                            type="text"
                            value={username}
                            maxLength={USERNAME_LIMITS.MAX_LENGTH}
                            autoComplete="off"
                            spellCheck={false}
                            aria-invalid={!usernameFits}
                            aria-describedby={`${ids}-username-hint`}
                            onChange={(change) => setUsername(change.target.value)}
                            className="input-standard w-full pl-7 font-mono"
                          />
                        </div>
                        <p id={`${ids}-username-hint`} className={`mt-1.5 text-meta leading-relaxed ${usernameFits ? 'text-txt-tertiary' : 'text-txt-danger'}`}>
                          {t('settings:developers.portal.usernameHint', { min: USERNAME_LIMITS.MIN_LENGTH, max: USERNAME_LIMITS.MAX_LENGTH, days: USERNAME_LIMITS.CHANGE_EVERY_DAYS })}
                        </p>
                      </div>
                      <div>
                        <label htmlFor={`${ids}-description`} className="field-label">{t('settings:developers.portal.descriptionLabel')}</label>
                        <textarea
                          id={`${ids}-description`}
                          rows={4}
                          value={description}
                          maxLength={BOT_LIMITS.DESCRIPTION_MAX_LENGTH}
                          onChange={(change) => setDescription(change.target.value)}
                          className="input-standard w-full resize-none"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-border-hard px-5 py-3">
                      <button type="button" onClick={() => void saveProfile()} disabled={busy || !changed || !name.trim() || !usernameFits} aria-busy={busy} className="btn-primary">
                        {t('common:actions.save')}
                      </button>
                    </div>
                  </Card>

                  <Card
                    tone="danger"
                    title={t('settings:developers.remove')}
                    description={t('settings:developers.removeBody', { name: bot.name })}
                    action={<button type="button" onClick={() => setAsking('remove')} className="btn-danger">{t('settings:developers.remove')}</button>}
                  />
                </>
              )}

              {tab === 'token' && (
                <>
                  {token && (
                    <Card tone="notice" title={t('settings:developers.tokenTitle', { name: bot.name })} description={t('settings:developers.tokenDescription')}>
                      <div className="px-5 pb-5">
                        <CopyField label={t('settings:developers.tokenLabel')} value={token} secret />
                      </div>
                    </Card>
                  )}
                  <Card
                    title={t('settings:developers.tokenLabel')}
                    description={t('settings:developers.portal.tokenHint')}
                    action={<button type="button" onClick={() => setAsking('rotate')} className="btn-outline">{t('settings:developers.rotate')}</button>}
                  />
                </>
              )}

              {tab === 'invite' && <InvitePanel botId={bot.id} />}

              {tab === 'commands' && (
                <Card title={t('settings:developers.portal.commands')} description={t('settings:developers.portal.commandsHint')}>
                  {bot.commands.length === 0 ? (
                    <Empty glyph="/">{t('settings:developers.portal.noCommands')}</Empty>
                  ) : (
                    <ul className="divide-y divide-border-hard border-t border-border-hard">
                      {bot.commands.map((command) => (
                        <li key={command.name} className="px-5 py-3.5">
                          <p className="font-mono text-ui font-semibold text-txt-primary">/{command.name}</p>
                          <p className="mt-0.5 text-meta text-txt-tertiary">{command.description}</p>
                          {command.options && command.options.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {command.options.map((option) => (
                                <span key={option.name} className="kbd">{`${option.name}${option.required ? '' : '?'}: ${option.type}`}</span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {tab === 'spaces' && (
                <Card title={t('settings:developers.portal.spaces')}>
                  {bot.spaces.length === 0 ? (
                    <Empty glyph="#">{t('settings:developers.portal.noSpaces')}</Empty>
                  ) : (
                    <ul className="flex flex-col gap-0.5 border-t border-border-hard p-2">
                      {bot.spaces.map((space) => (
                        <li key={space.id}>
                          <Link to={`/channels/${space.id}`} className="list-row justify-between text-ui text-txt-primary hover:bg-interactive-hover">
                            <span className="min-w-0 truncate">{space.name}</span>
                            <Icon name="chevron-right" size={16} className="flex-shrink-0 text-txt-tertiary" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <input ref={pictureInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickPicture} />
      <ImageCropModal
        isOpen={cropping !== null}
        onClose={closeCrop}
        imageSrc={cropping?.source ?? ''}
        onCropComplete={(blob) => void cropped(blob)}
        title={cropping?.kind === 'banner' ? t('settings:developers.portal.bannerCropTitle') : t('settings:developers.portal.cropTitle')}
        cropShape={CROPS[cropping?.kind ?? 'avatar'].shape}
        aspectRatio={CROPS[cropping?.kind ?? 'avatar'].aspect}
        maxOutputDimension={CROPS[cropping?.kind ?? 'avatar'].size}
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
    </Shell>
  );
}

/**
 * The developer portal (docs/systems/bots.md): making a bot, its token, its picture, the address
 * that brings it into a space, what it answers to and where it is. The server decides all of it
 * again; someone else's bot looks the same as none at all.
 */
export function BotPortalPage() {
  const { botId } = useParams<{ botId: string }>();
  return botId ? <BotPage key={botId} botId={botId} /> : <BotList />;
}
