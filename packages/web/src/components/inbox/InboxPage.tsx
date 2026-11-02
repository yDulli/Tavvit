import { KeywordMatches } from './KeywordMatches';
import { SavedList } from './SavedList';
import { useKeywordStore } from '../../stores/keywordStore';
import { messagePath } from '../../utils/openThread';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ChannelType, User } from '@backspace/shared';
import { useInbox, type InboxMentionView, type UnreadConversation } from '../../hooks/useInbox';
import { useFormatters } from '../../i18n/formatters';
import { useInboxStore } from '../../stores/inboxStore';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useDmViewer } from '../../hooks/useDmViewer';
import { formatDmHeaderName, formatDmSidebarPreview, formatDmTimestamp } from '../../utils/dmFormatters';
import { isMine, userDisplayName } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { markConversationRead } from '../../utils/markConversationRead';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon, type IconName } from '../ui/Icon';
import { CountBadge } from '../ui/CountBadge';
import { InlineMessageText } from '../chat/InlineMessageText';
import { MemberListToggleButton } from '../layout/MemberListToggleButton';
import { UnreadBadge } from './UnreadBadge';
import { useConversationContextMenu } from '../layout/conversationMenu/useConversationContextMenu';

type InboxTab = 'unread' | 'mentions' | 'saved' | 'keywords';

const FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;

export function iconSrc(icon: string): string {
  return icon.startsWith('http') || icon.startsWith('/') ? icon : `/api/uploads/${icon}`;
}

function useSpaceOf(spaceId: string, origin: string): TaggedSpace | undefined {
  return useSpaceStore((s) => s.spaces.find((space) => space.id === spaceId && (space._instanceOrigin ?? '') === origin));
}

/** A conversation's last activity, short: the time today, "yesterday", then the date. */
export function ConversationTime({ at }: { at: number }) {
  if (!Number.isFinite(at)) return null;
  return (
    <time dateTime={new Date(at).toISOString()} className="flex-shrink-0 font-mono text-label text-txt-tertiary">
      {formatDmTimestamp(at)}
    </time>
  );
}

/**
 * A row keeps no gutter for its action: its time and count run to the same right
 * edge as the rest of the section, and on hover or focus the mark-read action
 * takes their place (`ACTION_OVER_ROW_END` on the action, `UNDER_ACTION` on what
 * it covers). Where nothing hovers the action is always there, so the row makes
 * room for it instead (`ROOM_FOR_ACTION`) and covers nothing.
 */
const ACTION_OVER_ROW_END = 'absolute right-1.5 top-1/2 -translate-y-1/2';
const UNDER_ACTION = 'transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:!opacity-100';
const ROOM_FOR_ACTION = '[@media(hover:none)]:pr-11';

/** The quiet square "mark read" action every row carries, shown on hover and focus. */
function MarkReadButton({ label, onMark, className }: { label: string; onMark: () => Promise<void>; className: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
        void onMark().finally(() => setPending(false));
      }}
      className={`icon-btn flex-shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-40 [@media(hover:none)]:opacity-100 ${className}`}
    >
      <Icon name="check" size={15} />
    </button>
  );
}

/** The space's icon with the channel's own icon, or its type's, small on its corner. */
export function SpaceChannelMark({ space, spaceId, type, icon }: {
  space: TaggedSpace | undefined;
  spaceId: string;
  type: ChannelType | undefined;
  icon?: string | null;
}) {
  return (
    <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center">
      <Avatar
        src={space?.icon ? iconSrc(space.icon) : null}
        name={space?.name ?? '?'}
        size={32}
        palette="space"
        userId={spaceId}
        avatarColor={space?.avatarColor}
      />
      <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-sm border border-border-hard bg-surface-channel text-txt-secondary">
        <ChannelIcon type={type} icon={icon} size={10} />
      </span>
    </span>
  );
}

export function DmConversationRow({ item, onOpen, onMark, onContextMenu }: {
  item: Extract<UnreadConversation, { kind: 'dm' }>;
  onOpen: () => void;
  onMark: () => Promise<void>;
  /** The conversation's right-click menu (conversationMenu), where the page offers one. */
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation('home');
  const viewer = useDmViewer(item.dm.id);
  const others = item.dm.members.filter((member) => !isMine(member, viewer.origin, viewer.self));
  const isGroup = !!item.dm.ownerId;
  const rawMain = isGroup ? null : others[0] ?? null;
  const canonical = useCanonicalUserView(rawMain ?? FALLBACK_USER, viewer.origin);
  const main = rawMain ? canonical : null;
  const name = isGroup ? formatDmHeaderName(item.dm, viewer) : (main && userDisplayName(main)) || '';
  const preview = formatDmSidebarPreview(item.dm, viewer);
  return (
    <li className="list-row group relative p-0" onContextMenu={onContextMenu}>
      <button type="button" onClick={onOpen} className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2 text-left ${ROOM_FOR_ACTION}`}>
        {isGroup ? (
          <AvatarStack members={others} origin={viewer.origin} size={32} border="chat" iconUrl={item.dm.icon} />
        ) : (
          <Avatar src={main?.avatar} name={name || '?'} size={32} status={main?.status} user={main ?? undefined} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-semibold text-txt-primary">{name}</span>
            <span className={`flex-shrink-0 ${UNDER_ACTION}`}><ConversationTime at={item.lastAt} /></span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-meta text-txt-secondary">{preview ?? ''}</span>
            <span className={`flex min-w-[24px] flex-shrink-0 justify-end ${UNDER_ACTION}`}><UnreadBadge count={item.count} /></span>
          </span>
        </span>
      </button>
      <MarkReadButton label={t('inbox.markRead')} onMark={onMark} className={ACTION_OVER_ROW_END} />
    </li>
  );
}

/**
 * A space channel with something unread. In the inbox it sits under its
 * space's heading; `withSpace` gives it the space's icon and name of its own,
 * for a list that mixes channels of several spaces (the Home page).
 */
export function ChannelConversationRow({ item, onOpen, onMark, onContextMenu, withSpace = false }: {
  item: Extract<UnreadConversation, { kind: 'channel' }>;
  onOpen: () => void;
  onMark: () => Promise<void>;
  /** The conversation's right-click menu (conversationMenu), where the page offers one. */
  onContextMenu?: (event: React.MouseEvent) => void;
  withSpace?: boolean;
}) {
  const { t } = useTranslation('home');
  const space = useSpaceOf(item.spaceId, item.origin);
  return (
    <li className="list-row group relative p-0" onContextMenu={onContextMenu}>
      {withSpace ? (
        <button type="button" onClick={onOpen} className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2 text-left ${ROOM_FOR_ACTION}`}>
          <SpaceChannelMark space={space} spaceId={item.spaceId} type={item.type} icon={item.icon} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-txt-primary">{item.name}</span>
            <span className="mt-0.5 block truncate text-meta text-txt-tertiary">{space?.name ?? ''}</span>
          </span>
          <span className={`flex min-w-[24px] flex-shrink-0 justify-end ${UNDER_ACTION}`}><UnreadBadge count={item.count} tone="muted" /></span>
        </button>
      ) : (
        <button type="button" onClick={onOpen} className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md pl-9 pr-2.5 text-left ${ROOM_FOR_ACTION}`}>
          <ChannelIcon type={item.type} icon={item.icon} size={15} className="flex-shrink-0 text-txt-tertiary" />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-txt-primary">{item.name}</span>
          <span className={`flex min-w-[24px] flex-shrink-0 justify-end ${UNDER_ACTION}`}><UnreadBadge count={item.count} tone="muted" /></span>
        </button>
      )}
      <MarkReadButton label={t('inbox.markRead')} onMark={onMark} className={ACTION_OVER_ROW_END} />
    </li>
  );
}

export function SpaceHeading({ spaceId, origin }: { spaceId: string; origin: string }) {
  const space = useSpaceOf(spaceId, origin);
  return (
    <div className="flex items-center gap-2.5 px-2.5 pb-1 pt-3">
      <Avatar
        src={space?.icon ? iconSrc(space.icon) : null}
        name={space?.name ?? '?'}
        size={20}
        palette="space"
        userId={spaceId}
        avatarColor={space?.avatarColor}
      />
      <span className="truncate text-meta font-semibold text-txt-secondary">{space?.name ?? ''}</span>
    </div>
  );
}

export function MentionRow({ item, onOpen, onMark, onContextMenu }: {
  item: InboxMentionView;
  onOpen: () => void;
  onMark: () => Promise<void>;
  /** The mention's right-click menu (conversationMenu), where the page offers one. */
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation('home');
  const { formatShortDate, formatTime } = useFormatters();
  const space = useSpaceOf(item.spaceId, item.origin);
  const channelName = useSpaceStore((s) => s.spaceChannelIndex.get(item.channelId)?.name ?? '');
  const canonical = useCanonicalUserView(item.message.user ?? FALLBACK_USER, item.origin);
  const author = userDisplayName(canonical);
  return (
    <li className="list-row group relative items-start p-0" onContextMenu={onContextMenu}>
      {item.unread && <span aria-hidden="true" className="absolute left-0 top-3 h-5 w-[2px] rounded-sm bg-accent-primary" />}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-3 rounded-md px-2.5 py-2.5 text-left">
        <Avatar src={canonical.avatar} name={author} size={32} user={canonical} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-semibold text-txt-primary">{author}</span>
            <span className="flex-shrink-0 font-mono text-label text-txt-tertiary tabular">
              {formatShortDate(item.message.createdAt)} {formatTime(item.message.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-label text-txt-tertiary">
            {space?.name ?? ''} › #{channelName}
            {item.via !== 'user' && <span className="ml-1.5">· {t(`inbox.via.${item.via}`)}</span>}
          </span>
          <span className="mt-1 line-clamp-3 block text-body leading-[1.45] text-txt-message">
            <InlineMessageText content={item.message.content ?? ''} channelId={item.channelId} mentionedNames={item.mentionedNames} />
          </span>
        </span>
      </button>
      {item.unread && (
        <span className="mt-2">
          <MarkReadButton label={t('inbox.markChannelRead')} onMark={onMark} className="mr-1.5" />
        </span>
      )}
    </li>
  );
}

/** Where a list would be when it has nothing to show: what that means, in a sentence or two. */
export function InboxEmptyState({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <p className="empty-state-title">{title}</p>
      {body && <p className="empty-state-body">{body}</p>}
    </div>
  );
}

/**
 * `/inbox`: what needs attention, in one place. Two views of the same facts
 * the sidebar shows: the conversations with unread messages, and the messages
 * that mention you. Opening an item goes to the conversation (a mention opens
 * at that message); the check marks a conversation read without opening it.
 * See hooks/useInbox.ts for where every line comes from.
 *
 * `showTopBar` is false where a screen of its own names the page (the phone's
 * pushed screen): the bar then carries only the tabs and the bulk action.
 */
export function InboxPage({ showTopBar = true }: { showTopBar?: boolean }) {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  // Right-click menus of the rows, with the dialogs they open.
  const conversationMenu = useConversationContextMenu();
  const addToast = useUIStore((s) => s.addToast);
  const { conversations, mutedCount, mentions, unreadMentionCount } = useInbox();
  const byOrigin = useInboxStore((s) => s.byOrigin);
  const loadMore = useInboxStore((s) => s.loadMore);
  const loadOrigin = useInboxStore((s) => s.loadOrigin);
  const [tab, setTab] = useState<InboxTab>(() => (conversations.length === 0 && unreadMentionCount > 0 ? 'mentions' : 'unread'));
  const [markingAll, setMarkingAll] = useState(false);
  const hasKeywords = useKeywordStore((s) => s.words.length > 0);

  const openConversation = (item: UnreadConversation) => {
    navigate(item.kind === 'dm' ? `/channels/@me/${item.id}` : `/channels/${item.spaceId}/${item.id}`);
  };

  const mark = async (channelId: string) => {
    if (!(await markConversationRead(channelId))) addToast(t('home:inbox.markFailed'), 'warning');
  };

  const markAll = async () => {
    setMarkingAll(true);
    let failed = 0;
    for (const item of conversations) {
      if (!(await markConversationRead(item.id))) failed += 1;
    }
    setMarkingAll(false);
    if (failed > 0) addToast(t('home:inbox.markFailed'), 'warning');
  };

  const dms = conversations.filter((c): c is Extract<UnreadConversation, { kind: 'dm' }> => c.kind === 'dm');
  const channelGroups = useMemo(() => {
    const groups: Array<{ key: string; spaceId: string; origin: string; items: Extract<UnreadConversation, { kind: 'channel' }>[] }> = [];
    for (const item of conversations) {
      if (item.kind !== 'channel') continue;
      const key = `${item.origin}:${item.spaceId}`;
      const group = groups.find((g) => g.key === key);
      if (group) group.items.push(item);
      else groups.push({ key, spaceId: item.spaceId, origin: item.origin, items: [item] });
    }
    return groups;
  }, [conversations]);

  const origins = Object.entries(byOrigin);
  const anyLoading = origins.some(([, list]) => list.status === 'loading' && list.items.length === 0);
  const failedOrigins = origins.filter(([, list]) => list.status === 'failed').map(([origin]) => origin);
  const olderOrigins = origins.filter(([, list]) => list.nextBefore !== null);
  const loadingOlder = origins.some(([, list]) => list.loadingMore);

  const tabButton = (id: InboxTab, label: string, count: number, tone: 'accent' | 'muted') => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`relative flex items-center gap-1.5 px-2 text-ui font-medium transition-colors ${
        tab === id ? 'text-txt-primary' : 'text-txt-tertiary hover:text-txt-secondary'
      }`}
    >
      {label}
      {count > 0 && <CountBadge count={count} muted={tone === 'muted'} />}
      {tab === id && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] bg-accent-primary" />}
    </button>
  );

  return (
    <div className="lit-phone flex h-full min-w-0 flex-1 flex-col bg-surface-chat desktop:bg-transparent">
      <div className={`flex items-stretch gap-4 border-b border-border-hard ${showTopBar ? 'panel-bar px-4' : 'h-11 flex-shrink-0 px-3'}`}>
        {showTopBar && (
          <div className="flex items-center gap-2">
            <Icon name="bell" size={17} className="text-txt-tertiary" />
            <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('home:inbox.title')}</span>
          </div>
        )}
        {showTopBar && <div aria-hidden="true" className="my-auto h-4 w-px bg-border-soft" />}
        <div role="tablist" className="flex items-stretch gap-1">
          {tabButton('unread', t('home:inbox.tabs.unread'), conversations.length, 'muted')}
          {tabButton('mentions', t('home:inbox.tabs.mentions'), unreadMentionCount, 'accent')}
          {tabButton('saved', t('home:inbox.tabs.saved'), 0, 'muted')}
          {hasKeywords && tabButton('keywords', t('home:inbox.tabs.keywords'), 0, 'muted')}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {tab === 'unread' && conversations.length > 0 && (
            <button type="button" onClick={() => { void markAll(); }} disabled={markingAll} className="btn-quiet btn-sm">
              <Icon name="check" size={14} />
              {markingAll ? t('home:inbox.markingAll') : t('home:inbox.markAll')}
            </button>
          )}
          {showTopBar && <MemberListToggleButton />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-2 py-3 desktop:px-4 desktop:py-4">
          {tab === 'saved' ? (
            <SavedList />
          ) : tab === 'keywords' ? (
            <KeywordMatches />
          ) : tab === 'unread' ? (
            conversations.length === 0 ? (
              <InboxEmptyState
                icon="check"
                title={t('home:inbox.caughtUp.title')}
                body={mutedCount > 0 ? t('home:inbox.caughtUp.muted', { count: mutedCount }) : t('home:inbox.caughtUp.body')}
              />
            ) : (
              <>
                {dms.length > 0 && (
                  <section aria-label={t('home:inbox.sections.dms')}>
                    <h2 className="label-mono px-2.5 pb-1.5 pt-1">{t('home:inbox.sections.dms')}</h2>
                    <ul className="space-y-px">
                      {dms.map((item) => (
                        <DmConversationRow key={item.id} item={item} onOpen={() => openConversation(item)} onMark={() => mark(item.id)} onContextMenu={(event) => conversationMenu.openDm(event, item.id)} />
                      ))}
                    </ul>
                  </section>
                )}
                {channelGroups.length > 0 && (
                  <section aria-label={t('home:inbox.sections.spaces')} className={dms.length > 0 ? 'mt-4 border-t border-border-hard pt-3' : ''}>
                    <h2 className="label-mono px-2.5 pb-0 pt-1">{t('home:inbox.sections.spaces')}</h2>
                    {channelGroups.map((group) => (
                      <div key={group.key}>
                        <SpaceHeading spaceId={group.spaceId} origin={group.origin} />
                        <ul className="space-y-px">
                          {group.items.map((item) => (
                            <ChannelConversationRow key={item.id} item={item} onOpen={() => openConversation(item)} onMark={() => mark(item.id)} onContextMenu={(event) => conversationMenu.openChannel(event, item.id)} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                )}
                {mutedCount > 0 && (
                  <p className="px-2.5 pt-4 text-meta text-txt-tertiary">{t('home:inbox.mutedHidden', { count: mutedCount })}</p>
                )}
              </>
            )
          ) : (
            <>
              {failedOrigins.length > 0 && (
                <div role="alert" className="mx-2.5 mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border-hard px-3 py-2 text-ui text-txt-secondary">
                  <span className="flex-1">{t('home:inbox.mentionsFailed')}</span>
                  <button type="button" className="btn-outline btn-sm" onClick={() => failedOrigins.forEach((origin) => { void loadOrigin(origin); })}>
                    {t('home:inbox.retry')}
                  </button>
                </div>
              )}
              {mentions.length === 0 ? (
                anyLoading ? (
                  <div className="space-y-2 px-2.5 pt-2" aria-hidden="true">
                    {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton-block h-16" />)}
                  </div>
                ) : (
                  failedOrigins.length === 0 && <InboxEmptyState icon="at" title={t('home:inbox.noMentions.title')} body={t('home:inbox.noMentions.body')} />
                )
              ) : (
                <ul className="space-y-px">
                  {mentions.map((item) => (
                    <MentionRow
                      key={`${item.origin}:${item.message.id}`}
                      item={item}
                      onOpen={() => navigate(messagePath(item.spaceId, item.channelId, item.message.id))}
                      onMark={() => mark(item.channelId)}
                      onContextMenu={(event) => conversationMenu.openMention(event, { origin: item.origin, spaceId: item.spaceId, channelId: item.channelId, messageId: item.message.id })}
                    />
                  ))}
                </ul>
              )}
              {olderOrigins.length > 0 && (
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={loadingOlder}
                    onClick={() => olderOrigins.forEach(([origin]) => { void loadMore(origin); })}
                  >
                    {loadingOlder ? t('common:states.loading') : t('home:inbox.older')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {conversationMenu.dialogs}
    </div>
  );
}
