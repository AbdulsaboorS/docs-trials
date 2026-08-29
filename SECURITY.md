# Security Policy

## Supported Versions

Security fixes are provided for the latest version published on npm.

## Report A Vulnerability

Use the repository's private **Report a vulnerability** form when it is
available. Otherwise, open a GitHub issue with no exploit details or secrets and
ask the maintainer to arrange a private channel.

Do not include credentials, private source code, or unsanitized attempt evidence
in a public issue.

## Execution Model

Docs Trials runs project commands and Chromium with the operator's operating
system account. Those commands can read other files available to that account,
including home-directory credentials, and can make unrestricted network
requests. The environment allowlist limits inherited variables only. The origin
allowlist observes browser traffic; it does not block traffic.

Docs Trials does not provide same-user isolation or a sandbox. Use an isolated
operating-system account or virtual machine for untrusted projects. At minimum,
use a disposable workspace, remove accessible credentials, and allow only the
environment-variable names that verification needs.

Lifecycle commands must stay in the foreground. Detached processes and
containers are unsupported and can outlive verification because v0 has no
process isolation.

Attempts are immutable to the CLI after verification, but local files are not
authenticated against another process with the same user account. Evidence is
redacted before it is written; redaction is not an isolation boundary.
