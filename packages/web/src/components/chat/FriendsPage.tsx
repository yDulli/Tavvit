import { BAR_BUTTON, BAR_TITLE } from '../layout/mobileClasses';
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { friendEntryOf, isIncomingRequest, isOutgoingRequest, pendingRequestWith, useSocialStore, type TaggedFriend, type TaggedFriendRequest, type TaggedSearchResult } from '../../stores/socialStore';
import { useAuthStore } from '../../stores/authStore';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { describeError } from '../../i18n/errors';
import { useInstanceStore } from '../../stores/instanceStore';
import { useUIStore } from '../../stores/uiStore';
import { useFederationStore } from '../../stores/federationStore';
import { useFederationEnabled } from '../../hooks/useFederationEnabled';
import { Avatar } from '../ui/Avatar';
import { MemberListToggleButton } from '../layout/MemberListToggleButton';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Icon, type IconName } from '../ui/Icon';
import { useFriendBuckets } from '../../hooks/useFriendBuckets';
import { friendRowKey, type HomeFriend } from '../../utils/homeSummary';
import { FRIENDS_VIEW_PARAM, isFriendsLinkView } from '../../utils/homeNav';
import { friendProfileUser, useFriendDoing } from '../home/friendDoing';
import { useUserContextMenu } from '../layout/userMenu/useUserContextMenu';
import { parseFederatedUsername, isFederationGlobeApplicable, userDisplayName, type IdentityFields } from '../../utils/identity';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { friendRequestTarget } from '../../utils/friendRequestTarget';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { presenceLabel } from '../../i18n/presence';

type SocialT = TFunction<['social', 'common']>;

/** An online friend in the phone's Activity tab: who, and what they are doing in words. */
function ActivityFriendItem({ row, onOpen }: { row: HomeFriend; onOpen: (friend: TaggedFriend) => void }) {
  const canonical = useCanonicalUserView(row.friend as unknown as User, row.friend._instanceOrigin);
  const friendDisplayName = userDisplayName(canonical);
  const doing = useFriendDoing(row, canonical);
  const domain = isFederationGlobeApplicable(canonical) ? parseFederatedUsername(canonical.username).domain : null;

  return (
    <li>
      <button type="button" onClick={() => onOpen(row.friend)} className="list-row w-full items-start text-left">
        <Avatar
          src={canonical.avatar}
          name={friendDisplayName}
          size={32}
          status={canonical.status}
          userId={canonical.homeUserId ?? canonical.id}
          avatarColor={canonical.avatarColor}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-body font-medium leading-5 text-txt-primary">{friendDisplayName}</span>
            {domain && <span className="min-w-0 truncate font-mono text-label text-txt-tertiary">@{domain}</span>}
          </span>
          <span className={`block truncate text-meta leading-[18px] ${doing.busy ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>{doing.line}</span>
          {doing.detail && <span className="block truncate text-meta leading-4 text-txt-tertiary">{doing.detail}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The phone's Activity tab: the friends who are online, on voice first, then
 * those sharing an activity, then the rest (the desktop's "Active now"
 * column, utils/homeSummary.ts). Its own component so the buckets are worked
 * out only while the tab is open.
 */
function ActivityTab({ onOpen }: { onOpen: (friend: TaggedFriend) => void }) {
  const { t } = useTranslation(['social', 'common']);
  const buckets = useFriendBuckets();
  const online = [...buckets.inVoice, ...buckets.active, ...buckets.around];
  return (
    <div className="flex-1 overflow-y-auto px-2 py-4">
      {online.length === 0 ? (
        <EmptyList icon="users">{t('social:empty.online')}</EmptyList>
      ) : (
        <>
          <SectionLabel>{t('social:sections.online', { n: online.length })}</SectionLabel>
          <ul className="space-y-px">
            {online.map((row) => <ActivityFriendItem key={friendRowKey(row.friend)} row={row} onOpen={onOpen} />)}
          </ul>
        </>
      )}
    </div>
  );
}

type Tab = 'online' | 'all' | 'pending' | 'add' | 'activity';

/** A list's heading: the mono label every column in the app uses, with its count. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono px-2.5 pb-1.5 pt-1">{children}</h2>;
}

/** What an empty list says: a sentence where the rows would be. */
function EmptyList({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <p className="empty-state-body">{children}</p>
    </div>
  );
}

function tabLabel(t: SocialT, tab: Tab): string {
  switch (tab) {
    case 'online': return t('common:states.online');
    case 'all': return t('social:tabs.all');
    case 'pending': return t('social:tabs.pending');
    case 'add': return t('social:tabs.add');
    case 'activity': return t('social:tabs.activity');
  }
}

interface FriendsPageProps {
  mobile?: boolean;
}

export function FriendsPage({ mobile }: FriendsPageProps) {
  const { t } = useTranslation(['social', 'common']);
  // `?view=add` and `?view=pending` open the page on that view (the Home page
  // and the activity column link here so); the parameter is dropped once read,
  // so a reload or a later visit opens on the online list.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedView = searchParams.get(FRIENDS_VIEW_PARAM);
  const [activeTab, setActiveTab] = useState<Tab>(() => (isFriendsLinkView(linkedView) ? linkedView : 'online'));
  const [pendingUnfriend, setPendingUnfriend] = useState<{ friend: TaggedFriend; name: string } | null>(null);
  const navigate = useNavigate();
  const addToast = useUIStore((s) => s.addToast);
  // The right-click menu of a person on the lists (profile, message, the friendship action, block).
  const userMenu = useUserContextMenu();

  useEffect(() => {
    if (!isFriendsLinkView(linkedView)) return;
    setActiveTab(linkedView);
    const next = new URLSearchParams(searchParams);
    next.delete(FRIENDS_VIEW_PARAM);
    setSearchParams(next, { replace: true });
  }, [linkedView, searchParams, setSearchParams]);

  // If the user clicked "Retry your friend request" in the Connections panel
  // and we just navigated here, the federation store carries the original
  // target. Switching to the Add tab makes the AddFriendTab mount, which then
  // consumes the prefill into its query input. We only check on mount — the
  // store value is one-shot (cleared by AddFriendTab on consume).
  useEffect(() => {
    if (useFederationStore.getState().pendingFriendAddPrefill) {
      setActiveTab('add');
    }
  }, []);

  const {
    friends,
    requests,
    isLoading,
    loadFriends,
    loadRequests,
    updateFriendRequest,
    cancelFriendRequest,
    removeFriend
  } = useSocialStore();

  useEffect(() => {
    loadFriends();
    loadRequests();
  }, [loadFriends, loadRequests]);

  const pushMobileScreen = useUIStore((s) => s.pushMobileScreen);

  const onlineFriends = friends.filter(f => f.status !== 'offline');
  const pendingIncoming = requests.filter(r => r.status === 'pending' && isIncomingRequest(r));
  const pendingOutgoing = requests.filter(r => r.status === 'pending' && isOutgoingRequest(r));

  const handleOpenDm = async (person: IdentityFields, origin: string) => {
    try {
      const rowId = await openDirectMessage(person, origin);
      useUIStore.getState().setShowDms(true);
      navigate(`/channels/@me/${rowId}`);
    } catch (err) {
      addToast(t('social:sendMessage.failed', { reason: describeError(err) }), 'warning');
    }
  };

  const renderTabContent = () => {
    if (isLoading && friends.length === 0 && requests.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }

    // The lists are as wide as a line of them reads well, not the whole window.
    const listShell = (children: React.ReactNode) => (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-2 py-4 desktop:px-4">{children}</div>
      </div>
    );

    switch (activeTab) {
      case 'online':
        return listShell(
          <>
            <SectionLabel>{t('social:sections.online', { n: onlineFriends.length })}</SectionLabel>
            {onlineFriends.length === 0 ? (
              <EmptyList icon="moon">{t('social:empty.online')}</EmptyList>
            ) : (
              <ul className="space-y-px">
                {onlineFriends.map(friend => (
                  <FriendItem key={`${friend.id}:${friend._instanceOrigin}`} friend={friend} onRemove={() => setPendingUnfriend({ friend, name: userDisplayName(friend) })} onDm={() => handleOpenDm(friend, friend._instanceOrigin)} onContextMenu={(event) => userMenu.open(event, friendProfileUser(friend), friend._instanceOrigin)} />
                ))}
              </ul>
            )}
          </>,
        );
      case 'all':
        return listShell(
          <>
            <SectionLabel>{t('social:sections.all', { n: friends.length })}</SectionLabel>
            {friends.length === 0 ? (
              <EmptyList icon="users">{t('social:empty.all')}</EmptyList>
            ) : (
              <ul className="space-y-px">
                {friends.map(friend => (
                  <FriendItem key={`${friend.id}:${friend._instanceOrigin}`} friend={friend} onRemove={() => setPendingUnfriend({ friend, name: userDisplayName(friend) })} onDm={() => handleOpenDm(friend, friend._instanceOrigin)} onContextMenu={(event) => userMenu.open(event, friendProfileUser(friend), friend._instanceOrigin)} />
                ))}
              </ul>
            )}
          </>,
        );
      case 'pending':
        return listShell(
          <>
            <SectionLabel>{t('social:sections.pending', { n: pendingIncoming.length + pendingOutgoing.length })}</SectionLabel>
            {[...pendingIncoming, ...pendingOutgoing].length === 0 ? (
              <EmptyList icon="user-plus">{t('social:empty.pending')}</EmptyList>
            ) : (
              <ul className="space-y-px">
                {pendingIncoming.map(req => (
                  <RequestItem
                    key={`${req.id}:${req._instanceOrigin}`}
                    request={req}
                    type="incoming"
                    onContextMenu={(event) => { if (req.user) userMenu.open(event, req.user as unknown as User, req._instanceOrigin); }}
                    onAccept={() => updateFriendRequest(req.id, req._instanceOrigin, 'accepted')}
                    onDecline={() => updateFriendRequest(req.id, req._instanceOrigin, 'declined')}
                  />
                ))}
                {pendingOutgoing.map(req => (
                  <RequestItem
                    key={`${req.id}:${req._instanceOrigin}`}
                    request={req}
                    type="outgoing"
                    onContextMenu={(event) => { if (req.user) userMenu.open(event, req.user as unknown as User, req._instanceOrigin); }}
                    onCancel={() => cancelFriendRequest(req.id, req._instanceOrigin)}
                  />
                ))}
              </ul>
            )}
          </>,
        );
      case 'add':
        return (
          <AddFriendTab
            onOpenDm={handleOpenDm}
          />
        );
      case 'activity':
        return (
          <ActivityTab
            onOpen={(friend) => {
              if (mobile) pushMobileScreen('user-profile', { userId: friend.id, origin: friend._instanceOrigin });
              else void handleOpenDm(friend, friend._instanceOrigin);
            }}
          />
        );
    }
  };

  const popMobileScreen = useUIStore((s) => s.popMobileScreen);

  return (
    <div className="lit-phone flex-1 flex flex-col bg-surface-chat desktop:bg-transparent h-full">
      {/* Header */}
      {mobile ? (
        <header className="panel-bar flex h-12 items-center gap-1 bg-surface-base px-1">
          <button type="button" onClick={popMobileScreen} aria-label={t('common:actions.back')} className={BAR_BUTTON}>
            <Icon name="chevron-left" size={20} />
          </button>
          <h1 className={BAR_TITLE}>{t('common:labels.friends')}</h1>
        </header>
      ) : (
        <div className="panel-bar px-4 flex items-stretch gap-4">
          <div className="flex items-center gap-2">
            <Icon name="users" size={17} className="text-txt-tertiary" />
            <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('common:labels.friends')}</span>
          </div>
          <div aria-hidden="true" className="my-auto h-4 w-px bg-border-soft" />
          <div role="tablist" className="flex items-stretch gap-1">
            <TabButton active={activeTab === 'online'} onClick={() => setActiveTab('online')}>{t('common:states.online')}</TabButton>
            <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')}>{t('social:tabs.all')}</TabButton>
            <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')}>
              {t('social:tabs.pending')}
              {(pendingIncoming.length > 0) && (
                <span className="count-badge ml-1.5">
                  {pendingIncoming.length > 99 ? '99+' : pendingIncoming.length}
                </span>
              )}
            </TabButton>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('add')}
              aria-pressed={activeTab === 'add'}
              className={activeTab === 'add' ? 'btn-quiet btn-sm bg-interactive-selected text-txt-primary' : 'btn-primary btn-sm'}
            >
              <Icon name="user-plus" size={14} />
              {t('social:tabs.add')}
            </button>
            <MemberListToggleButton />
          </div>
        </div>
      )}

      {/* Mobile tab bar */}
      {mobile && (
        <div className="no-scrollbar flex flex-shrink-0 overflow-x-auto border-b border-border-hard">
          {(['online', 'all', 'pending', 'add', 'activity'] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-auto flex-shrink-0 items-center justify-center whitespace-nowrap px-2.5 py-2.5 text-ui font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-accent-primary text-txt-primary'
                  : 'border-transparent text-txt-secondary hover:text-txt-primary'
              }`}
            >
              {tabLabel(t, tab)}
              {tab === 'pending' && pendingIncoming.length > 0 && (
                <span className="count-badge ml-1">
                  {pendingIncoming.length > 99 ? '99+' : pendingIncoming.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {renderTabContent()}

      <ConfirmDialog
        isOpen={pendingUnfriend !== null}
        onClose={() => setPendingUnfriend(null)}
        onConfirm={async () => {
          if (pendingUnfriend) {
            await removeFriend(pendingUnfriend.friend, pendingUnfriend.friend._instanceOrigin);
            setPendingUnfriend(null);
          }
        }}
        title={t('social:removeFriend.title')}
        description={t('social:removeFriend.description', { name: pendingUnfriend?.name ?? t('social:removeFriend.fallbackName') })}
        confirmLabel={t('common:actions.remove')}
        variant="danger"
      />
      {userMenu.dialogs}
    </div>
  );
}

// ─── Add Friend Tab ─────────────────────────────────────────────────────────

/**
 * What the add-friend field holds (social.md, "Finding people"): a username
 * to look up, a handle of someone on another instance, or not enough yet.
 * Nobody is listed before a search; a search needs a whole username's worth
 * of letters, the same rule the instance applies.
 */
type AddQuery =
  | { kind: 'empty' }
  | { kind: 'short' }
  | { kind: 'invalid' }
  | { kind: 'search'; username: string }
  | { kind: 'handle'; handle: string; host: string };

const USERNAME_MIN_LENGTH = 3;
const USERNAME_QUERY = /^[a-z0-9_]{3,32}$/;

function addQueryOf(raw: string): AddQuery {
  const trimmed = raw.trim().replace(/^@/, '');
  if (trimmed.length === 0) return { kind: 'empty' };
  const at = trimmed.lastIndexOf('@');
  if (at > 0 && at < trimmed.length - 1) return { kind: 'handle', handle: trimmed, host: trimmed.slice(at + 1).toLowerCase() };
  const name = trimmed.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(name)) return { kind: 'invalid' };
  if (name.length < USERNAME_MIN_LENGTH) return { kind: 'short' };
  return USERNAME_QUERY.test(name) ? { kind: 'search', username: name } : { kind: 'invalid' };
}

/** Where the viewer stands with a person a search found. */
type SearchRelationship = 'none' | 'friends' | 'outbound_pending' | 'inbound_pending';
type SearchRow = TaggedSearchResult & { relationship: SearchRelationship; requestId?: string };

function AddFriendTab({
  onOpenDm,
}: {
  onOpenDm: (person: IdentityFields, origin: string) => void;
}) {
  const { t } = useTranslation(['social', 'common']);
  const searchUsers = useSocialStore((s) => s.searchUsers);
  const sendFriendRequest = useSocialStore((s) => s.sendFriendRequest);
  const friends = useSocialStore((s) => s.friends);
  const requests = useSocialStore((s) => s.requests);
  const currentUser = useAuthStore((s) => s.user);
  const instances = useInstanceStore((s) => s.instances);
  const addToast = useUIStore((s) => s.addToast);
  const federationEnabled = useFederationEnabled();

  const [query, setQuery] = useState(() => {
    // Consume the federation store's pending friend-add prefill at mount so
    // a Retry click in the Connections panel lands here with the original
    // target already in the input. The consume call clears the store value
    // so subsequent mounts (e.g. tab switching) start empty.
    return useFederationStore.getState().consumePendingFriendAddPrefill() ?? '';
  });
  const [results, setResults] = useState<TaggedSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [directAddLoading, setDirectAddLoading] = useState(false);

  const parsed = useMemo(() => addQueryOf(query), [query]);
  const searchName = parsed.kind === 'search' ? parsed.username : null;

  // Debounced lookup with a race guard: only the newest answer is shown.
  useEffect(() => {
    if (searchName === null) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    let active = true;
    setSearching(true);
    setSearchError('');
    const timer = setTimeout(() => {
      searchUsers(searchName)
        .then((found) => { if (active) setResults(found); })
        .catch((err: unknown) => {
          if (!active) return;
          setResults([]);
          setSearchError(describeError(err));
        })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [searchName, searchUsers]);

  // The viewer's own rows on every connected instance.
  const selfIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentUser?.id) ids.add(`${currentUser.id}:`);
    for (const inst of instances) {
      if (inst.user?.id) ids.add(`${inst.user.id}:${inst.origin}`);
    }
    return ids;
  }, [currentUser?.id, instances]);

  // Each result with where the viewer stands. A result and a list entry are
  // the same person when their `userKey`s match, whichever instance's row
  // each is shown by. A pending request's id is good only on the instance
  // that holds it, so a row with a request is shown by that request's row.
  const rows: SearchRow[] = useMemo(() => results
    .filter((person) => !selfIds.has(`${person.id}:${person._instanceOrigin}`))
    .map((person): SearchRow => {
      if (friendEntryOf(friends, person, person._instanceOrigin)) return { ...person, relationship: 'friends' };
      const pending = pendingRequestWith(requests, person, person._instanceOrigin);
      if (pending?.user && (isOutgoingRequest(pending) || isIncomingRequest(pending))) {
        const shownBy: TaggedSearchResult = pending._instanceOrigin === person._instanceOrigin
          ? person
          : { ...pending.user, _instanceOrigin: pending._instanceOrigin };
        return {
          ...shownBy,
          relationship: isOutgoingRequest(pending) ? 'outbound_pending' : 'inbound_pending',
          requestId: pending.id,
        };
      }
      return { ...person, relationship: 'none' };
    }), [results, friends, requests, selfIds]);

  // A handle on this instance needs no federation; one elsewhere does.
  const ownHost = window.location.host.toLowerCase();
  const handleAddable = parsed.kind === 'handle' && (parsed.host === ownHost || federationEnabled === true);

  const handleDirectAdd = async () => {
    if (parsed.kind !== 'handle') return;
    setDirectAddLoading(true);
    try {
      await sendFriendRequest({ username: parsed.handle });
      addToast(t('social:request.sent'), 'success');
      setQuery('');
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setDirectAddLoading(false);
    }
  };

  const body = (() => {
    switch (parsed.kind) {
      case 'empty':
        return <EmptyList icon="user-plus">{t('social:add.intro')}</EmptyList>;
      case 'short':
        return <p className="px-2.5 text-ui text-txt-tertiary">{t('social:add.tooShort', { min: USERNAME_MIN_LENGTH })}</p>;
      case 'invalid':
        return <p className="px-2.5 text-ui text-txt-tertiary">{t('social:add.invalidCharacters')}</p>;
      case 'handle':
        return handleAddable ? null : <p className="px-2.5 text-ui text-txt-tertiary">{t('social:add.federationOff')}</p>;
      case 'search':
        if (searching && rows.length === 0) {
          return (
            <div className="flex items-center justify-center h-24">
              <LoadingSpinner />
            </div>
          );
        }
        if (searchError) {
          return <p role="alert" className="px-2.5 text-ui text-txt-danger">{searchError}</p>;
        }
        if (rows.length === 0) return <EmptyList icon="search">{t('social:add.noSearchResults')}</EmptyList>;
        return (
          <div>
            <div className="label-mono mb-1.5 px-2.5">{t('social:add.resultsLabel')}</div>
            <ul className="space-y-px">
              {rows.map((row) => (
                <SearchResultRow key={`${row.id}:${row._instanceOrigin}`} row={row} onOpenDm={onOpenDm} />
              ))}
            </ul>
          </div>
        );
    }
  })();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-4 pt-6 pb-6 desktop:px-6">
        <h2 className="page-title mb-1">{t('social:add.title')}</h2>
        <p className="text-ui text-txt-tertiary mb-4">
          <Trans
            t={t}
            i18nKey="social:add.hint"
            components={{ handle: <span className="font-medium text-txt-secondary" /> }}
          />
        </p>

        <div className="relative mb-4">
          <input
            type="text"
            placeholder={t('social:add.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('social:add.placeholder')}
            className="input-search w-full h-10 pl-9 pr-9 rounded-md text-body"
          />
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-txt-tertiary" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('common:actions.clear')}
              className="icon-btn absolute right-1.5 top-1/2 -translate-y-1/2"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {parsed.kind === 'handle' && handleAddable && (
          <div className="surface-card rounded-lg px-3 py-2.5 mb-4 flex items-center gap-3">
            <Icon name="user-plus" size={16} className="text-txt-tertiary flex-shrink-0" />
            <div className="flex-1 min-w-0 text-ui text-txt-secondary">
              <Trans
                t={t}
                i18nKey="social:add.direct"
                values={{ handle: parsed.handle }}
                components={{ handle: <span className="font-semibold text-txt-primary" /> }}
              />
            </div>
            <button
              type="button"
              onClick={handleDirectAdd}
              disabled={directAddLoading}
              aria-busy={directAddLoading}
              className="btn-primary btn-sm flex-shrink-0"
            >
              {directAddLoading ? t('social:request.sending') : t('social:add.sendRequest')}
            </button>
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

// ─── Search Result Row ──────────────────────────────────────────────────────

function SearchResultRow({
  row,
  onOpenDm,
}: {
  row: SearchRow;
  onOpenDm: (person: IdentityFields, origin: string) => void;
}) {
  const { t } = useTranslation(['social', 'common']);
  const sendFriendRequest = useSocialStore((s) => s.sendFriendRequest);
  const updateFriendRequest = useSocialStore((s) => s.updateFriendRequest);
  const cancelFriendRequest = useSocialStore((s) => s.cancelFriendRequest);
  const openModal = useUIStore((s) => s.openModal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const origin = row._instanceOrigin;
  const displayName = userDisplayName(row);
  const originLabel = origin
    ? (() => { try { return new URL(origin).host; } catch { return origin; } })()
    : null;

  // The lists in the social store follow every answer, so the row's state
  // moves by itself once an action went through.
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const openProfile = () => openModal('userProfile', { userId: row.id, origin });
  const requestId = row.requestId;

  const stateLabel = row.relationship === 'friends'
    ? t('social:add.state.friends')
    : row.relationship === 'outbound_pending'
      ? t('social:add.state.outgoing')
      : row.relationship === 'inbound_pending'
        ? t('social:add.state.incoming')
        : null;

  return (
    <li className="list-row">
      <button type="button" onClick={openProfile} className="flex-shrink-0 rounded-md" aria-label={displayName}>
        <Avatar src={row.avatar} name={displayName} size={36} userId={row.homeUserId ?? row.id} avatarColor={row.avatarColor} />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={openProfile} className="block max-w-full text-left">
          <span className="block truncate text-body font-medium text-txt-primary">{displayName}</span>
          <span className="block truncate font-mono text-label text-txt-tertiary">
            @{row.username}{originLabel ? ` · ${originLabel}` : ''}
          </span>
        </button>
        {stateLabel && !error && <span className="mt-0.5 block truncate text-meta text-txt-secondary">{stateLabel}</span>}
        {error && <span role="alert" className="mt-0.5 block truncate text-meta text-txt-danger">{error}</span>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {row.relationship === 'none' && (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => run(() => sendFriendRequest(friendRequestTarget(row, origin)))}
            className="btn-outline btn-sm"
          >
            {busy ? t('social:request.sending') : t('social:add.sendRequest')}
          </button>
        )}
        {row.relationship === 'outbound_pending' && (
          <button
            type="button"
            disabled={busy || !requestId}
            aria-busy={busy}
            onClick={() => { if (requestId) void run(() => cancelFriendRequest(requestId, origin, row)); }}
            className="btn-quiet btn-sm"
          >
            {busy ? t('social:request.cancelling') : t('social:request.cancel')}
          </button>
        )}
        {row.relationship === 'inbound_pending' && (
          <>
            <button
              type="button"
              disabled={busy || !requestId}
              onClick={() => { if (requestId) void run(() => updateFriendRequest(requestId, origin, 'accepted', row)); }}
              className="btn-outline btn-sm"
            >
              {t('common:actions.accept')}
            </button>
            <button
              type="button"
              disabled={busy || !requestId}
              onClick={() => { if (requestId) void run(() => updateFriendRequest(requestId, origin, 'declined', row)); }}
              className="btn-quiet btn-sm"
            >
              {t('common:actions.decline')}
            </button>
          </>
        )}
        {row.relationship === 'friends' && (
          <button type="button" onClick={() => onOpenDm(row, origin)} className="btn-outline btn-sm">
            {t('social:friend.message')}
          </button>
        )}
      </div>
    </li>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

/** A header tab: plain text with the accent hairline under the open one. */
function TabButton({ children, active, onClick }: { children: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center px-2 text-ui font-medium transition-colors ${
        active ? 'text-txt-primary' : 'text-txt-tertiary hover:text-txt-secondary'
      }`}
    >
      {children}
      {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] bg-accent-primary" />}
    </button>
  );
}

/** A row's quiet square action; a destructive one turns the danger colour on hover. */
function RowAction({ title, onClick, tone = 'neutral', icon }: { title: string; onClick: () => void; tone?: 'neutral' | 'danger'; icon: 'message' | 'x' }) {
  const hover = tone === 'danger' ? 'hover:!text-txt-danger' : '';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`icon-btn icon-btn-lg ${hover}`}
      aria-label={title}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function FriendItem({ friend, onRemove, onDm, onContextMenu }: {
  friend: TaggedFriend;
  onRemove: () => void;
  onDm: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { t } = useTranslation(['social', 'common']);
  const canonical = useCanonicalUserView(friend as unknown as User, friend._instanceOrigin);
  const instanceLabel = friend._instanceOrigin ? (() => { try { return new URL(friend._instanceOrigin).host; } catch { return friend._instanceOrigin; } })() : '';
  const friendDisplayName = userDisplayName(canonical);
  return (
    <li className="list-row group justify-between" onContextMenu={onContextMenu}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={canonical.avatar} name={friendDisplayName} size={32} status={canonical.status} userId={canonical.homeUserId ?? canonical.id} avatarColor={canonical.avatarColor} />
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-medium leading-5 text-txt-primary">{friendDisplayName}</span>
            <span className="truncate font-mono text-label text-txt-tertiary">@{friend.username}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-meta leading-[18px] text-txt-tertiary">
            <span className="flex-shrink-0">{presenceLabel(t, friend.status)}</span>
            {instanceLabel && (
              <span className="truncate">· {t('social:friend.viaInstance', { host: instanceLabel })}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <RowAction title={t('social:friend.message')} onClick={onDm} icon="message" />
        <RowAction title={t('social:friend.remove')} onClick={onRemove} icon="x" tone="danger" />
      </div>
    </li>
  );
}

function RequestItem({ request, type, onAccept, onDecline, onCancel, onContextMenu }: {
  request: TaggedFriendRequest;
  type: 'incoming' | 'outgoing';
  onContextMenu: (event: React.MouseEvent) => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation(['social', 'common']);
  const rawUser = request.user;
  const _FALLBACK_USER = { id: '', username: '', createdAt: 0, isAdmin: false, replicatedInstances: [] } as unknown as User;
  const canonicalUser = useCanonicalUserView((rawUser as unknown as User | null) ?? _FALLBACK_USER, request._instanceOrigin);
  const user = rawUser ? canonicalUser : null;
  if (!user) return null;
  const instanceLabel = request._instanceOrigin ? (() => { try { return new URL(request._instanceOrigin).host; } catch { return request._instanceOrigin; } })() : '';
  const reqDisplayName = userDisplayName(user);

  return (
    <li className="list-row group justify-between" onContextMenu={onContextMenu}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={user.avatar} name={reqDisplayName} size={32} status={user.status} userId={user.homeUserId ?? user.id} avatarColor={user.avatarColor} />
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-body font-medium leading-5 text-txt-primary">{reqDisplayName}</span>
            <span className="truncate font-mono text-label text-txt-tertiary">@{user.username}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-meta leading-[18px] text-txt-tertiary">
            <span className={`flex-shrink-0 ${type === 'incoming' ? 'text-txt-secondary' : ''}`}>{type === 'incoming' ? t('social:request.incoming') : t('social:request.outgoing')}</span>
            {instanceLabel && (
              <span className="truncate">· {t('social:friend.viaInstance', { host: instanceLabel })}</span>
            )}
          </div>
        </div>
      </div>
      {/* In words, as on a search result: this is the one thing the row is for. */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {type === 'incoming' ? (
          <>
            <button type="button" onClick={() => onAccept?.()} className="btn-outline btn-sm">{t('common:actions.accept')}</button>
            <button type="button" onClick={() => onDecline?.()} className="btn-quiet btn-sm">{t('common:actions.decline')}</button>
          </>
        ) : (
          <button type="button" onClick={() => onCancel?.()} className="btn-quiet btn-sm">{t('social:request.cancel')}</button>
        )}
      </div>
    </li>
  );
}
