import { WebhooksTab } from './WebhooksTab';
import { ForumTagsTab } from './ForumTagsTab';
import { ToggleRow } from './settingsPanels/_shared/SettingsControls';
import { channelTakesWebhooks } from '../../utils/channelKinds';
import { ChannelIcon } from '../ui/ChannelIcon';
import { ChannelIconPicker } from './ChannelIconPicker';
import React, { useState, useEffect, useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { SLOWMODE_SECONDS, isSlowmodeSeconds, type ChannelType, type SlowmodeSeconds } from '@backspace/shared';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore, getApiForOrigin } from '../../stores/spaceStore';
import { PermissionBits, hasPermissionBit, isHiddenFromEveryone } from '../../utils/permissions';
import { InlineNameEditor } from '../ui/InlineNameEditor';
import { PermissionsEditor } from '../ui/PermissionsEditor';
import type { PermissionDef } from '../ui/OverrideEntry';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useEntityOverrides } from '../../hooks/useEntityOverrides';
import { PrivacySetting } from './PrivacySetting';
import { ChannelTopicEditor } from './ChannelTopicEditor';
import { LOCK_ICON } from '../ui/LockNote';
import { CHANNEL_NAME_MAX_LENGTH, normalizeChannelName } from '@backspace/shared/src/constants';

// ─── Permission Definitions for Channel Overrides ──────────────────────────────

const TEXT_CHANNEL_PERMISSIONS: PermissionDef[] = [
  { key: 'VIEW_CHANNEL', bit: PermissionBits.VIEW_CHANNEL },
  { key: 'SEND_MESSAGES', bit: PermissionBits.SEND_MESSAGES },
  { key: 'MANAGE_MESSAGES', bit: PermissionBits.MANAGE_MESSAGES },
  { key: 'ATTACH_FILES', bit: PermissionBits.ATTACH_FILES },
  { key: 'MENTION_EVERYONE', bit: PermissionBits.MENTION_EVERYONE },
  { key: 'PIN_MESSAGES', bit: PermissionBits.PIN_MESSAGES },
  { key: 'CREATE_THREADS', bit: PermissionBits.CREATE_THREADS },
  { key: 'MANAGE_WEBHOOKS', bit: PermissionBits.MANAGE_WEBHOOKS },
  { key: 'READ_MESSAGE_HISTORY', bit: PermissionBits.READ_MESSAGE_HISTORY },
  { key: 'ADD_REACTIONS', bit: PermissionBits.ADD_REACTIONS },
];

const VOICE_CHANNEL_PERMISSIONS: PermissionDef[] = [
  { key: 'VIEW_CHANNEL', bit: PermissionBits.VIEW_CHANNEL },
  { key: 'CONNECT', bit: PermissionBits.CONNECT },
  { key: 'SPEAK', bit: PermissionBits.SPEAK },
  { key: 'STREAM', bit: PermissionBits.STREAM },
  { key: 'USE_SOUNDBOARD', bit: PermissionBits.USE_SOUNDBOARD },
  { key: 'MUTE_MEMBERS', bit: PermissionBits.MUTE_MEMBERS },
  { key: 'DEAFEN_MEMBERS', bit: PermissionBits.DEAFEN_MEMBERS },
  { key: 'MOVE_MEMBERS', bit: PermissionBits.MOVE_MEMBERS },
  { key: 'DISCONNECT_MEMBERS', bit: PermissionBits.DISCONNECT_MEMBERS },
];


// ─── Slow Mode ──────────────────────────────────────────────────────────────────

/**
 * How long members wait between two messages in a text channel. The change is
 * saved as soon as it is picked, like the name and the topic; without
 * MANAGE_CHANNELS the setting is read-only text. Members who may manage
 * messages or the channel are exempt, which the hint says.
 */
function SlowmodeSetting({ seconds, canEdit, onSave }: {
  /** The stored interval; 0 when slow mode is off. */
  seconds: number;
  canEdit: boolean;
  /** Persists the interval. Rejects on failure; the caller shows the error. */
  onSave: (seconds: SlowmodeSeconds) => Promise<void>;
}) {
  const { t } = useTranslation(['spaces']);
  const { formatInterval } = useFormatters();
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  const hintId = useId();

  const label = (value: number): string =>
    value === 0 ? t('spaces:channel.settings.slowmode.off') : formatInterval(value);
  // A value from outside the list (a host with other steps) still shows as itself.
  const values: readonly number[] = (SLOWMODE_SECONDS as readonly number[]).includes(seconds)
    ? SLOWMODE_SECONDS
    : [...SLOWMODE_SECONDS, seconds].sort((a, b) => a - b);

  const choose = async (raw: string) => {
    const next = Number(raw);
    if (!isSlowmodeSeconds(next) || next === seconds) return;
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      // The caller has shown the error; the select keeps the stored value.
    } finally {
      setSaving(false);
    }
  };

  const headingClass = 'field-label';
  if (!canEdit) {
    return (
      <div>
        <span className={headingClass}>{t('spaces:channel.settings.slowmode.label')}</span>
        <p className="text-ui text-txt-secondary">{label(seconds)}</p>
        <p className="mt-1.5 text-meta text-txt-tertiary">{t('spaces:channel.settings.slowmode.hint')}</p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={fieldId} className={headingClass}>
        {t('spaces:channel.settings.slowmode.label')}
      </label>
      <select
        id={fieldId}
        value={String(seconds)}
        disabled={saving}
        aria-describedby={hintId}
        onChange={(e) => void choose(e.target.value)}
        className="input-standard w-full"
      >
        {values.map((value) => (
          <option key={value} value={String(value)}>{label(value)}</option>
        ))}
      </select>
      <p id={hintId} className="mt-1.5 text-meta text-txt-tertiary">{t('spaces:channel.settings.slowmode.hint')}</p>
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────────

function OverviewTab({
  channelId,
  channelName,
  channelType,
  channelTopic,
  slowmodeSeconds,
  isPrivate,
  isFetching,
  isLoading,
  error,
  canManageChannels,
  canManageRoles,
  onTogglePrivate,
  onDeleteChannel,
  onRename,
  onSaveTopic,
  channelIcon,
  iconBusy,
  onSaveIcon,
  onSaveSlowmode,
  onSetAnnouncement,
}: {
  channelId: string;
  channelName: string;
  channelType: ChannelType;
  channelTopic: string | null;
  slowmodeSeconds: number;
  isPrivate: boolean;
  isFetching: boolean;
  isLoading: boolean;
  error: string;
  canManageChannels: boolean;
  canManageRoles: boolean;
  onTogglePrivate: () => void;
  onDeleteChannel: () => void;
  onRename: (name: string) => Promise<void>;
  onSaveTopic: (topic: string | null) => Promise<void>;
  channelIcon: string | null;
  iconBusy: boolean;
  onSaveIcon: (icon: string | null) => Promise<void>;
  onSaveSlowmode: (seconds: SlowmodeSeconds) => Promise<void>;
  onSetAnnouncement: (on: boolean) => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  return (
    <div className="space-y-4">
      <div>
        <label className="field-label">
          {t('spaces:channel.settings.channelLabel')}
        </label>
        <InlineNameEditor
          name={channelName}
          icon={isPrivate ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="opacity-60 flex-shrink-0">
              <path d={LOCK_ICON} />
            </svg>
          ) : (
            <ChannelIcon type={channelType} icon={channelIcon} size={20} muted className="flex-shrink-0" />
          )}
          canEdit={canManageChannels}
          editLabel={t('spaces:channel.settings.rename')}
          fieldLabel={t('spaces:channel.settings.nameLabel')}
          maxLength={CHANNEL_NAME_MAX_LENGTH}
          normalize={normalizeChannelName}
          onSave={onRename}
        />
      </div>

      {/* Its own icon in place of its type's, for who may manage it. Others see it in the row above. */}
      {canManageChannels && channelType !== 'thread' && (
        <div>
          <span className="field-label">{t('spaces:channel.settings.icon.label')}</span>
          <ChannelIconPicker value={channelIcon} type={channelType} busy={iconBusy} onChange={(icon) => void onSaveIcon(icon)} />
          <p className="mt-1.5 text-meta text-txt-tertiary">{t('spaces:channel.settings.icon.hint')}</p>
        </div>
      )}

      {/* A voice channel shows no topic (it is in the channel header of the others), so
          it does not offer to edit one, the same as the create dialog. */}
      {channelType !== 'voice' && (
        <ChannelTopicEditor key={`topic-${channelId}`} topic={channelTopic} canEdit={canManageChannels} onSave={onSaveTopic} />
      )}

      {/* A text channel and an announcement channel hold the same things, so one can become the other. */}
      {canManageChannels && (channelType === 'text' || channelType === 'announcement') && (
        <ToggleRow
          label={t('spaces:channel.settings.announcement.label')}
          description={t('spaces:channel.settings.announcement.hint')}
          enabled={channelType === 'announcement'}
          onChange={onSetAnnouncement}
        />
      )}

      {/* Slow mode limits how often members post, so a voice channel has none. */}
      {channelType !== 'voice' && (
        <SlowmodeSetting key={`slowmode-${channelId}`} seconds={slowmodeSeconds} canEdit={canManageChannels} onSave={onSaveSlowmode} />
      )}

      {error && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
          {error}
        </div>
      )}

      {/* Privacy is an @everyone override: reading and writing it both need
          MANAGE_ROLES, so without it the row would only show a guess. */}
      {canManageRoles && (
        <PrivacySetting
          label={t('spaces:channel.settings.private.label')}
          description={t('spaces:channel.settings.private.description')}
          note={t('spaces:channel.settings.private.note')}
          isPrivate={isPrivate}
          busy={isLoading || isFetching}
          onToggle={onTogglePrivate}
        />
      )}

      {canManageChannels && (
        <div className="border-t border-border-hard pt-4">
          <div className="label-mono mb-2 text-txt-danger">{t('common:labels.dangerZone')}</div>
          <button
            type="button"
            onClick={onDeleteChannel}
            className="btn-danger btn-sm"
          >
            {t('spaces:channel.settings.deleteButton')}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────────────────────

export function ChannelSettingsModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const channels = useSpaceStore((s) => s.channels);
  const spaces = useSpaceStore((s) => s.spaces);
  const spacePermissions = useSpaceStore((s) => s.spacePermissions);
  const channelPermissions = useSpaceStore((s) => s.channelPermissions);

  const [tab, setTab] = useState<'overview' | 'permissions' | 'webhooks' | 'tags'>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);

  const isOpen = activeModal === 'channelSettings';
  const channelId = modalData?.channelId as string | undefined;
  const channel = channels.find(c => c.id === channelId);

  // Each flag reads the scope its server route checks (permissions.md, "Client
  // gating"): editing or deleting this channel resolves MANAGE_CHANNELS with the
  // channel's overrides, the override routes check MANAGE_ROLES space-wide.
  const canManageChannels = hasPermissionBit(channelId ? channelPermissions.get(channelId) : undefined, PermissionBits.MANAGE_CHANNELS);
  const canManageRoles = hasPermissionBit(currentSpaceId ? spacePermissions.get(currentSpaceId) : undefined, PermissionBits.MANAGE_ROLES);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowDeleteConfirm(false);
      setIsDeleting(false);
      setTab('overview');
    }
  }, [isOpen]);

  // One list of this channel's overrides for the whole dialog: the Overview
  // derives privacy from it and the Permissions tab edits it, so neither
  // shows a copy the other has made stale.
  const space = spaces.find(s => s.id === currentSpaceId);
  const entityOverrides = useEntityOverrides('channel', isOpen ? channelId : undefined, space, canManageRoles);
  const isPrivate = currentSpaceId ? isHiddenFromEveryone(entityOverrides.overrides, currentSpaceId) : false;
  const isFetching = !entityOverrides.loaded;
  const shownError = error || entityOverrides.error;

  if (!isOpen || !channel || !channelId || !currentSpaceId) return null;

  const handleToggle = async () => {
    setError('');
    setIsLoading(true);
    try {
      // Only the View Channels bit of the @everyone override changes; any
      // other @everyone bit on this channel stays (#327, #365).
      await entityOverrides.setBits('role', currentSpaceId, PermissionBits.VIEW_CHANNEL, isPrivate ? 'neutral' : 'deny');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteChannel = async () => {
    if (!channelId || !currentSpaceId) return;
    setIsDeleting(true);
    try {
      const channelApi = getApiForOrigin(space?._instanceOrigin ?? '');
      await channelApi.channels.delete(channelId);
      closeModal();
    } catch (err) {
      setError(describeError(err));
      setIsDeleting(false);
    }
  };

  const handleRenameChannel = async (name: string): Promise<void> => {
    setError('');
    try {
      await useSpaceStore.getState().updateChannel(channelId, { name });
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const handleSaveIcon = async (icon: string | null): Promise<void> => {
    setError('');
    setIconBusy(true);
    try {
      await useSpaceStore.getState().updateChannel(channelId, { icon });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIconBusy(false);
    }
  };

  const handleSaveTopic = async (topic: string | null): Promise<void> => {
    setError('');
    try {
      await useSpaceStore.getState().updateChannel(channelId, { topic });
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const handleSaveSlowmode = async (slowmodeSeconds: SlowmodeSeconds): Promise<void> => {
    setError('');
    try {
      await useSpaceStore.getState().updateChannel(channelId, { slowmodeSeconds });
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const handleSetAnnouncement = (on: boolean): void => {
    setError('');
    useSpaceStore.getState().updateChannel(channelId, { type: on ? 'announcement' : 'text' }).catch((err: unknown) => setError(describeError(err)));
  };

  // A webhook posts into a text or announcement channel, and the route checks MANAGE_WEBHOOKS with its overrides.
  const canManageWebhooks = channelTakesWebhooks(channel?.type) && hasPermissionBit(channelId ? channelPermissions.get(channelId) : undefined, PermissionBits.MANAGE_WEBHOOKS);
  const canManageTags = channel?.type === 'forum' && canManageChannels;
  const showTabs = canManageRoles || canManageWebhooks || canManageTags;

  return (
    <>
      <Modal isOpen={isOpen} onClose={closeModal} title={t('spaces:channel.settings.title')} mobileStyle="fullscreen" maxWidth={showTabs ? 'max-w-2xl' : 'max-w-md'}>
        {showTabs ? (
          <div className="flex h-full flex-col gap-4 desktop:h-[min(520px,calc(70*var(--app-vh)))] desktop:flex-row">
            {/* Tabs */}
            <nav className="z-10 flex flex-shrink-0 gap-1 desktop:w-36 desktop:flex-col desktop:gap-0.5 desktop:self-start" aria-label={t('spaces:channel.settings.title')}>
              <button
                type="button"
                onClick={() => setTab('overview')}
                data-active={tab === 'overview'}
                aria-current={tab === 'overview' ? 'page' : undefined}
                className="nav-item h-10 flex-1 justify-center desktop:h-8 desktop:w-full desktop:flex-none desktop:justify-start"
              >
                {t('spaces:settings.nav.tabs.overview')}
              </button>
              {canManageRoles && (
                <button
                  type="button"
                  onClick={() => setTab('permissions')}
                  data-active={tab === 'permissions'}
                  aria-current={tab === 'permissions' ? 'page' : undefined}
                  className="nav-item h-10 flex-1 justify-center desktop:h-8 desktop:w-full desktop:flex-none desktop:justify-start"
                >
                  {t('spaces:permissions.title')}
                </button>
              )}
              {canManageTags && (
                <button
                  type="button"
                  onClick={() => setTab('tags')}
                  data-active={tab === 'tags'}
                  aria-current={tab === 'tags' ? 'page' : undefined}
                  className="nav-item h-10 flex-1 justify-center desktop:h-8 desktop:w-full desktop:flex-none desktop:justify-start"
                >
                  {t('spaces:channel.settings.tags.title')}
                </button>
              )}
              {canManageWebhooks && (
                <button
                  type="button"
                  onClick={() => setTab('webhooks')}
                  data-active={tab === 'webhooks'}
                  aria-current={tab === 'webhooks' ? 'page' : undefined}
                  className="nav-item h-10 flex-1 justify-center desktop:h-8 desktop:w-full desktop:flex-none desktop:justify-start"
                >
                  {t('spaces:channel.settings.webhooks.title')}
                </button>
              )}
            </nav>

            {/* Content */}
            <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
              {tab === 'overview' && (
                <OverviewTab
                  channelId={channelId}
                  channelName={channel.name}
                  channelType={channel.type}
                  channelTopic={channel.topic}
                  slowmodeSeconds={channel.slowmodeSeconds ?? 0}
                  isPrivate={isPrivate}
                  isFetching={isFetching}
                  isLoading={isLoading}
                  error={shownError}
                  canManageChannels={canManageChannels}
                  canManageRoles={canManageRoles}
                  onTogglePrivate={handleToggle}
                  onDeleteChannel={() => setShowDeleteConfirm(true)}
                  onRename={handleRenameChannel}
                  onSaveTopic={handleSaveTopic}
                  channelIcon={channel.icon ?? null}
                  iconBusy={iconBusy}
                  onSaveIcon={handleSaveIcon}
                  onSaveSlowmode={handleSaveSlowmode}
                  onSetAnnouncement={handleSetAnnouncement}
                />
              )}
              {tab === 'tags' && canManageTags && <ForumTagsTab channelId={channelId} />}
              {tab === 'webhooks' && canManageWebhooks && <WebhooksTab channelId={channelId} isAnnouncement={channel.type === 'announcement'} />}
              {tab === 'permissions' && canManageRoles && (
                <PermissionsEditor
                  entityId={channelId}
                  spaceId={currentSpaceId}
                  permDefs={channel.type === 'voice' ? VOICE_CHANNEL_PERMISSIONS : TEXT_CHANNEL_PERMISSIONS}
                  overrides={entityOverrides.overrides}
                  loadError={entityOverrides.error}
                  putOverride={entityOverrides.put}
                  deleteOverride={entityOverrides.remove}
                  onSaved={entityOverrides.reload}
                  unhideNote={t('spaces:channel.settings.private.unhideOnSave')}
                />
              )}
            </div>
          </div>
        ) : (
          <OverviewTab
            channelId={channelId}
            channelName={channel.name}
            channelType={channel.type}
            channelTopic={channel.topic}
            slowmodeSeconds={channel.slowmodeSeconds ?? 0}
            isPrivate={isPrivate}
            isFetching={isFetching}
            isLoading={isLoading}
            error={shownError}
            canManageChannels={canManageChannels}
            canManageRoles={canManageRoles}
            onTogglePrivate={handleToggle}
            onDeleteChannel={() => setShowDeleteConfirm(true)}
            onRename={handleRenameChannel}
            onSaveTopic={handleSaveTopic}
            channelIcon={channel.icon ?? null}
            iconBusy={iconBusy}
            onSaveIcon={handleSaveIcon}
            onSaveSlowmode={handleSaveSlowmode}
            onSetAnnouncement={handleSetAnnouncement}
          />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteChannel}
        title={t('spaces:channel.delete.title', { name: channel.name })}
        description={
          <Trans
            t={t}
            i18nKey={channel.type === 'voice' ? 'spaces:channel.delete.descriptionVoice' : 'spaces:channel.delete.description'}
            values={{ name: channel.name }}
            components={{ strong: <strong /> }}
          />
        }
        confirmLabel={t('spaces:channel.delete.confirm')}
        variant="danger"
        loading={isDeleting}
      />
    </>
  );
}
