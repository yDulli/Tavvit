import { Fragment, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { SlidingMark } from '../ui/SlidingMark';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Avatar } from '../ui/Avatar';
import { CountBadge } from '../ui/CountBadge';
import { Toggle } from '../ui/Toggle';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import {
  OverviewPanel, YourSpacePanel, InvitesPanel, MembersPanel, RolesPanel, BansPanel, ModerationPanel, AuditLogPanel, VerificationPanel,
  EmojiStickersPanel, DiscordMovePanel, SoundsPanel, WelcomePanel, SettingsPanelSuspense,
} from './lazySettingsPanels';
import { allowedSpaceSettingsTabs, isSpaceSettingsTab, SPACE_SETTINGS_NAV, type SpaceSettingsGroup, type SpaceSettingsTab } from './spaceSettingsPanels/spaceSettingsTabs';
import { DiscoveryListingSection } from './spaceSettingsPanels/DiscoveryListingSection';
import { useIsSpaceOwner } from '../../hooks/useIsSpaceOwner';
import { useVisibilityOptions } from './spaceSettingsPanels/spaceOptions';
import { ListInDirectoryConfirm } from './DirectoryConfirmations';
import type { SpaceVisibility, JoinRequest, InstanceStreamingLimits } from '@backspace/shared';

const DESCRIPTION_MAX_LENGTH = 200;

/** The three instance facts the Discovery panel gates its switches on. */
interface InstanceDiscoveryFlags {
  discoveryEnabled: boolean;
  /** The admin's listing opt-in. */
  directoryEnabled: boolean;
  /** The instance has a `DIRECTORY_ENDPOINT`, so a listing can reach a hub. */
  directoryConfigured: boolean;
}

/** The three fields of a streaming-settings document this panel reads. */
function flagsOf(limits: InstanceStreamingLimits): InstanceDiscoveryFlags {
  return {
    discoveryEnabled: limits.discoveryEnabled,
    directoryEnabled: limits.directoryEnabled,
    directoryConfigured: limits.directoryConfigured,
  };
}

/** What the Discovery panel knows about the instance its space lives on. */
interface InstanceDiscoveryFlagsState {
  /** The flags, or null while they are not known. */
  flags: InstanceDiscoveryFlags | null;
  /** A load this hook ran finished and left nothing to show. */
  failed: boolean;
  /** A load is running, so Retry is inert rather than re-entrant. */
  loading: boolean;
  /** Ask again. The only way back when the document did not arrive. */
  retry: () => void;
}

/**
 * The discovery and directory flags of the instance a space lives on, the
 * state of the load that fetches them, and the way to ask again.
 *
 * Home (`''`) reads the store's `streamingLimits`, the settings document any
 * signed-in user may fetch. That field is null until the document arrives and
 * stays null when the request fails, and null is not a fact: defaulting it
 * (`?? true` / `?? false`) told an owner their space was not listed, and
 * locked the switch that says so, on the strength of a document nobody had
 * read. `InstanceDiscoveryHint` states nothing from a null document for the
 * same reason; this panel offers a write off these flags, so it has more at
 * stake, not less.
 *
 * **It fetches the document itself when it is missing.** One WS `ready`
 * handler fills that field for the whole session, and nothing else does for a
 * member (the Streaming panel is an admin surface). A `ready` whose fetch
 * failed therefore left this panel with an unexplained disabled switch for
 * the rest of the session, which is unknown saying nothing at all rather than
 * saying it is unknown. The load runs only when the field is empty, since the
 * panel reads the document and does not write it, and `failed` plus `retry`
 * carry the rest, the same treatment the Streaming panel gives its own load.
 *
 * A remote space asks its own instance through its own client on mount,
 * because home's flags say nothing about it: null while that answer is
 * pending, so the caller can keep its switches disabled rather than show
 * home's values. A failed fetch falls back to the store's values and lets the
 * save's own error speak, which is null as well on an instance whose own
 * document never arrived, and that pair is what `failed` reports.
 */
function useInstanceDiscoveryFlags(origin: string): InstanceDiscoveryFlagsState {
  const homeLimits = useSettingsStore((s) => s.streamingLimits);
  const fetchStreamingLimits = useSettingsStore((s) => s.fetchStreamingLimits);
  const home: InstanceDiscoveryFlags | null = homeLimits === null ? null : flagsOf(homeLimits);
  const [remote, setRemote] = useState<{ origin: string; flags: InstanceDiscoveryFlags | 'failed' } | null>(null);
  const [homeFailed, setHomeFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * The load whose answer this panel is still waiting for.
   *
   * The panel is not remounted when the space changes: `DiscoveryPanel` takes
   * `spaceId` from `spaceStore.currentSpaceId`, and the modal resets on
   * `isOpen` alone, so browser back or forward, or any other
   * `setCurrentSpace` while it is open, swaps one space's origin for
   * another's under a request that is already in flight. A late answer
   * writing anyway put the previous origin's flags in `remote`, which reads
   * as "this origin has not answered" against the new one: a disabled switch
   * with no reason line, no Retry, and no further load to correct it, since
   * the new origin's own load had already finished. Each loader takes a
   * number and writes nothing once another has started.
   */
  const runId = useRef(0);

  // `fetchStreamingLimits` swallows its own error, so the outcome is read
  // from the store: the document either arrived or it did not.
  const loadHome = useCallback(async () => {
    const id = ++runId.current;
    setLoading(true);
    await fetchStreamingLimits();
    if (runId.current !== id) return;
    setHomeFailed(useSettingsStore.getState().streamingLimits === null);
    setLoading(false);
  }, [fetchStreamingLimits]);

  const loadRemote = useCallback(async (target: string) => {
    const id = ++runId.current;
    setLoading(true);
    try {
      const limits = await getApiForOrigin(target).settings.getStreaming();
      if (runId.current !== id) return;
      setRemote({ origin: target, flags: flagsOf(limits) });
    } catch {
      if (runId.current !== id) return;
      setRemote({ origin: target, flags: 'failed' });
    } finally {
      // `loading` belongs to the newest load, so a superseded one leaves it
      // alone: clearing it here would say the panel had settled while the
      // load it is actually waiting for is still running.
      if (runId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (origin) {
      void loadRemote(origin);
      return;
    }
    // Read through `getState` rather than from the render's `homeLimits`, so
    // the document arriving does not run this again.
    if (useSettingsStore.getState().streamingLimits === null) void loadHome();
  }, [origin, loadRemote, loadHome]);

  const retry = useCallback(() => {
    if (origin) void loadRemote(origin);
    else void loadHome();
  }, [origin, loadRemote, loadHome]);

  const remoteAnswered = remote !== null && remote.origin === origin;
  const flags = !origin
    ? home
    : !remoteAnswered
      ? null
      : remote.flags === 'failed' ? home : remote.flags;

  // Only a load that finished with nothing to show: a remote whose fetch
  // failed while home holds a document is not a failure this panel reports,
  // it is the fallback doing its job.
  const failed = flags === null && (origin ? remoteAnswered && remote.flags === 'failed' : homeFailed);

  return { flags, failed, loading, retry };
}

/**
 * The listing, the directory switch and the description of one space. The save
 * goes through the store's `updateSpace`, which resolves the client for the
 * space's own instance and merges the answer back; a remote space must never
 * be saved through the home client. The instance flags come from the instance
 * the space lives on (`useInstanceDiscoveryFlags`): the store for a home
 * space, that instance's own `GET /settings/streaming` for a remote one.
 */
export function DiscoveryPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const spaces = useSpaceStore((s) => s.spaces);
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const isHomeAdmin = useSettingsStore((s) => s.isAdmin);
  const updateInstanceSettings = useSettingsStore((s) => s.updateInstanceSettings);
  const isOwner = useIsSpaceOwner(spaceId);

  const space = spaces.find(s => s.id === spaceId);
  const { flags, failed: flagsFailed, loading: flagsLoading, retry: retryFlags } =
    useInstanceDiscoveryFlags(space?._instanceOrigin ?? '');
  // Until the instance the space lives on has answered, neither flag is
  // known: the notice stays hidden and the directory switch stays disabled,
  // because a reason would be a guess about that instance. Unknown while a
  // load is still running says nothing; unknown because the load came back
  // empty says so, under the switch, with the way to ask again.
  const flagsUnknown = flags === null;
  // All three are read only on branches `flagsUnknown` already guards; the
  // fallbacks are what the type needs, never a claim about the instance.
  const discoveryEnabled = flags?.discoveryEnabled ?? false;
  const directoryEnabled = flags?.directoryEnabled ?? false;
  const directoryConfigured = flags?.directoryConfigured ?? false;

  const visibility = (space?.visibility as SpaceVisibility) ?? 'private';
  const [directoryListed, setDirectoryListed] = useState(space?.directoryListed ?? false);
  const [description, setDescription] = useState(space?.description ?? '');
  const addToast = useUIStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // The instance-wide write offered under the reason below, and its own
  // failure. Separate from `saving`, which belongs to this space's save bar:
  // the two are different writes to different documents, and a refused rung
  // must not read as a refused space save.
  const [rungPending, setRungPending] = useState(false);
  const [rungError, setRungError] = useState('');
  const [confirmingRung, setConfirmingRung] = useState(false);

  useEffect(() => {
    if (space) {
      setDirectoryListed(space.directoryListed);
      setDescription(space.description ?? '');
    }
  }, [space]);

  if (!space) return null;

  const hasChanges =
    directoryListed !== space.directoryListed ||
    description !== (space.description ?? '');

  /**
   * Whether the person reading the "an administrator has to turn this on"
   * reason is that administrator, and may act on it from here.
   *
   * Admin rights are per instance. `settingsStore.isAdmin` is written from
   * the home instance's WS `ready` and from nowhere else: the handler reads
   * `event.user.isAdmin` only when the event came from home, and a remote
   * `ready` carrying it is discarded. There is no second signal either.
   * Nothing in `instanceStore` records a role per connection, and the one
   * route that would prove rights on another instance
   * (`GET /api/settings/instance`, admin-only) would have to be fired at that
   * instance on every panel open just to read its refusal, which is a request
   * nobody asked for and an answer that is 403 for the ordinary case.
   *
   * So the action is offered only where the client actually knows the answer:
   * a space whose home is this instance (`_instanceOrigin` empty, the same
   * value `useInstanceDiscoveryFlags` reads home by) and an admin here. For a
   * remote space the sentence stays exactly as it was, whatever this user is
   * at home, because being an admin here says nothing about rights there, and
   * because the write itself goes through `settingsStore`, which speaks to
   * home and to nowhere else. An admin of the remote instance changes it
   * there, on the Explore page of their own instance or in its settings.
   */
  const spaceIsHome = (space._instanceOrigin ?? '') === '';
  const canEnableRung = isHomeAdmin && spaceIsHome;

  // The reason under a disabled switch tells the person who can act what to
  // do. Two of the reasons are facts about how the instance is run, and those
  // are for its administrator only (see `showOuterSpace`): the endpoint, which
  // is asked before the opt-in because it is the deeper fact and the one the
  // administrator cannot change by flipping the setting the other reason
  // points at (on an instance with no `DIRECTORY_ENDPOINT` the document is
  // still served from the two discovery flags, but no hub fetches it), and the
  // opt-in itself, which names the setting. The third, a private space, is
  // about the space and is for its owner.
  const directoryReason = flagsUnknown
    ? null
    : !directoryConfigured
      ? t('spaces:settings.discovery.directory.notConfigured')
      : !directoryEnabled
        ? t('spaces:settings.discovery.directory.adminOffSelf')
        : visibility === 'private'
          ? t('spaces:settings.discovery.directory.privateSpace')
          : null;
  const directoryLocked = flagsUnknown || directoryReason !== null;
  // The Outer Space block is an instance feature. Where the instance has not
  // switched it on (no hub, or the opt-in is off) an owner who is not the
  // administrator can do nothing with it, and a locked switch under a reason
  // about how the instance is run is exactly the notice members are not
  // shown, so the block is not drawn for them at all. The administrator of
  // the instance the space lives on keeps it with its reason and its action.
  // So does an owner while the answer is still loading or failed, because the
  // retry line lives in the block. The two reasons above are only reachable
  // when this is true because of `canEnableRung`.
  const showOuterSpace = canEnableRung || flagsUnknown || (directoryConfigured && directoryEnabled);
  // The reason that has a way out of it, which is the opt-in one and only for
  // an admin of the instance the space lives on. Derived, so it cannot be
  // offered under a reason that has moved on.
  const rungActionOffered = canEnableRung && !flagsUnknown && directoryConfigured && !directoryEnabled;

  /**
   * Turn on the global rung for this instance, which is what the reason above
   * names.
   *
   * Both flags, not just the listing one: `directoryEnabled` without
   * `discoveryEnabled` is the pair the server refuses
   * (`directory_requires_discovery`), and the rung the ladder in
   * Instance -> General calls global is exactly this pair. Writing one of them
   * from here would fail on an instance that is invite-only and would leave a
   * half-rung on one that is not.
   *
   * It goes through `settingsStore.updateInstanceSettings`, which speaks to
   * home. That is correct precisely because `canEnableRung` requires the
   * space to live here; the gate and the write agree about which instance
   * this is. The store mirrors the server's answer back into
   * `streamingLimits`, which for a home space is the document
   * `useInstanceDiscoveryFlags` reads, so the reason clears and the switch
   * unlocks on the next render with nothing to refetch.
   */
  const handleEnableRung = async () => {
    setRungPending(true);
    setRungError('');
    try {
      await updateInstanceSettings({ discoveryEnabled: true, directoryEnabled: true });
    } catch (err) {
      setRungError(describeError(err));
    } finally {
      setRungPending(false);
      setConfirmingRung(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await updateSpace(spaceId, { description: description.trim(), directoryListed });
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDirectoryListed(space.directoryListed);
    setDescription(space.description ?? '');
    setSaveError('');
  };

  return (
    <div className="space-y-5">
      <h2 className="page-title">{t('spaces:settings.discovery.title')}</h2>
      {/* Everyone who sees this tab learns that an approved listing is not
          shown while the instance has space discovery off. */}
      {!flagsUnknown && !discoveryEnabled && (
        <div className="rounded-md border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-ui text-accent-amber">
          {t('spaces:settings.discovery.disabledNotice')}
        </div>
      )}

      {/* Listing takes an admin's approval (admin.md, "Discovery approval");
          visibility below only says how people join. Keyed by space, so
          another space's request never shows under this one. */}
      <DiscoveryListingSection key={space.id} space={space} isOwner={isOwner} />

      {showOuterSpace && (
      <div>
        <div className="label-mono mb-1.5">{t('spaces:explore.outer.title')}</div>
        <div className="surface-card rounded-lg p-4 space-y-2.5">
          <label className={`flex items-center justify-between gap-4 ${directoryLocked ? 'cursor-default' : 'cursor-pointer'}`}>
            <div className="min-w-0">
              <div className="text-ui font-medium text-txt-primary">{t('spaces:settings.discovery.directory.label')}</div>
              <div className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.discovery.directory.hint')}</div>
            </div>
            <Toggle
              enabled={directoryListed}
              onChange={setDirectoryListed}
              disabled={directoryLocked}
              ariaLabel={t('spaces:settings.discovery.directory.label')}
            />
          </label>
          {directoryReason !== null && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <p className="text-meta leading-snug text-txt-secondary">{directoryReason}</p>
              {rungActionOffered && (
                <button
                  type="button"
                  onClick={() => setConfirmingRung(true)}
                  disabled={rungPending}
                  aria-busy={rungPending}
                  className="btn-outline btn-sm"
                >
                  {t('spaces:settings.discovery.directory.adminOffSelfAction')}
                </button>
              )}
            </div>
          )}
          {rungError && <p className="text-meta text-txt-danger">{rungError}</p>}
          {rungActionOffered && (
            <ListInDirectoryConfirm
              isOpen={confirmingRung}
              onClose={() => setConfirmingRung(false)}
              onConfirm={handleEnableRung}
              loading={rungPending}
              intro={t('spaces:settings.discovery.directory.adminOffSelfIntro')}
            />
          )}
          {flagsFailed && (
            // The switch is locked on a document that never arrived, so this
            // is the one line that says why and the only way back: the same
            // treatment the Streaming panel gives its own failed load, at the
            // scale of a reason under a switch.
            <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-meta text-txt-danger">
              <span>{t('common:states.loadSettingsFailed')}</span>
              <button
                type="button"
                onClick={retryFlags}
                disabled={flagsLoading}
                className="font-medium underline underline-offset-2 hover:no-underline transition-all disabled:no-underline disabled:opacity-60 disabled:cursor-default"
              >
                {t('common:actions.retry')}
              </button>
            </div>
          )}
          <p className="text-meta leading-snug text-txt-tertiary">{t('spaces:settings.discovery.directory.disclosure')}</p>
        </div>
      </div>
      )}

      <div>
        <div className="label-mono mb-1.5">{t('spaces:settings.discovery.description.label')}</div>
        <p className="mb-2 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.discovery.description.hint')}</p>
        <div className="surface-card rounded-lg p-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
            placeholder={t('spaces:settings.discovery.description.placeholder')}
            rows={3}
            className="input-standard w-full resize-none"
          />
          <div className="tabular mt-1 text-right font-mono text-label text-txt-tertiary">
            {t('spaces:settings.discovery.description.counter', { length: description.length, max: DESCRIPTION_MAX_LENGTH })}
          </div>
        </div>
      </div>

      {saveError && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{saveError}</div>
      )}
      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="action-bar animate-slide-up pointer-events-auto">
              <button
                onClick={handleReset}
                className="btn-quiet"
              >
                {t('common:actions.reset')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                aria-busy={saving}
                className="btn-primary"
              >
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Who gets in: the space's visibility, and the people asking when it takes
 * requests. The save goes through the store's `updateSpace`, like the Discovery
 * panel's. The server clears a directory listing when a space goes private.
 */
export function AccessPanel({ spaceId, onRequestCountChange }: { spaceId: string; onRequestCountChange?: (count: number) => void }) {
  const { t } = useTranslation(['spaces', 'common']);
  const visibilityOptions = useVisibilityOptions();
  const space = useSpaceStore((s) => s.spaces.find((entry) => entry.id === spaceId));
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const addToast = useUIStore((s) => s.addToast);
  const saved = (space?.visibility as SpaceVisibility) ?? 'private';
  const [visibility, chooseVisibility] = useState<SpaceVisibility>(saved);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    chooseVisibility(saved);
  }, [saved]);

  if (!space) return null;

  const hasChanges = visibility !== saved;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await updateSpace(spaceId, { visibility });
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    chooseVisibility(saved);
    setSaveError('');
  };

  return (
    <div className="space-y-5">
      <h2 className="page-title">{t('spaces:settings.nav.tabs.access')}</h2>

      <div>
        <div className="label-mono mb-1.5">{t('spaces:settings.discovery.visibility.label')}</div>
        <p className="mb-2 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.discovery.visibility.hint')}</p>
        <div className="surface-card rounded-lg p-1.5">
          <div className="space-y-0.5">
            {visibilityOptions.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-md p-2.5 cursor-pointer transition-colors duration-100 ${
                  visibility === opt.value
                    ? 'bg-interactive-selected'
                    : 'hover:bg-interactive-hover'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={opt.value}
                  checked={visibility === opt.value}
                  onChange={() => chooseVisibility(opt.value)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-ui font-medium text-txt-primary">{opt.label}</div>
                  <div className="mt-0.5 text-meta leading-snug text-txt-tertiary">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {saveError && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{saveError}</div>
      )}
      {(visibility === 'request' || saved === 'request') && (
        <JoinRequestsSection spaceId={spaceId} origin={space._instanceOrigin ?? ''} onCountChange={onRequestCountChange} />
      )}

      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="action-bar animate-slide-up pointer-events-auto">
              <button
                onClick={handleReset}
                className="btn-quiet"
              >
                {t('common:actions.reset')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                aria-busy={saving}
                className="btn-primary"
              >
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The pending join requests of a request space. They are stored by the
 * instance that hosts the space, so they are read from and decided on there
 * (`origin`), never through the home client for a remote space.
 */
function JoinRequestsSection({ spaceId, origin, onCountChange }: { spaceId: string; origin: string; onCountChange?: (count: number) => void }) {
  const { t } = useTranslation(['spaces', 'common']);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const f = useFormatters();
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const read = async () => {
      try {
        const { requests: reqs } = await getApiForOrigin(origin).explore.getJoinRequests(spaceId, 'pending');
        if (!cancelled) {
          setRequests(reqs);
          onCountChange?.(reqs.length);
        }
      } catch {
        // Nothing to list: the section stays empty, as it did for a refusal.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void read();
    return () => { cancelled = true; };
  }, [spaceId, origin, onCountChange]);

  const handleDecide = async (requestId: string, action: 'accept' | 'decline') => {
    setActionError('');
    try {
      await getApiForOrigin(origin).explore.decideJoinRequest(spaceId, requestId, action);
      const left = requests.filter(r => r.id !== requestId);
      setRequests(left);
      onCountChange?.(left.length);
    } catch (err) {
      setActionError(describeError(err));
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label-mono">{t('spaces:settings.discovery.requests.title')}</span>
        {requests.length > 0 && <CountBadge count={requests.length} />}
      </div>

      {actionError && (
        <div className="mb-2 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-meta text-txt-danger">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="text-ui text-txt-tertiary">{t('common:states.loading')}</div>
      ) : requests.length === 0 ? (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <p className="empty-state-body">{t('spaces:settings.discovery.requests.empty')}</p>
          </div>
        </div>
      ) : (
        <div className="surface-card max-h-[260px] divide-y divide-border-hard overflow-y-auto scrollbar-thin rounded-lg">
          {requests.map((req) => {
            const user = req.user;
            const displayName = user?.displayName ?? user?.username ?? t('common:states.unknown');

            return (
              <div key={req.id} className="flex items-start gap-3 px-3 py-2.5">
                <Avatar
                  src={user?.avatar}
                  name={displayName}
                  size={32}
                  userId={user?.homeUserId ?? user?.id}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-ui font-medium text-txt-primary truncate">{displayName}</span>
                    {user?.username && (
                      <span className="text-meta text-txt-tertiary">@{user.username}</span>
                    )}
                  </div>
                  {req.message && (
                    <p className="text-meta text-txt-secondary mt-0.5 line-clamp-2">{req.message}</p>
                  )}
                  <span className="tabular font-mono text-label text-txt-tertiary">
                    {f.formatNumericDate(req.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDecide(req.id, 'accept')}
                    className="icon-btn text-txt-positive hover:bg-status-online/15 hover:text-txt-positive"
                    aria-label={t('common:actions.accept')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecide(req.id, 'decline')}
                    className="icon-btn hover:bg-accent-rose/10 hover:text-txt-danger"
                    aria-label={t('common:actions.decline')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SpaceSettingsModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const isMobile = useUIStore((s) => s.isMobile);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const spaces = useSpaceStore((s) => s.spaces);
  const spacePermissions = useSpaceStore((s) => s.spacePermissions);

  const [tab, setTab] = useState<SpaceSettingsTab>('you');
  const [mobileView, setMobileView] = useState<'tabs' | 'content'>('tabs');
  const [pendingRequests, setPendingRequests] = useState(0);

  const isOpen = activeModal === 'spaceSettings';
  const space = spaces.find(s => s.id === currentSpaceId);
  const mySpacePerms = currentSpaceId ? spacePermissions.get(currentSpaceId) : undefined;
  const canManageSpace = hasPermissionBit(mySpacePerms, PermissionBits.MANAGE_SPACE);
  // Verification is asked for by the owner alone (admin.md, "Verification").
  const isOwner = useIsSpaceOwner(currentSpaceId ?? '');

  // Which tabs this viewer may open: the permission each panel's routes
  // check on the instance that hosts the space.
  const allowed = allowedSpaceSettingsTabs(mySpacePerms, isOwner);

  // Reset tab and mobile view when modal opens. A caller may name the tab
  // to open on (`openModal('spaceSettings', { tab: 'discovery' })`); a tab
  // this user cannot see falls back to the first one they can use, and on
  // mobile a named tab opens straight on its content, as user settings does.
  const requestedTab = isOpen ? modalData.tab : undefined;
  useEffect(() => {
    if (!isOpen) return;
    const deepLinked = isSpaceSettingsTab(requestedTab) && allowed[requestedTab];
    setTab(deepLinked ? requestedTab : canManageSpace ? 'overview' : 'you');
    setMobileView(deepLinked ? 'content' : 'tabs');
    // Only the opening decides the tab: a permission that changes while the
    // modal is open must not throw the user back to where they came in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, requestedTab]);

  // The count beside Access, without opening it. Only a space that takes
  // requests has any, and it is read from the instance that hosts the space.
  const requestOrigin = space?._instanceOrigin ?? '';
  const takesRequests = isOpen && canManageSpace && space?.visibility === 'request';
  useEffect(() => {
    setPendingRequests(0);
    if (!takesRequests || !currentSpaceId) return undefined;
    let live = true;
    getApiForOrigin(requestOrigin).explore.getJoinRequests(currentSpaceId, 'pending')
      .then(({ requests }) => { if (live) setPendingRequests(requests.length); })
      .catch(() => { /* The panel says so itself when it is opened. */ });
    return () => { live = false; };
  }, [takesRequests, currentSpaceId, requestOrigin]);

  if (!space || !currentSpaceId) return null;

  const tabLabels: Record<SpaceSettingsTab, string> = {
    you: t('spaces:settings.nav.tabs.you'),
    overview: t('spaces:settings.nav.tabs.overview'),
    access: t('spaces:settings.nav.tabs.access'),
    invites: t('spaces:settings.nav.tabs.invites'),
    discovery: t('spaces:settings.nav.tabs.discovery'),
    verification: t('spaces:settings.nav.tabs.verification'),
    moderation: t('spaces:settings.nav.tabs.moderation'),
    welcome: t('spaces:settings.nav.tabs.welcome'),
    sounds: t('spaces:settings.nav.tabs.sounds'),
    emoji: t('spaces:settings.nav.tabs.emoji'),
    discord: t('spaces:settings.nav.tabs.discord'),
    members: t('common:labels.members'),
    roles: t('spaces:settings.nav.tabs.roles'),
    bans: t('spaces:settings.nav.tabs.bans'),
    audit: t('spaces:settings.nav.tabs.audit'),
  };
  const groupLabels: Record<SpaceSettingsGroup, string> = {
    general: t('spaces:settings.nav.general'),
    management: t('spaces:settings.nav.management'),
  };

  const handleTabClick = (target: SpaceSettingsTab) => {
    setTab(target);
    if (isMobile) setMobileView('content');
  };

  // One `.nav-item` per tab under a mono label per section; the open one is a
  // step lighter with the violet edge. On the phone the rows are taller, for
  // a thumb.
  const renderNav = (layout: 'desktop' | 'mobile'): ReactNode =>
    SPACE_SETTINGS_NAV.map(({ group, tabs }, index) => {
      const visible = tabs.filter((entry) => allowed[entry]);
      if (visible.length === 0) return null;
      return (
        <Fragment key={group}>
          <div className={`label-mono px-2.5 pb-1.5 ${index > 0 ? 'pt-5' : 'pt-1'}`}>{groupLabels[group]}</div>
          {visible.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => handleTabClick(entry)}
              className={`nav-item w-full ${layout === 'mobile' ? 'h-11' : ''}`}
              data-active={tab === entry}
              aria-current={tab === entry ? 'page' : undefined}
            >
              <span className="min-w-0 flex-1 truncate">{tabLabels[entry]}</span>
              {entry === 'access' && pendingRequests > 0 && <CountBadge count={pendingRequests} />}
              {layout === 'mobile' && <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />}
            </button>
          ))}
        </Fragment>
      );
    });

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="settings" mobileStyle="fullscreen">
      <div className="flex h-full">
        {/* Desktop navigation: a flat column on the sidebar colour, parted from
            the page by a hairline, like the app's own sidebars. */}
        <div className="hidden desktop:flex w-60 flex-shrink-0 flex-col border-r border-border-hard bg-surface-channel">
          {/* The space these settings belong to */}
          <div className="panel-bar flex items-center gap-2.5 px-4">
            <Avatar
              src={space.icon}
              name={space.name}
              size={28}
              userId={space.id}
              avatarColor={space.avatarColor}
              palette="space"
            />
            <div className="min-w-0">
              <div className="truncate text-ui font-medium leading-tight text-txt-primary">{space.name}</div>
              <div className="truncate font-mono text-label leading-tight text-txt-tertiary">{t('spaces:settings.title')}</div>
            </div>
          </div>

          <nav aria-label={t('spaces:settings.title')} className="sliding-list flex flex-1 flex-col overflow-y-auto scrollbar-thin px-2 py-3">
            <SlidingMark variant="row" />
            {renderNav('desktop')}
          </nav>
        </div>

        {/* Mobile: Tab list */}
        {isMobile && mobileView === 'tabs' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="rounded-lg border border-border-hard bg-surface-channel p-3 flex items-center gap-3">
              <Avatar
                src={space.icon}
                name={space.name}
                size={36}
                userId={space.id}
                avatarColor={space.avatarColor}
                palette="space"
              />
              <div className="min-w-0">
                <div className="truncate text-body font-medium text-txt-primary">{space.name}</div>
                <div className="truncate font-mono text-meta text-txt-tertiary">{t('spaces:settings.title')}</div>
              </div>
            </div>

            <nav aria-label={t('spaces:settings.title')} className="rounded-lg border border-border-hard bg-surface-channel p-2">
              {renderNav('mobile')}
            </nav>
          </div>
        )}

        {/* Content area (desktop always, mobile only when viewing content) */}
        {(!isMobile || mobileView === 'content') && (
          <div className="panel-light flex-1 min-w-0 overflow-y-auto scrollbar-thin bg-surface-chat py-6">
            <div className="px-6 max-w-[640px] mx-auto">
              {/* Mobile back button */}
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMobileView('tabs')}
                  className="btn-quiet -ml-2 mb-4 px-2"
                  aria-label={t('spaces:settings.backAria')}
                >
                  <Icon name="chevron-left" size={16} />
                  {t('spaces:settings.title')}
                </button>
              )}
              <SettingsPanelSuspense key={tab}>
                {tab === 'you' && <YourSpacePanel spaceId={currentSpaceId} />}
                {tab === 'overview' && canManageSpace && <OverviewPanel spaceId={currentSpaceId} />}
                {tab === 'welcome' && allowed.welcome && <WelcomePanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'emoji' && allowed.emoji && (
                  <EmojiStickersPanel
                    key={currentSpaceId}
                    spaceId={currentSpaceId}
                    onOpenDiscord={allowed.discord ? () => handleTabClick('discord') : undefined}
                  />
                )}
                {tab === 'sounds' && allowed.sounds && <SoundsPanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'discord' && allowed.discord && <DiscordMovePanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'access' && canManageSpace && <AccessPanel key={currentSpaceId} spaceId={currentSpaceId} onRequestCountChange={setPendingRequests} />}
                {tab === 'invites' && canManageSpace && <InvitesPanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'discovery' && canManageSpace && <DiscoveryPanel spaceId={currentSpaceId} />}
                {tab === 'verification' && isOwner && <VerificationPanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {/* Keyed by space: a different space's rules or log never shows in the same form. */}
                {tab === 'moderation' && canManageSpace && <ModerationPanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'members' && allowed.members && <MembersPanel spaceId={currentSpaceId} />}
                {tab === 'roles' && allowed.roles && <RolesPanel spaceId={currentSpaceId} />}
                {tab === 'bans' && allowed.bans && <BansPanel spaceId={currentSpaceId} />}
                {tab === 'audit' && allowed.audit && <AuditLogPanel key={currentSpaceId} spaceId={currentSpaceId} />}
              </SettingsPanelSuspense>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
