# Threads

A side conversation that grows from one message of a text or announcement channel, so it does not run through the channel. A forum's post is a thread too, one that grew from no message: [forums.md](forums.md).

**Files:** `packages/shared/src/threads.ts`, `packages/server/src/utils/threads.ts`, `packages/server/src/routes/threads.ts`, `packages/web/src/stores/threadStore.ts`, `packages/web/src/components/chat/ThreadPanel.tsx`, `ThreadsPopover.tsx`, `ThreadChip.tsx`, `packages/web/src/components/layout/FollowedThreadRows.tsx`, `MobileThreadScreen.tsx`.

## A thread is a channel

A row in `channels` with `type = 'thread'`, `parent_channel_id`, `thread_starter_message_id` and `thread_created_by`. Its messages are ordinary rows in `messages` with its id as `channel_id`. So messages, files, reactions, typing, polls, search and read state work without any code of their own: `MessageList channelId={thread.id}` and `MessageInput channelId={thread.id}` are the same components as anywhere.

Three rules keep that from leaking:

- **Rights.** `computePermissions` resolves a thread to its parent at the start, in that one place. A thread has no overrides of its own. Closing the channel closes its threads. `CREATE_THREADS` (bit 17) starts one; writing in one takes SEND_MESSAGES in its channel.
- **Listings.** Every read of "a space's channels" says `type != 'thread'`: `GET /api/spaces/:id/channels`, `GET /api/spaces/:id`, the channel layout, `ready`, Explore, the Discord import. Reads that mean "everything in the space" keep them, on purpose: deleting a member's recent messages, read states when someone leaves, the attachments when a space goes.
- **A channel's routes** answer 404 for a thread: rename, delete and overrides go through `routes/threads.ts`.

Threads exist only in a space's text and announcement channels, and as the posts of a forum: not in conversations, not in a voice channel's chat, not inside another thread. A message has at most one (`idx_channels_thread_starter`), and starting a second opens the first. The thread stays when the message it grew from is deleted (`ON DELETE SET NULL`, written by hand in migration 0056 because the generator leaves the action out of `ALTER TABLE ADD`), and goes with its channel.

## Who hears what

A thread's events go to those who follow it (`thread_members`) or have it open (`thread_watch`, per socket), not to the whole channel: `sendToChannel` narrows its audience when the channel is a thread. Everyone in the channel gets `thread_updated`, which is what the message it grew from shows (`message.thread`: name, how many messages, when the last one was).

**Following.** Whoever starts a thread, writes in it or is named in it (`<@id>`, with the right to see it) follows it from then on; `@everyone` makes no followers. Following can be turned off, and writing again turns it back on. A followed thread alerts on every message, unless the settings of its channel say nothing at all (`followedThreadLevel`, for the sound, the notification and the push). Leaving the space stops following.

**Unread.** `ready` lists the followed threads (`followedThreads`) with their counts. The client registers them in `spaceChannelIndex`, so their ids resolve like a channel's, with `type: 'thread'` and `parentChannelId`. Readers of the index that mean channels leave them out (the quick switcher), and `replaceSpaceChannels` does not drop them when a listing does not name them.

**Quiet threads.** A thread with no new message for 7 days leaves its channel's list for the archive. This is worked out from the last message, nothing is closed: the thread still takes messages, and a new one brings it back. `ready` leaves quiet ones out of the sidebar.

## Addresses

A thread has no address of its own. `/channels/<space>/<channel>?thread=<id>&message=<id>` opens the channel and, on it, the thread at that message; `MainContent` and `MobileChatScreen` take the parameters once and remove them. `messagePath` builds the right one, so the inbox and a push lead there.

## Surfaces

- **Window:** `ThreadPanel` in the right column, in place of the member list, while a thread is open (`useThreadStore.open`). Going to another channel closes it.
- **Phone:** `MobileThreadScreen`, pushed on the stack as `thread`.
- `openThreadView` picks between them.
- `ThreadChip` under the message, `ThreadsPopover` in the channel's header, `FollowedThreadRows` under the channel in the sidebar, a menu entry and a button in the message's toolbar.

## Audit and data

`thread_create`, `thread_update` and `thread_delete` are in the space's audit log. Renaming and deleting are for who started it or MANAGE_MESSAGES. Deleting takes everything said in it and keeps the message it grew from. A thread's name passes the space's word filter when someone chooses it. `tombstoneUser` removes an account's follows; its messages in threads go by the same rules as any channel's and appear in the data export under the thread's name.

## Where else this shows

Followed threads stand under their channel in the sidebar and in the phone's list of a space's channels.
