# Email

Mail about accounts: confirming an address, resetting a forgotten password, telling an address about changes. No marketing, and no mail about messages.

**Off by default.** `EMAIL_TRANSPORT` unset means no worker, no webhook route, no outbound connection, and no feature that needs mail: the client hides addresses, "forgot password" and the prompt, because `/api/instance/info` says `email: false`. An instance that never sets it behaves as it always did.

Files: `packages/server/src/email/` (`service.ts` the queue and the links, `account.ts` what happens to an address, `gate.ts`, `address.ts`, `copy.ts` the words, `templates.ts`, `resendTransport.ts`, `smtpTransport.ts`), `routes/email.ts`. Client: `components/auth/{ForgotPasswordPage,ResetPasswordPage,VerifyEmailPage}.tsx`, `settingsPanels/EmailSection.tsx`, `instanceSettingsPanels/EmailPanel.tsx`, `ui/EmailPromptBar.tsx`, `MailLanguageController.tsx`.

---

## Configuration

| Variable | Means |
|---|---|
| `EMAIL_TRANSPORT` | `none` (default), `resend` or `smtp` |
| `EMAIL_FROM` | Required with a transport. `"Tavvit <no-reply@example.com>"`, in quotes |
| `EMAIL_REPLY_TO` | Optional. Where a reply goes |
| `APP_BASE_URL` | Where links in mail lead. Default: `PUBLIC_ORIGIN`, then `https://DOMAIN`. **Never taken from a request**: a link built from the `Host` header is how reset poisoning works |
| `EMAIL_DAILY_LIMIT`, `EMAIL_MONTHLY_LIMIT` | Default 100 and 3000 for `resend` (its free plan), none for `smtp`. `0` means none |
| `RESEND_API_KEY` | Required with `resend`. A sending-only key, restricted to the domain |
| `RESEND_WEBHOOK_SECRET` | Optional, and without it this server hears nothing of bounces. Registers the webhook route |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (false), `SMTP_USER`, `SMTP_PASS` | Required host with `smtp`. With a user, TLS is required; a login is never sent in the clear |

A half-filled setting refuses to boot (`config.ts`). A transport that does not answer only warns: chat starts without mail. Everything else boots without any of these, because `update.sh` never writes `.env`.

**Why not the Resend SDK.** The brief asked for it, and this departs from that on purpose: one `fetch` is all that is needed, it reads the quota headers, and the SDK would add a dependency with five releases in sixteen days. `nodemailer` is the only new dependency (MIT-0, no dependencies of its own), for `smtp`.

**Credentials stay on the server.** Nothing about the provider reaches the client; the admin area sees the transport's name, the sender and counts.

---

## For the operator

The `operator_*` kinds go to the administrators with a confirmed address, at most one a day for each cause (operations.md, "Warnings"). They have the same priority as the mail about an account's safety.

## The queue

A route never sends. It writes a row to `email_outbox` in the same transaction as the change the mail reports, and a worker sends it (`enqueueEmail`, `drainEmailOutbox`). So:

- Forgot-password takes as long for an unknown address as for a known one, and it runs after the answer is sent.
- A provider outage does not take sign-up with it.
- Limits, retries and duplicates are in one place.

The body is never stored: it is rendered when it is sent. When a row is done, its address, nonce and parameters go; what stays is a hash of the address, for the limits, and the row itself for seven days.

Nothing logs an address, a link or a provider's words. A provider's message can quote the mail, so only its error name is read. `lastError` holds that name.

| A send ended with | Resend | SMTP | Then |
|---|---|---|---|
| `accepted` | 2xx | 2xx | Counted. Not "delivered": that is never known |
| `retry` | Network, 5xx, 409, `rate_limit_exceeded` | Timeout, 4xx | This row waits (30 s, 1, 5, 15 min, 1 h), and fails when it would outlast its life |
| `hold` | `daily_quota_exceeded`, `monthly_quota_exceeded` | | The whole queue waits for the next UTC day or month |
| `blocked` | 401, 403, `invalid_from_address` | 535, `EAUTH` | The whole queue stops, checked again every 15 minutes |
| `rejected` | Other 4xx | 5xx | This row fails. A refusal of the recipient also suppresses the address |

**Honest failure.** While `blocked` or `held`, `POST /auth/password/forgot` answers `503 email_unavailable` before any account is looked up, so it says something about the instance and nothing about anyone. An address is confirmed only by using its link, never by sending it. The UI says "sent" for "handed over", and shows `lastSend: 'failed'` when a confirmation mail did not go.

### Limits

**Per day and month, by priority.** The budget counts `accepted` in `email_usage_daily`, or the provider's own count when larger (it includes tests from its dashboard). Who goes when it runs low:

| Priority | Kinds | Stops at |
|---|---|---|
| `critical` | `password_reset`, `password_changed`, `username_changed`, `change_requested`, `email_changed`, `email_removed`, `mfa_failures`, `two_factor_on`, `two_factor_off`, `two_factor_reset`, `recovery_regenerated`, `recovery_used` | 100 % |
| `verify` | `verify_email`, `change_email_confirm`, `address_in_use`, `test` | 85 % |
| `notice` | `new_device`, `suspicious_login` | 60 % |

So someone burning the day's mail on purpose cannot take resets with it.

**Per address.** The same mail: once a minute. Per priority: `critical` 10, `verify` 5, `notice` 5 a day. Resets have room of their own, so that using up an address's confirmations cannot lock its owner out.

**Per route.** Forgot 5, reset 10, verify 20 per 15 minutes by address; changing, resending, removing 5 per 15 minutes; the test mail 5 an hour.

**Bounces.** An address that bounced for good or complained is on `email_suppressions` (by hash), and nothing more goes there. Bounces lapse after 30 days, since mailboxes come back; complaints stay. The admin area warns at 4 % bounces and 0.08 % complaints over 30 days, where a provider may pause the whole account, resets included.

**A typo costs nothing.** `domainReceivesMail` asks DNS before a confirmation is queued. Only a clear no refuses (`NXDOMAIN`, no MX and no address, a null MX); the resolver's own trouble refuses nobody.

---

## Links

A link is `{APP_BASE_URL}/verify-email#<token>` or `/reset-password#<token>`.

- **In the fragment,** so it reaches no server log and no Referer. The page takes it out of the address bar as soon as it has read it (`useLinkToken`).
- **A click, not a GET.** Mail scanners open links. The page POSTs when someone presses the button; no GET confirms anything.
- **Hash only.** `email_tokens` holds the SHA-256 of the token. The token is `HMAC-SHA-256(key, nonce)`, with the key derived from `JWT_SECRET` (HKDF), which is not in the database. The queue holds the nonce until the mail went. So reading the database yields no working link, and a retry produces the same link, which is what keeps Resend's idempotency key valid: a fresh token would change the body and get a 409.
- **One per account and purpose.** A new one replaces the last. Using one deletes it, in the transaction that does what it was for. A reset link lives 30 minutes, a confirmation 24 hours; a row in the queue expires before its link does, so no mail arrives with a dead one.

---

## What happens to an address

`users.email`, `email_verified_at`, `pending_email`, `locale`. All local accounts only: replicated rows have none, and none of this is relayed.

**Uniqueness holds among verified addresses only** (a partial unique index). Typing someone's address neither claims it nor reveals it. Two accounts may wait on one address; whichever uses its link first gets it, the other gets `409 email_address_in_use`, which only reaches whoever reads that mailbox.

**An address someone else confirmed** gets `address_in_use` instead of a link. The person typing it sees exactly what they would otherwise see: the same answer, the same `lastSend`, the same limits. `address_in_use`, `verify_email` and `change_email_confirm` therefore share a priority, a cooldown and a daily limit, and `tests` pin this. Registering, adding and changing all go through `sendConfirmationLink`.

**Changing a confirmed address.** Needs the password every time, and the second factor when the account has one. The new address waits in `pending_email`, the old one stays in force and may still reset the password, and hears about it (`change_requested`, with the new address masked). Using the link moves it over, drops reset links, and tells the old address (`email_changed`). The change can be cancelled, which kills the link.

**Removing an address** needs the password and tells the address that was confirmed.

**Signing in by address.** The username stays the login. A confirmed address also works where a username does (`accountNamed`), and shares the throttle count of its account. An unconfirmed address opens nothing.

**Password reset** (`/auth/password/forgot`, `/auth/password/reset`). See auth.md. It leaves 2FA as it is: no mail ever gets past a second factor. It sends only to a confirmed address, never to a replicated account. It sets a new password, ends every session, closes the sockets, tells the address, and signs nobody in. A refused password does not use the link up, and hashing happens only for a live link, so nobody gets 64 MiB of work for a made-up token.

**What is said where.** The account's own view of a user (`sanitizeUser(row, true)`) has the address; nothing else does. `user_updated` goes to the account itself when its link is used in another browser. A data export includes it. `tombstoneUser` clears it, with the tokens and the queue.

**Language.** Mail is written where no browser is there to ask, so `MailLanguageController` tells the server (`PUT /users/@me/locale`) whenever the client's language differs. The words are in `email/copy.ts`, in the five languages, and `email.test.ts` fails when a kind or a placeholder is missing from one.

---

## The gate

`instance_settings.email_required_since`, switched in the admin area under Email (`emailRequired`). Off by default; an upgrade changes nothing for anyone.

While on, a new local account must give an address, and until it is confirmed it gets `403 email_verification_required` on:

| Route | Why |
|---|---|
| `POST /spaces`, `POST /import/discord` for a new space | Creating spaces |
| `POST /dm`, unless a friend or an existing conversation | Approaching strangers |
| `POST /dm/group`, `POST /dm/:id/members`, `POST /dm/space-invite` | The same |
| `POST /social/requests` | The same |

It can still join what it was invited to, write in spaces and talk to friends. Sign-in is never refused: a stuck mail must not be a locked door.

Not concerned: accounts older than the switch, administrators, replicated accounts. It stays closed while mail is down, since lifting it would let a burned quota open the door. The client shows the reason in `EmailPromptBar`, which for an older account is only a suggestion that "not now" puts away for a month.

**Keeps existing accounts:** nobody is asked for anything at an upgrade. The bar suggests an address to accounts without one.

---

## The admin area

`GET /api/admin/email/status`, `POST /api/admin/email/test`, admins only, in Settings → Administration → Email. State, sender, counts, what is waiting, the last error by name, warnings at 80 % of the day and 90 % of the month. No address and no credential. `doctor.sh` has a section too.

---

## Resend's reports

`POST /api/email/webhooks/resend` exists only with `EMAIL_TRANSPORT=resend` and a secret. It has its own parser for the raw body in its own plugin scope, because the signature covers the exact bytes; re-stringifying would break it. HMAC-SHA-256 per Svix, constant-time, five minutes of tolerance. `email.bounced` (not `Transient`), `email.suppressed` and `email.complained` suppress; everything else is ignored.

---

## Mail, and who sees it

The templates are one card with one button at most, tables and inline styles, with a plain-text part. The button is a step darker than the app's violet, so its words read at that size. Every name is escaped in HTML. No kind has a place for a password, code or token other than the link itself.

With `resend`, a US processor holds address, name and body for 30 days (the link included). So: sending-only key, MFA on that account, 30-minute links. Removing this needs a paid plan. The privacy draft says who, what and where (`LegalTemplateFacts.mail`, `legal.md`).

---

## Setting it up

**Resend** (in this order):

1. On the Resend dashboard, add the domain, and turn MFA on for that account.
2. Publish the records it shows, at your DNS host:

   | Type | Host | Value |
   |---|---|---|
   | TXT | `resend._domainkey` | DKIM, from the dashboard |
   | CNAME | `send` | From the dashboard: SPF and the return path |
   | CNAME | `rsend` | From the dashboard |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<a real mailbox>;` Keep `none` until tests pass, then `quarantine`, then `reject` |

   The values come from the dashboard: they differ per account and region. Wait for `verified`, not `partially_verified`.
3. Create an API key: Sending access, restricted to that domain.
4. In `.env`, and `chmod 600 .env`:
   ```
   EMAIL_TRANSPORT=resend
   EMAIL_FROM="Tavvit <no-reply@example.com>"
   EMAIL_REPLY_TO=you@example.com
   RESEND_API_KEY=re_...
   RESEND_WEBHOOK_SECRET=whsec_...
   ```
5. Add a webhook for `email.bounced`, `email.complained`, `email.suppressed`, `https://<domain>/api/email/webhooks/resend`.
6. `docker compose up -d`, which starts the app again with the changed `.env`.
7. Admin area → Email → send a test to mailboxes at Gmail, Outlook, GMX, WEB.DE and T-Online. Check the folder, the time, `dkim=pass` and `dmarc=pass`.
8. Legal: file Resend's DPA, check Plus Five Five, Inc. on dataprivacyframework.gov/list, then insert and publish the privacy draft again.

**An EU relay by SMTP** (Scaleway, Lettermint): `EMAIL_TRANSPORT=smtp` with `SMTP_*`, and `EMAIL_DAILY_LIMIT` to match the plan. The relay's own DNS records. Bounces then stay invisible to this server unless the address is refused at once.

**An own mail server** works as `EMAIL_TRANSPORT=smtp` too, and is not recommended until the server's reverse DNS is right, outbound port 25 is confirmed open, and two weeks of test mail have arrived. Failures are silent there, and T-Online and Microsoft are handled by hand.

**Test addresses** at Resend: `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, `suppressed@resend.dev`. They count against the quota.

---

## Known limits

- **Delivery is not proven.** Accepted is all this server knows. A mail in a spam folder looks like success; only test mailboxes show that.
- **SMTP hears no bounces** after the relay accepted a mail.
- **Reports get no mail.** Someone who reported without an account gets the outcome from the operator's own mailbox (`legal.md`).
- **100 mails a day** on Resend's free plan. A quota burned on confirmations leaves resets 15 of them; a burst of real sign-ups waits until the next day.

## Blocked domains

An address at a domain the console's sign-up rules block, or under it, is refused with `email_domain_blocked` at sign-up and in `PUT /api/users/@me/email`, before any mail is sent ([admin.md](admin.md), "The console"). An address an account already has stays. On a server that sends no mail an address is not even looked at, so neither is the rule.
