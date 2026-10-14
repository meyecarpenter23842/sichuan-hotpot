# First OWNER: one-time email-verified bootstrap

The Admin PWA already supports OWNER sign-in with username/password but *cannot* safely self-register an OWNER. Public customer signup always creates CUSTOMER. Never promote a customer account, insert an OWNER by editing the database manually, or pass the password through GitHub or chat.

## Prerequisites

- Protected `main` PR/CI green and the matching `apps/api` release health PASS.
- Resend configured on VPS with the verified `noreply@bepsi.click` sender.
- Owner Windows laptop has an existing host-key-pinned SSH connection and reviewed SSH private key.
- **No global OWNER yet**; at least one real branch exists; desired username and verified email are unused. The bootstrap refuses rather than overwrite an existing account.

On Windows at `F:\1_A_Disk_D\hotpot`, inspect `git status --short`, fetch `origin main`, and use `git pull --ff-only` when no tracked/local collisions exist. Preserve existing Android Studio files.

```powershell
.\scripts\ops\bootstrap-first-owner.ps1 -Username "your-owner-username" -Email "your-verified-email@example.com" -KeyPath "<YOUR_EXISTING_SSH_PRIVATE_KEY_PATH>" -Server "132.145.103.89"
```

The command prompts for the OWNER password in a masked field. It SSH-streams the reviewed helper and credentials via stdin (nothing is committed or logged), checks a single existing PostgreSQL branch and that no OWNER/account collision exists, and sends a 6-digit Resend code to the supplied email. **No OWNER is created before a matching code is entered within 10 minutes.**

On correct code, a serializable Prisma transaction obtains a dedicated advisory lock and inserts exactly one OWNER with an Argon2id password hash and verified email. It does not modify current customer accounts, orders, shipping rules, Prisma migration history or app files.

Success output: `OWNER created: PASS. Email verified: PASS. No production migration.`
On failure/timeout, stop and investigate; do not retry blindly or create a second OWNER. Credentials and OTP should never be shared in the chat. Verify sign-in at `https://admin.bepsi.click` and branch access separately.

**Note:** The app's customer password reset flow only supports 6–8-character new passwords, while OWNER login accepts up to 128 characters. Do not use the customer reset flow to reset an OWNER password. A dedicated OWNER recovery policy is needed before relying on production password recovery.
