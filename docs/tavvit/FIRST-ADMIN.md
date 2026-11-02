# The first administrator, and getting people in

Tavvit is **private by default**. With the default configuration:

- nobody can register from the browser,
- there is **no "first visitor becomes admin" window** that a stranger could use to
  take over a freshly installed server, and that holds with registration open as
  well: nobody ever becomes an administrator by registering,
- every account is made either by an invite link you control or by you, on the
  server.

That is a deliberate choice. This page is the procedure that follows from it.

## Creating the first administrator

`install.sh` does this for you at the end of the installation (it asks for a
username and a password at a hidden prompt). If you skipped it, or installed by
hand, run on the server, in the Tavvit folder:

```bash
./tavvit-admin.sh create <username> --admin
```

You are asked for a password (at least 8 characters, typed hidden). Usernames are
3-32 characters: lowercase letters, digits and underscores.

Other ways to supply the password, for scripts:

```bash
./tavvit-admin.sh create alice --admin --generate          # prints a random password once
printf '%s\n' "$PASSWORD" | ./tavvit-admin.sh create alice --admin --password-stdin
```

A password is never accepted as a command-line argument or from an environment
variable, where it would sit in shell history and in the process list.

Until an account exists, the sign-in page says so and shows this very command, and
`bash doctor.sh` reports it as a failure.

## Adding people

### Invite links (recommended)

*Admin console (the shield in the top bar) → Registration → Invite links.* Create a link and choose:

- how long it is valid (or never expires),
- how many people may use it (one, a few, unlimited).

Send it. Opening it shows the sign-up page with the invite already applied. You can
see who used which link, and **revoke** a link at any time; people who already
joined stay.

### Creating the account yourself

```bash
./tavvit-admin.sh create bob --member --display-name "Bob" --generate
```

Hand the printed password to Bob. Everyone can change their own password in
*Settings → My Account*.

### Opening registration (not recommended)

`REGISTRATION_OPEN=true` in `.env` (or the switch in *Admin console → Registration*) lets anyone who finds the address make an account. For a group of
friends there is no reason to. `bash doctor.sh` warns if it is on.

## Managing accounts

*Admin console → Users* lists accounts and lets an administrator promote or
demote, reset a password, or remove an account. From the server:

```bash
./tavvit-admin.sh list                         # every local account, admin or member
./tavvit-admin.sh reset-password alice --generate
./tavvit-admin.sh status                       # is this instance set up? how many accounts?
```

## If the administrator is locked out

Passwords are stored as hashes and cannot be read back. If the only
administrator forgets theirs:

```bash
./tavvit-admin.sh reset-password <that-username> --generate
```

Anyone who can run that has shell access to the server and could do anything to
the database anyway, which is why this needs no extra secret.

## If someone lost their phone and their recovery codes

Two-factor authentication can only be turned off from the server, because a stolen admin
session or a mailbox must not be a way around it. **Make sure of who is asking first:**
this is the one way past that second factor.

```bash
./tavvit-admin.sh reset-2fa <username>
```

It signs out every device, shows on the account's activity list and tells the account's
confirmed address.

## Rate limits you may run into

Repeated wrong passwords slow sign-in down but never lock anyone out: after three
failures each attempt waits a little longer, up to 30 seconds from the same address.
That is in memory, so restarting the container clears it. Wrong two-factor codes are
stricter and count in the database, because only someone with the password gets that
far. Registration and other sensitive endpoints have their own limits; see
`docs/systems/auth.md` and `docs/systems/email.md` for the numbers.
