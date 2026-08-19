# Platform-root access

`platform_root` is the NeurAI Platform operator role. It is **not** an Echo
organization role and it is intentionally not a way to read customer content.
It can see only lifecycle metadata (organizations, users, statuses and the
platform-control audit record) and can suspend/reactivate organizations,
disable/reactivate non-root users, and appoint or remove another platform root.

It cannot read calls, transcripts, summaries, assistant conversations,
connector credentials, API keys, prompts, or other organization content. Those
remain behind the existing organization RLS policies. A root who happens to be
an ordinary member of an organization has only that ordinary member's access to
that organization's content; `platform_root` adds none.

## First root: safe bootstrap

There is no default platform-root username or password. Creating one in code or
in a deployment document would create a permanent shared back door. The first
root uses their own normal, verified NeurAI account and password.

1. Deploy this release and apply migration `0066_platform_root_control_plane.sql`.
2. Choose the existing active account that should be the first root. Create it
   through the normal sign-up flow if it does not exist yet; choose the password
   there, never in a source file or deployment variable.
3. Set this **core API server-only** environment variable in the deployment's
   secret/environment settings:

   ```text
   PLATFORM_ROOT_BOOTSTRAP_EMAIL=the-verified-account@example.com
   ```

   This is an email selector, not a secret or password. Do not put it in a
   `NEXT_PUBLIC_*` setting and do not set it in the web deployment.
4. Sign in as that account and open `/fa/platform` (or `/en/platform`). Select
   **Claim platform root**.
5. Confirm that the avatar menu now shows **Platform control**. In the console,
   appoint at least one additional, separately controlled root before relying
   on it for production recovery.
6. Remove `PLATFORM_ROOT_BOOTSTRAP_EMAIL` from the core API deployment after
   the claim. The database permits only the first claim regardless, but
   removing the route's configuration shrinks the attack surface.

The claim route accepts no account or email from the browser. It compares the
authenticated, active account with the server-only configured address, and the database
records the successful bootstrap in the platform audit trail.

## Operating safely

- Every lifecycle action needs a 3–500 character reason and creates a
  metadata-only, immutable platform audit entry. Do not place customer content,
  passwords, tokens, or credentials in that reason.
- A root cannot disable a platform-root account, revoke itself, or remove the
  final remaining root. Use a second root for handover or incident response.
- If a root's own organization is suspended, ordinary Echo pages remain closed
  as intended. The signed-in root can still open `/fa/platform` directly and
  reactivate the organization; root authority is checked separately from the
  organization status. A disabled root loses that recovery authority
  immediately.
- The control console is intentionally not linked for non-root accounts. A
  direct URL gives no metadata and no ability to probe other organizations.

## Credential recovery

Platform-root does not change how anyone signs in. Use the account's normal
email/password sign-in, password-reset flow, and MFA policy. If the initial
account signed in with Google or GitHub, it must complete the normal password
setup screen first; that password is the account's password, not a second
platform-root password.
