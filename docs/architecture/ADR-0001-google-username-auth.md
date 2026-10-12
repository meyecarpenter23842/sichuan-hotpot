# ADR-0001: Direct Google + username/password authentication

Status: ACCEPTED as a project direction on 2026-10-12. NOT YET IMPLEMENTED.

## Decision
- Remove Clerk from the planned authentication stack.
- Support Google sign-in directly through official OAuth 2.0/OpenID Connect on Android Expo and iPhone web PWA, with Google ID-token verification on NestJS (signature, issuer, audience, expiry and nonce where applicable). Map immutable Google subject to internal User UUID.
- Support separate username + password registration/login. This is not provided by Google OAuth alone. Normalize and uniquely constrain usernames; hash passwords using Argon2id on the backend, with login throttling, verified recovery contact, no username enumeration, and secure first-party session refresh/revocation.
- Guest browsing stays available. Require authenticated account plus phone, delivery address and map pin at checkout. Newly registered users start as CUSTOMER. Only backend-authorized staff management grants OWNER/MANAGER/KITCHEN/DRIVER branch roles.
- Separate Android native and web PWA redirect/security controls; use approved OAuth PKCE/state/nonce and secure token storage. Do not commit credentials. No automatic account linking by mutable email; verify both identities first.

## Existing P1.2 data model: action required
The current development Prisma schema still has User.clerkSubject. It is NOT a Google-sub field. Before implementing authentication, add a reviewed DEV-only migration for distinct Google identities, username credentials and sessions, preserving existing User UUID references. No production migration or automatic Clerk-to-Google data rewrite is authorized.

## Login UI/UX acceptance
No original login mockup exists. Build polished customer and admin login, username registration and recovery screens by deriving visual tokens and layout rules from all eight locked reference PNGs, especially 01-home.png, 02-hotpot-detail.png and 01-dashboard.png. Preserve the original palette, typography, spacing, component appearance and navigational style; no unrelated redesign.

For each UI task, MUST read .agents/skills/professional-frontend-qa/SKILL.md and relevant references. Compare running screen captures side by side with originals. Test 320/360/390/428 mobile widths, tablet/desktop, Android emulator and Safari iPhone PWA where available. Test keyboard, safe area, >=44px tap targets, accessibility, loading, validation, error, offline, account recovery and success. Record evidence as PASS/FAIL/NOT TESTED. A plan does not count as a tested UI.

## Implementation order
1. DEV Prisma identities, password credentials and session schema/migration.
2. NestJS username registration/login and role/branch 401/403 tests.
3. Google direct OAuth/OIDC integration, verified identity linking and recovery.
4. Expo customer/admin login/signup UI with mandatory visual QA.

No production deploy, migration or Git-triggered release.
