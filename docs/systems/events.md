# Events

A space's plans: a time, a place, who is going. One event at a time; no series yet.

**Files:** `packages/shared/src/events.ts`, `packages/server/src/routes/events.ts`, `packages/server/src/utils/eventReminders.ts`, `packages/web/src/stores/eventStore.ts`, `packages/web/src/utils/eventCalendar.ts`, `packages/web/src/components/events/`.

## Tables

`space_events` (`space_id` cascades, `channel_id` is set null when the channel goes, `created_by` is cleared when that account goes) and `space_event_rsvps` (one row per person going; both foreign keys cascade, and `tombstoneUser` removes a deleted account's rows). See [database.md](database.md).

## Who may do what

| Route | Rule |
|-------|------|
| `GET /api/spaces/:id/events` | Members. What is coming up, and what ended within the last day (`EVENT_KEPT_AFTER_MS`), by start. Each with `going` and the reader's `amGoing`. |
| `POST /api/spaces/:id/events` | Bit 18 `MANAGE_EVENTS`. `{ title, description?, location?, channelId?, startsAt, endsAt? }`. It has to start in the future and end after it starts. A channel has to be of this space and one the writer can see, and not a thread. At most `UPCOMING_MAX` (100) coming up (`event_limit_reached`). |
| `PATCH /api/events/:id` | `MANAGE_EVENTS`, or who announced it while a member. The same fields. Moving the start clears the reminder's mark, so those going hear of the new time. |
| `DELETE /api/events/:id` | The same. Those going go with it. |
| `PUT`, `DELETE /api/events/:id/rsvp` | Members; taking an answer back needs no membership. Twice counts once. |
| `GET /api/events/:id/attendees` | Members: at most `ATTENDEES_MAX` (100) people, through `sanitizeUser`. |

Announcing, changing and calling off are in the space's audit log (`event_create`, `event_update`, `event_delete`). An answer is not.

## Events on the socket

`event_updated` and `event_deleted` go to the space (`sendToSpace`). What goes to everyone says how many are going and neither who nor whether the reader is: the client keeps its own `amGoing` (`eventStore.applyUpdate`), which comes from the list and from the answers to its own requests.

## The reminder

`utils/eventReminders.ts` looks once a minute for events starting within `EVENT_REMINDER_BEFORE_MS` (15 minutes) with no `reminder_sent_at`, sets it, and tells those going: `event_reminder` over the socket, and a push (`pushEventReminder`, [push.md](push.md)). A server that was down through the moment says nothing afterwards: the condition is that the event has not started.

In the client the reminder is a toast and, in an unfocused window, a notification when Do Not Disturb is off.

## The page

The route `/channels/:spaceId/events` sits before `/channels/:spaceId/:channelId?`, so `useParams` has no channel there and nothing mistakes the word for a channel id. `AppLayout` shows `SpaceEventsPage` in the channel's place, keeps its redirect to the last channel out of it, and closes an open thread. On a phone it is the `space-events` screen, and `useMobileRouteSync` takes the address to that screen rather than to a chat, since a reminder links there.

The way in is the row at the top of a space's channels (`SpaceEventsRow`), with a muted count of what is coming up: a count of events is no unread state, so it does not use the signal colour.

A card offers: answering, who is going, joining the voice channel or opening the text channel it names, and a calendar file. `eventCalendarText` writes RFC 5545 by hand, with no dependency: moments in UTC so a calendar shows them in its reader's zone, text escaped, lines folded at 75 octets without splitting a character. An event with no stated end lasts an hour in the calendar. `saveBlob` hands it over.

## Federation

Space functions go to the space's home instance, so everything here uses the client of `space._instanceOrigin`, and the store's key includes the origin, since two instances' spaces may share an id. Nothing about an event crosses to a peer. A person homed elsewhere who is a member of the space answers through that instance, and is reminded by its socket and only by a push of that instance if their device is registered there ([push.md](push.md)).

## Privacy

The draft says that the members of a space can see who is going, and that a reminder is sent. A person's export lists the events they announced and answered (`events-announced.jsonl`, `event-answers.jsonl`).
