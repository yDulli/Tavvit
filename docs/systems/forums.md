# Forums and announcement channels

Two more kinds of channel in a space. A **forum** holds posts instead of a running conversation. An **announcement channel** is written by a few and read by everyone, and other spaces can **follow** it.

**Files:** `packages/shared/src/forums.ts`, `packages/shared/src/channelFollows.ts`, `packages/server/src/utils/forums.ts`, `packages/server/src/routes/forums.ts`, `packages/server/src/routes/channelFollows.ts`, `packages/server/src/utils/attachmentCopies.ts`, `packages/web/src/stores/forumStore.ts`, `packages/web/src/utils/channelKinds.ts`, `packages/web/src/components/chat/ForumView.tsx`, `FollowChannelButton.tsx`, `packages/web/src/components/modals/ForumTagsTab.tsx`, `ChannelFollowsSection.tsx`.

## A post is a thread

A post is a row in `channels` with `type = 'thread'`, the forum as `parent_channel_id`, and `thread_starter_message_id` null, because it grew from no message: its first message is inside it. Everything else comes from [threads.md](threads.md): messages, files, reactions, read state, search, following, unread counts, going quiet after 7 days, the rights of the parent, renaming and deleting. So a forum needed no second kind of conversation.

`POST /api/channels/:id/posts` takes `{ title, content?, tagIds?, attachments?, spoilerAttachments? }`. A title and something to say are both needed. It takes VIEW_CHANNEL, SEND_MESSAGES and CREATE_THREADS in the forum, and ATTACH_FILES for files. The space's rules read the title as well as the words (`spaceMessageRefusal`, kind `post`), since the title is read out in the list. The forum's slow mode counts posts, not what is said in them. Whoever starts a post follows it, and `thread_followed` reaches their client before the first message, or the message would have nowhere to go.

**A forum holds no messages of its own.** `POST /api/channels/:id/messages` answers 400 `forum_takes_posts`, and so do polls and everything else that writes through `spaceMessageRefusal` with kind `create`. A forum takes no webhooks, and threads cannot grow in it from a message (there are none).

## Tags

`forum_tags` holds up to 20 per forum (`FORUM_LIMITS`), each with a name of up to 24 characters, unique in the forum without regard to case, and a colour of the accent family or none (`FORUM_TAG_COLORS`, never the violet signal). `PUT /api/channels/:id/forum-tags` takes all of them at once and takes MANAGE_CHANNELS; a tag keeps its id if the request names it, and one left out leaves every post it was on. `forum_tags_updated` tells who can see the forum.

`forum_post_tags` puts up to 5 on a post. They are chosen when posting, or changed by who started it or someone with MANAGE_MESSAGES (`PUT /api/threads/:id/tags`). A tag has to be the forum's own (`forum_tag_unknown`).

## The list

`GET /api/channels/:id/posts?tag=&before=` answers the tags and a page of 30, by the latest activity: a new word brings a post to the top. The order is worked out in one place (`forumPostOrder`), from the newest message or the moment it was made, with the id to break ties; `before` is `<activity>:<id>`, which stays right while posts move, unlike an offset. Quiet posts stay in the list: going through a forum's old answers is what a forum is for.

Each entry is a `ThreadInfo` plus the tags, the author, 200 characters of the first message and its first picture. **What a spoiler hides stays out of both**: the preview leaves out what is between the marks, and a spoiler picture gives no thumbnail.

The list stays live for whoever has the forum open: `thread_updated` goes to everyone who can see the parent and brings the post up, and a post the list has not seen makes it ask again, since the event does not hold all of it. `forumStore` keeps one list per forum, with its filter.

**No bold forum.** A forum has no messages, so nothing marks it unread in the sidebar when a post arrives. Whoever follows a post sees it unread like any thread.

## Surfaces

- **Window:** `ForumView` in place of the message list. A post opens in `ThreadPanel`, where `ForumPostHead` stands above the messages with the whole title and tags, since there is no message to start from.
- **Phone:** the same `ForumView` in `MobileChatScreen`, and a post opens as the `thread` screen. The dialog for a new post is a sheet.
- `MainContent` and `MobileChatScreen` branch on the type, and `channelIconName` says what stands in front of a channel's name everywhere.
- Tags are the tab "Tags" of the channel's settings (`ForumTagsTab`).
- The new post dialog has a title, words and tags. Files go in the post right after it opens, through the composer, because uploads run through it; the API takes `attachments` directly.

## Announcement channels

`type = 'announcement'`. It holds messages, threads and webhooks like a text channel (`channelTakesThreads`, `channelTakesWebhooks`, `routes/threads.ts`, `routes/webhooks.ts`).

**Who may write is an ordinary override.** Making one, or turning a text channel into one, denies @everyone SEND_MESSAGES on the channel (`setAnnouncementOverride`), which then shows in the channel's permissions like any override and can be changed there. So there is no second rule to keep in step: the owner, administrators and whoever the channel's permissions allow can write. Turning it back into a text channel lifts that denial and **ends its follows** (`endFollowersOf`). `PATCH /api/channels/:id` changes `type` only between these two; anything else answers `channel_type_change_invalid`, since a voice channel or a forum holds other things.

### Following

`channel_follows` (source, target, `account_id`, `created_by`, unique pair) has an announcement channel's posts arrive in a text channel of **another space on the same instance**. From the source side it takes only seeing the channel; on the target it takes VIEW_CHANNEL and MANAGE_WEBHOOKS, because both a webhook and a follow let something write there, and someone timed out in the target space cannot do it. Up to 25 follows on a source, 10 on a target (`FOLLOW_LIMITS`). `GET /api/channels/:id/follow-targets` offers only where this person may have them arrive. Either end can stop it, for who may manage it there (`DELETE /api/channel-follows/:id`); what arrived stays.

**The source must be open:** an announcement channel @everyone can see (`follow_source_private`, `everyonePermissions`). Following must not carry what is closed out of a space. A channel that closes later simply passes nothing on until it opens again.

**What arrives.** `copyToFollowers` listens to `connectionManager.onChannelMessage`, so every route that makes a message feeds it. Each post becomes a new message in the target:

- under an **account of kind `follow`**, one per follow, with the same exclusions as a webhook's ([webhooks.md](webhooks.md), "Accounts that are not people"). Its name is `Night Shift · #news`, and follows a rename from the next post on;
- **without mentions** (`withoutMentions`): nobody is alerted, and `@everyone` is a plain word;
- marked as forwarded, with the mark "Followed" at the name; no author card, since there is no person behind it;
- **read by the target space's automatic rules** like anything written there. What they refuse is not copied, and nobody is told;
- **with its files** as hard links where the disk allows (`copyAttachments`, `share: true`), so a file followed by 25 channels takes the room of one. Deleting one copy leaves the others.

**What does not arrive, on purpose:**

- **A later edit or deletion.** A copy is a copy, as with a forwarded message. The privacy draft says so.
- **A poll:** its votes belong to the channel it was asked in.
- **Copies themselves:** what a `follow` account wrote is not passed on, so follows cannot make a chain or a loop.
- **Messages of the system**, such as "someone pinned".
- **Other instances:** a follow names channels by id on one instance. Going across instances would need a relay event of its own.

Each space sees a follow in its own audit log, under its own channel with the other end beside it (`channel_follow_create`, `channel_follow_delete`). The maker's id is cleared by `tombstoneUser` and the follow goes on, since it belongs to the two channels. `channel-follows-made.jsonl` in the personal export lists the follows someone made. An account of kind `follow` is removed by the sweep with the webhook accounts once it wrote nothing and nothing follows through it.

## Every check of a channel's type

Going through them is what makes a new type safe. What each says now:

| Where | Rule |
|-------|------|
| `routes/channels.ts` | Creating takes `text`, `voice`, `announcement`, `forum`. A thread comes only from `routes/threads.ts` or `routes/forums.ts`. |
| `utils/spaceModeration.ts` | `create` in a forum answers `forum_takes_posts`. |
| `routes/threads.ts` | A thread grows from a text or announcement channel. |
| `routes/webhooks.ts` | A text or announcement channel; a forum answers `webhook_not_allowed`. |
| `utils/threads.ts` | A summary has `tagIds` when the starter is null. |
| `routes/forward.ts`, `ForwardMessageModal` | No forwarding into a forum. |
| `shared/src/discordImport.ts` | Discord's announcement (5) and forum (15) come over as themselves. |
| `MainContent`, `MobileChatScreen` | A forum shows `ForumView` and no composer. |
| `channelIconName` | Every place that shows a channel's name. |
| `EventFormModal`, `WelcomePanel` | A forum and an announcement channel can be an event's place or on the welcome page. |

`routes/communityChannels.test.ts` holds the server's side of this.

## Limits

- An edit or deletion does not reach the copies. Documented, and said in the privacy draft.
- A follow stays on one instance.
- No unread mark on a forum itself, see above.
- Files in a new post go in right after it opens, not in the dialog.
