# Resend configuration for Sichuan Hotpot VPS

The NestJS backend already calls Resend API for verification and password-reset emails.
Resend's \`bepsi.click\` domain must be verified and sender enabled before this operation.
The sender is \`noreply@bepsi.click\`. Never paste API keys into issue comments,
Pull Requests, terminal commands or this repository.

## One-time secure setup (Windows owner laptop)

First confirm \`git status --porcelain\` is empty and update local main with
\`git fetch origin main\` and \`git pull --ff-only\`. If there are uncommitted
changes, stop: do not overwrite or delete them.

From \`F:\1_A_Disk_D\hotpot\`, run:

\`\`\`powershell
.\scripts\ops\set-resend-config.ps1 -KeyPath "<PATH_TO_EXISTING_PINNED_SSH_KEY>" -Server "132.145.103.89"
\`\`\`

Paste a **fresh** Resend API key at the masked password prompt (not in the command).
The PowerShell runner sends the audited helper plus the secret through SSH stdin;
the SSH private key remains local, and the Resend API key never appears in
command-line arguments or the repository.

The helper verifies protected API environment permissions, the active systemd
service, HTTPS + loopback health, and config contents before any write. It
atomically sets only \`RESEND_API_KEY\` and \`HOTPOT_MAIL_FROM\`, restarts
\`hotpot-api.service\`, and checks health. A failed health check restores the
previous environment, restarts the service, and reports no success. Temporary
root-only rollback material is removed.

Success output: \`Resend VPS configured: PASS. API health: PASS.\`

This success proves safe configuration and API health **only**; it does not
prove end-to-end delivery of an OTP. Use a legitimate registration or password
recovery flow to verify email delivery to an inbox. Do not create or reset a
production OWNER account through a customer signup flow.

## Security and limits

- If a key was ever pasted into a conversation, revoke/rotate it in Resend and
  configure the replacement key via the masked prompt.
- Never place \`RESEND_API_KEY\` in GitHub source, frontend env, Vercel PWA env,
  logs or a public API.
- The owner laptop's pinned SSH host-key trust must already be established;
  do not bypass \`StrictHostKeyChecking\`.
- This operation does not modify database schema, Prisma migrations, or any
  production records.
- Without SSH access to that laptop or VPS, GitHub merge alone cannot
  configure a production secret.
