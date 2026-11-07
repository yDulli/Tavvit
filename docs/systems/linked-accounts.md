# Linked accounts

Accounts elsewhere a person proves are theirs by signing in there, and shows on their profile: so far a Twitch account (1.35.1). A linked Twitch account also shows its owner as live while they stream (activity-presence.md, "Live on Twitch"). Linking is the only way to be shown live: a Twitch address among the profile's typed links does nothing (1.35.0 read those, which let anyone claim any channel).

Source files:
- `packages/shared/src/types.ts`: `LINKED_ACCOUNT_PROVIDERS`, `ProfileLinkedAccount`, `LinkedAccountView`, the request and response types, `User.linkedAccounts`, `InstanceInfoResponse.linkedAccounts`, the `linked_accounts_update` event
- `packages/shared/src/linkedAccounts.ts`: the return path, the service's name, the account's page (`linkedAccountUrl`), the rules a profile's list is read by (`normalizeProfileLinkedAccounts`, `parseStoredProfileLinkedAccounts`)
- `packages/shared/src/twitch.ts`: Twitch logins and channel pages
- `packages/server/src/utils/linkedAccounts.ts`: pending states, the rows, the profile's list, announcing a change
- `packages/server/src/utils/linkedAccountProviders.ts`: which services this instance offers
- `packages/server/src/utils/twitchApi.ts`: the questions to Twitch (sign-in address, code → account, revoking, live streams)
- `packages/server/src/routes/linkedAccounts.ts`: the routes
- `packages/web/src/components/modals/settingsPanels/LinkedAccountsPanel.tsx`: Settings → Linked accounts
- `packages/web/src/components/linkedAccounts/LinkedAccountReturnPage.tsx`: `/linked-accounts/:provider`, where the service sends the person back
- `packages/web/src/components/ui/ProfileLinks.tsx`: the profile's links, linked accounts first
- `packages/web/src/stores/linkedAccountsStore.ts`: one's own list for the settings

---

## Setting it up

`TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` from an application at https://dev.twitch.tv/console/apps (category "Website Integration", client type "Confidential"). Its OAuth redirect URL must be exactly `<APP_BASE_URL>/linked-accounts/twitch`: `config.twitch.redirectUri`, built from `APP_BASE_URL`, else `PUBLIC_ORIGIN`, else `https://DOMAIN`, never from a request. On tavvit.com that is `https://tavvit.com/linked-accounts/twitch`; the server logs it at start. One variable without the other, or either without an address for the app, refuses to boot. Without them the service is not offered: `InstanceInfoResponse.linkedAccounts` is `[]`, the settings tab is hidden (unless something is still linked, so it can be unlinked), and nothing asks Twitch.

## Linking, and why it is one's own account

1. **Start.** `POST /api/users/@me/linked-accounts/twitch/start` (the person's session) makes a `state` of 32 random bytes, bound to that account and good for ten minutes (`LINKING_TTL_MS`), kept in memory (a restart ends it; at most 10,000, the oldest go). A new start ends the account's earlier state. It answers Twitch's sign-in address: `client_id`, the redirect URL, `response_type=code`, an empty `scope` (who signed in needs no permission), the state and `force_verify=true` (Twitch asks every time, so the person sees which account they link).
2. **At Twitch.** The browser goes there: in a browser this tab (`location.assign`), in the desktop app the system browser (`window.open`, which the main process hands to `shell.openExternal`). Twitch sends it back to `/linked-accounts/twitch?code=…&scope=&state=…`, or with `error=access_denied` when the person cancelled.
3. **Complete.** That page (`LinkedAccountReturnPage`) takes the code out of the address bar and history at once, then calls `POST /api/users/@me/linked-accounts/twitch` `{ code, state }` with the session of whoever is signed in in that browser. Signed out, it keeps what Twitch handed back in this tab's `sessionStorage`, sends the person to `/login?redirect=/linked-accounts/twitch`, and goes on after the sign-in.
4. **On the server.** The state must be one this very account started (`takeLinking`): unknown, expired or used is `linked_account_expired`; started by another account is `linked_account_other_account`, and the state stays for its owner. Only then is the code exchanged (`twitchIdentityOfCode`): the code buys a token, `GET /helix/users` with it names the account (`id`, `login`, `display_name`), and the token is revoked before the route answers, whatever happened. No token is stored; Twitch's refresh token is never read. A code Twitch refuses is `linked_account_expired` (Twitch's words go to the log, the code never); Twitch not answering is `linked_account_failed`.
5. **Stored.** `linkAccount` in one transaction: a Twitch account already linked to another account here is `linked_account_taken`; linking another Twitch account replaces the person's earlier one and keeps their choices. Then the profile's list is written, and the change is announced (below). A round of the live check follows two seconds later (`checkTwitchLiveSoon`), so someone who links while live shows within seconds.

So a link cannot be made for someone else: whoever is sent a sign-in address started by another account completes nothing, because the page completes for the account signed in in their browser, and the server only takes a state from the account that started it. The desktop app is no exception: the link is completed in the browser, signed in there as the same account.

## What is stored

`linked_accounts` (database.md): `id`, `user_id` (cascade), `provider`, `provider_user_id` (Twitch's id, what stays across a rename), `login`, `display_name`, `show_on_profile`, `show_live` (both 1 at first), `created_at` (when linked; a different account at the service is a new date), `updated_at`. Unique per (`user_id`, `provider`) and per (`provider`, `provider_user_id`).

`users.profile_linked_accounts`: what the profile shows, the rows with `show_on_profile`, as a JSON list of `{ provider, login, name }` (`writeProfileLinkedAccounts`). It is a column of the user so that every list of people reads it with the rest of the profile (`PUBLIC_USER_COLUMNS`); `publicUserOf` reads it by the shared rules into `User.linkedAccounts`. A tombstone clears it, and account deletion deletes the rows by hand (the tombstone keeps the user's row, so the cascade never fires). The personal export has the rows in `settings.json` (`linkedAccounts`).

A rename at Twitch reaches the row through the live check: an answer about a live stream names the account's current login and name, and `noteLinkedAccountName` writes them when they differ. An account that never streams keeps its old name until it is linked again.

## Showing it

- **Profile** (`ProfileLinks`, on the card and the full profile): under "Links", the linked accounts first, as the service's mark, the name and a check; each leads only to the account's own page, built from its login (`linkedAccountUrl`), with `target="_blank"` and `rel="noopener noreferrer nofollow"`. A typed link to the same page is left out. A row the shared rules refuse (a login Twitch would not give, a name too long) is left out.
- **Settings → Linked accounts** (`LinkedAccountsPanel`, `settings:nav.tabs.linkedAccounts`, in the user group; also on the phone): per service, "Link Twitch" (`.btn-primary`) or the account with its page and date, "Unlink", and two switches: "Show on my profile" and "Show when I'm live" (with a note when sharing activity is off, which hides it anyway). In the desktop app a line says that Twitch opened in the browser; the panel shows the account when `linked_accounts_update` arrives.
- **Announcing a change** (`announceLinkedAccounts`): when the profile's list changed, `user_updated` to the person (own view) and everyone who sees the profile (`announceProfileChange`, utils/profileBroadcast.ts); always `linked_accounts_update` with the person's list to their own sockets. A client takes the event from its home only.

## Routes

All for the person's own account, homed here (`linked_account_home_only` for a copy of an account homed elsewhere), not for bots, rate-limited. See api.md, "Linked accounts".

## Across instances

A person links on their home. The live stream reaches peers as an activity with `source: 'twitch'` (activity-presence.md). The profile's list is part of the profile the home serves, like the typed links: a client connected to the person's home shows it, and a copy of the person on another instance has none (`profile_update` does not carry it).

## Known limits

- A pending link lives in memory: a restart in the ten minutes ends it, and the person starts again.
- An account that never streams keeps its old name after a rename at Twitch until it is linked again.
- The desktop app's link is completed in the system browser, which must be signed in to the same account (it asks).
- One account per service per person.
