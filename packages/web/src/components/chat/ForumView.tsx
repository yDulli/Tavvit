import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel } from '@backspace/shared';
import { FORUM_LIMITS, type ForumPost, type ForumTag, type ForumTagColor } from '@backspace/shared/src/forums';
import { MAX_MESSAGE_LENGTH } from '@backspace/shared';
import { THREAD_LIMITS, type ThreadInfo } from '@backspace/shared/src/threads';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useChatStore } from '../../stores/chatStore';
import { useForumStore } from '../../stores/forumStore';
import { getApiForOrigin, getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useThreadStore } from '../../stores/threadStore';
import { useUIStore } from '../../stores/uiStore';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { openThreadView } from '../../utils/openThread';
import { PermissionBits, hasPermissionBit } from '../../utils/permissions';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

/** Spelled out, so the stylesheet's build can see them. */
const TAG_DOT: Record<ForumTagColor, string> = {
  mint: 'bg-accent-mint',
  peach: 'bg-accent-peach',
  lavender: 'bg-accent-lavender',
  sky: 'bg-accent-sky',
  amber: 'bg-accent-amber',
  rose: 'bg-accent-rose',
  coral: 'bg-accent-coral',
};

export function ForumTagDot({ color }: { color: ForumTagColor | null }) {
  return color ? <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${TAG_DOT[color]}`} /> : null;
}

function TagChip({ tag }: { tag: ForumTag }) {
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1 rounded border border-border-soft px-1.5 text-label text-txt-secondary">
      <ForumTagDot color={tag.color} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/** A choice of tags: for the filter, for a new post, for one that exists. */
function TagToggle({ tag, label, pressed, disabled, onClick }: {
  tag?: ForumTag;
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={`inline-flex h-7 max-w-full flex-shrink-0 items-center gap-1.5 rounded-md border px-2 text-meta font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed
          ? 'border-accent-primary bg-accent-primary/[0.12] text-txt-primary'
          : 'border-border-soft text-txt-secondary hover:border-interactive-muted hover:text-txt-primary'
      }`}
    >
      {tag && <ForumTagDot color={tag.color} />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function PostRow({ post, tags, origin, active, unread }: {
  post: ForumPost;
  tags: readonly ForumTag[];
  origin: string;
  active: boolean;
  unread: boolean;
}) {
  const { t } = useTranslation('chat');
  const { formatRelativeTime } = useFormatters();
  const authorName = post.author ? post.author.displayName || post.author.username : t('forum.unknownAuthor');
  const shownTags = post.tagIds.flatMap((id) => tags.find((tag) => tag.id === id) ?? []);
  return (
    <li>
      <button
        type="button"
        onClick={() => openThreadView(post.id, post.parentChannelId)}
        aria-current={active ? 'true' : undefined}
        className={`surface-card lift flex w-full gap-3 rounded-lg p-3.5 text-left ${active ? '!border-accent-primary' : ''}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {unread && <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-txt-primary" />}
            <span className={`min-w-0 break-words text-body leading-snug text-txt-primary ${unread ? 'font-semibold' : 'font-medium'}`}>{post.name}</span>
          </span>
          {post.preview && <span className="mt-1 line-clamp-2 block break-words text-ui leading-[1.45] text-txt-secondary">{post.preview}</span>}
          {shownTags.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1">
              {shownTags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
            </span>
          )}
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-txt-tertiary">
            <span className="flex min-w-0 items-center gap-1.5">
              {post.author && <Avatar src={resolveAssetUrl(post.author.avatar, origin)} name={authorName} size={16} user={post.author} />}
              <span className="min-w-0 truncate">{authorName}</span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-1">
              <Icon name="message" size={13} />
              {t('forum.messages', { count: post.messageCount })}
            </span>
            <time className="flex-shrink-0" dateTime={new Date(post.lastMessageAt ?? post.createdAt).toISOString()}>
              {formatRelativeTime(post.lastMessageAt ?? post.createdAt)}
            </time>
          </span>
        </span>
        {post.thumbnail && (
          <img
            src={getApiForOrigin(origin).uploads.url(post.thumbnail)}
            alt=""
            loading="lazy"
            className="h-16 w-16 flex-shrink-0 rounded-md object-cover desktop:h-20 desktop:w-20"
          />
        )}
      </button>
    </li>
  );
}

/** A post's title and first message. Files go in the post itself once it is up: it opens right after this. */
function NewPostDialog({ channel, tags, onClose }: { channel: Channel; tags: readonly ForumTag[]; onClose: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const fieldId = useId();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const atLimit = tagIds.length >= FORUM_LIMITS.TAGS_PER_POST;
  const ready = title.trim().length > 0 && content.trim().length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const post = await getApiForOrigin(getChannelOrigin(channel.id)).forums.createPost(channel.id, { title: title.trim(), content: content.trim(), tagIds });
      useForumStore.getState().addPost(channel.id, post);
      onClose();
      openThreadView(post.id, channel.id);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('chat:forum.compose.title')} mobileStyle="sheet">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
        <div>
          <label htmlFor={`${fieldId}-title`} className="field-label">{t('chat:forum.compose.titleLabel')}</label>
          <input
            id={`${fieldId}-title`}
            type="text"
            value={title}
            onChange={(change) => setTitle(change.target.value.slice(0, THREAD_LIMITS.NAME_MAX_LENGTH))}
            className="input-standard w-full"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-content`} className="field-label">{t('chat:forum.compose.contentLabel')}</label>
          <textarea
            id={`${fieldId}-content`}
            value={content}
            onChange={(change) => setContent(change.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            rows={6}
            className="input-standard w-full resize-y"
          />
          <p className="mt-1.5 text-meta text-txt-tertiary">{t('chat:forum.compose.filesHint')}</p>
        </div>
        {tags.length > 0 && (
          <fieldset>
            <legend className="field-label">{t('chat:forum.compose.tagsLabel', { max: FORUM_LIMITS.TAGS_PER_POST })}</legend>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const pressed = tagIds.includes(tag.id);
                return (
                  <TagToggle
                    key={tag.id}
                    tag={tag}
                    label={tag.name}
                    pressed={pressed}
                    disabled={!pressed && atLimit}
                    onClick={() => setTagIds((current) => (pressed ? current.filter((id) => id !== tag.id) : [...current, tag.id]))}
                  />
                );
              })}
            </div>
          </fieldset>
        )}
        <div className="flex justify-end pt-1">
          <div className="action-bar">
            <button type="button" onClick={onClose} className="btn-quiet">{t('common:actions.cancel')}</button>
            <button type="submit" disabled={!ready || busy} aria-busy={busy} className="btn-primary">
              {busy ? t('chat:forum.compose.submitting') : t('chat:forum.compose.submit')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** A forum: its posts, the latest activity first, and a way to start one. The posts themselves are threads. */
export function ForumView({ channel }: { channel: Channel }) {
  const { t } = useTranslation('chat');
  const channelId = channel.id;
  const origin = getChannelOrigin(channelId);
  const list = useForumStore((s) => s.lists[channelId]);
  const load = useForumStore((s) => s.load);
  const loadMore = useForumStore((s) => s.loadMore);
  const forget = useForumStore((s) => s.forget);
  const openThreadId = useThreadStore((s) => s.open?.threadId);
  const unreadChannels = useChatStore((s) => s.unreadChannels);
  const permissions = useSpaceStore((s) => s.channelPermissions.get(channelId));
  const [composing, setComposing] = useState(false);
  const canPost = hasPermissionBit(permissions, PermissionBits.SEND_MESSAGES) && hasPermissionBit(permissions, PermissionBits.CREATE_THREADS);

  useEffect(() => {
    void load(channelId, null);
    return () => forget(channelId);
  }, [channelId, load, forget]);

  const tags = useMemo(() => list?.tags ?? [], [list?.tags]);
  const tagId = list?.tagId ?? null;
  const posts = list?.posts ?? [];
  const loading = list?.loading ?? true;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-border-hard">
        <div className="mx-auto flex w-full max-w-4xl items-start gap-3 px-3 py-2.5 desktop:px-5">
          {tags.length > 0 ? (
            <div role="group" aria-label={t('forum.filterLabel')} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              <TagToggle label={t('forum.allTags')} pressed={tagId === null} onClick={() => void load(channelId, null)} />
              {tags.map((tag) => (
                <TagToggle key={tag.id} tag={tag} label={tag.name} pressed={tagId === tag.id} onClick={() => void load(channelId, tag.id)} />
              ))}
            </div>
          ) : <div className="flex-1" />}
          {canPost && (
            <button type="button" onClick={() => setComposing(true)} className="btn-primary btn-sm flex-shrink-0">
              <Icon name="plus" size={14} />
              {t('forum.newPost')}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list?.error && <p role="alert" className="mx-4 mt-3 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{list.error}</p>}
        {loading ? (
          <div role="status" aria-label={t('forum.loading')} className="flex h-40 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" />
          </div>
        ) : posts.length === 0 && !list?.error ? (
          <div className="empty-state h-full">
            <span aria-hidden="true" className="empty-state-icon"><Icon name="forum" size={18} /></span>
            <p className="empty-state-title">{tagId ? t('forum.emptyFiltered.title') : t('forum.empty.title')}</p>
            <p className="empty-state-body">{tagId ? t('forum.emptyFiltered.body') : t('forum.empty.body')}</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl p-3 desktop:p-5">
            <ul className="stagger flex flex-col gap-2">
              {posts.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  tags={tags}
                  origin={origin}
                  active={openThreadId === post.id}
                  unread={unreadChannels.has(post.id) && openThreadId !== post.id}
                />
              ))}
            </ul>
            {list?.nextBefore && (
              <div className="mt-3 flex justify-center">
                <button type="button" onClick={() => void loadMore(channelId)} disabled={list.loadingMore} aria-busy={list.loadingMore} className="btn-quiet">
                  {t('forum.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {composing && <NewPostDialog channel={channel} tags={tags} onClose={() => setComposing(false)} />}
    </div>
  );
}

/** What stands above a post's messages: its whole title, which the panel's bar cuts off, and its tags. */
export function ForumPostHead({ thread }: { thread: ThreadInfo }) {
  const tags = useForumStore((s) => s.lists[thread.parentChannelId]?.tags);
  const listed = useForumStore((s) => s.lists[thread.parentChannelId]?.posts.find((post) => post.id === thread.id));
  const name = listed?.name ?? thread.name;
  const shown = (listed?.tagIds ?? thread.tagIds ?? []).flatMap((id) => tags?.find((tag) => tag.id === id) ?? []);
  return (
    <div className="mx-4 mt-4 border-b border-border-hard pb-4">
      <h2 className="break-words text-title font-semibold leading-snug tracking-[-0.01em] text-txt-primary">{name}</h2>
      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {shown.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        </div>
      )}
    </div>
  );
}

/** The tags of a post, in the header of its thread, for who may change them. */
export function ForumPostTagsButton({ thread }: { thread: ThreadInfo }) {
  const { t } = useTranslation(['chat', 'common']);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<ForumTag[] | null>(null);
  const [selected, setSelected] = useState<string[]>(thread.tagIds ?? []);
  const [busy, setBusy] = useState(false);
  const client = () => getApiForOrigin(getChannelOrigin(thread.parentChannelId));

  const start = async () => {
    setOpen(true);
    try {
      const { tags: list } = await client().forums.tags(thread.parentChannelId);
      setTags(list);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
      setOpen(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await client().forums.setPostTags(thread.id, selected);
      setOpen(false);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const atLimit = selected.length >= FORUM_LIMITS.TAGS_PER_POST;
  return (
    <>
      <button type="button" onClick={() => void start()} title={t('chat:forum.tags.edit')} aria-label={t('chat:forum.tags.edit')} className="icon-btn">
        <Icon name="tag" size={15} />
      </button>
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title={t('chat:forum.tags.editTitle')} mobileStyle="sheet">
          {tags === null ? (
            <div role="status" aria-label={t('chat:forum.loading')} className="flex h-20 items-center justify-center">
              <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" />
            </div>
          ) : tags.length === 0 ? (
            <p className="text-ui text-txt-secondary">{t('chat:forum.tags.none')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const pressed = selected.includes(tag.id);
                  return (
                    <TagToggle
                      key={tag.id}
                      tag={tag}
                      label={tag.name}
                      pressed={pressed}
                      disabled={!pressed && atLimit}
                      onClick={() => setSelected((current) => (pressed ? current.filter((id) => id !== tag.id) : [...current, tag.id]))}
                    />
                  );
                })}
              </div>
              <div className="flex justify-end">
                <div className="action-bar">
                  <button type="button" onClick={() => setOpen(false)} className="btn-quiet">{t('common:actions.cancel')}</button>
                  <button type="button" onClick={() => void save()} disabled={busy} aria-busy={busy} className="btn-primary">{t('common:actions.save')}</button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
