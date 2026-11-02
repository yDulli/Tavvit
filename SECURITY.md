# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue, post or comment for a security problem.

Report it privately:

- on GitHub, as a **security advisory** on this repository (Security → **Report a vulnerability**), or
- to the contact a Tavvit instance names in its `/.well-known/security.txt`, for a problem on that instance.

Please include what you did, what happened, the affected version (the footer of the instance or `GET /api/instance/info`), and whether federation, voice or the desktop app is involved. You will get an answer, a fix as soon as one is ready, and a say in when the details are made public. Please give a fix time to reach the servers that run Tavvit before you publish.

For questions that are not about security, use **GitHub Discussions**.

## What is tested

Every release passes `scripts/release-check.mjs`: types, catalogs, lint, every test, the web build, and a start of the server as the Docker image starts it with every optional part configured. A browser check runs the main ways in against a demo instance. On GitHub, when Actions are enabled for this repository, the workflows in `.github/workflows` add CodeQL, OSV-Scanner, gitleaks, Trivy, an OWASP ZAP baseline scan and OpenSSF Scorecard; `docs/systems/security-scanning.md` describes them and how their findings are handled.

None of this replaces a report from a person. Automated scanning does not sign in, so it does not exercise spaces, channels, uploads, federation or voice; reports about those are especially welcome. The code has been reviewed by hand area by area, most recently for 1.32.4 to 1.32.7, and every confirmed finding was fixed, but no review proves the absence of the next one.

What Tavvit does not promise: messages are not end-to-end encrypted, so whoever runs an instance could read what is stored on it. The privacy policy of each instance says so.

## Supported versions

Only the latest release receives fixes. Run it.
